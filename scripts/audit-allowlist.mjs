#!/usr/bin/env node
// Runs `npm audit` and enforces it as a gate, EXCEPT for a small set of
// explicitly time-boxed, tracked advisory exceptions.
//
// Each exception MUST carry a hard `expires` date and a `tracking` issue.
// Expired or malformed entries fail the gate even when the advisory is absent.
// Command failures, npm error envelopes, and unrecognized report shapes also
// fail closed instead of being mistaken for a clean audit.
//
// Usage: node scripts/audit-allowlist.mjs
//   [--workspace=root|cli|web|web-next]
//   [--audit-level=high|moderate|critical|low]
// Exit 0 if the only vulns at/above the level are active allowlisted ones;
// exit 1 otherwise.

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Time-boxed, tracked exceptions ------------------------------------------
// Do NOT add an entry without both `expires` and `tracking`.
// Intentionally empty: the two esbuild exceptions (GHSA-gv7w-rqvm-qjhr,
// GHSA-g7r4-m6w7-qqqr) were remediated at source — esbuild is now pinned to the
// patched 0.28.1, so the advisories no longer fire and the time-boxed
// exceptions (expired 2026-06-18) are removed rather than renewed (PROJ-1283).
// Add an entry only for a genuinely unremediable transitive advisory, and only
// with both `expires` and `tracking`.
const ALLOWLIST = [];
// -----------------------------------------------------------------------------

const SEVERITY_RANK = Object.freeze({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 });
const SEVERITIES = Object.freeze(Object.keys(SEVERITY_RANK));
const WORKSPACES = Object.freeze(['root', 'cli', 'web', 'web-next']);
const GHSA_GROUP_PATTERN = '[23456789cfghjmpqrvwx]{4}';
const ADVISORY_ID_PATTERN = new RegExp(
  `^(?:GHSA-${GHSA_GROUP_PATTERN}-${GHSA_GROUP_PATTERN}-${GHSA_GROUP_PATTERN}|CVE-\\d{4}-\\d{4,})$`,
  'i',
);
const ADVISORY_ID_IN_URL_PATTERN = new RegExp(
  `(?:^|[^0-9a-z-])(GHSA-${GHSA_GROUP_PATTERN}-${GHSA_GROUP_PATTERN}-${GHSA_GROUP_PATTERN}|CVE-\\d{4}-\\d{4,})(?![0-9a-z-])`,
  'i',
);
const DEFAULT_NPM_AUDIT_TIMEOUT_MS = 60_000;
const NPM_AUDIT_RETRY_DELAY_MS = 250;

export class AuditGateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuditGateError';
  }
}

export class AuditExecutionError extends AuditGateError {
  constructor(message) {
    super(message);
    this.name = 'AuditExecutionError';
  }
}

export class AuditReportValidationError extends AuditGateError {
  constructor(message) {
    super(message);
    this.name = 'AuditReportValidationError';
  }
}

export class AllowlistValidationError extends AuditGateError {
  constructor(message) {
    super(message);
    this.name = 'AllowlistValidationError';
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeDiagnostic(value) {
  return String(value)
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[redacted]@')
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b(bearer|basic)\s+[a-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/([?&](?:access_token|_authToken|_auth|auth|token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(_authToken|_auth|token|authorization)\s*=\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b(?:npm|ghp|github_pat)_[a-z0-9_=-]+\b/gi, '[redacted-token]')
    .slice(0, 500);
}

function auditErrorEnvelopeMessage(report) {
  const summary = isRecord(report.error)
    ? sanitizeDiagnostic(
        report.error.summary || report.error.code || report.message || 'unknown npm audit error',
      )
    : sanitizeDiagnostic(report.error || report.message || 'unknown npm audit error');
  return `audit-allowlist: npm audit returned an error envelope: ${summary}; report keys=${Object.keys(report).join(',')}`;
}

function auditTimeoutMilliseconds(environmentValue) {
  if (environmentValue === undefined) return DEFAULT_NPM_AUDIT_TIMEOUT_MS;
  if (!/^\d+$/.test(environmentValue)) {
    throw new AuditGateError('audit-allowlist: AUDIT_ALLOWLIST_TIMEOUT_MS must be an integer');
  }
  const timeout = Number(environmentValue);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) {
    throw new AuditGateError(
      'audit-allowlist: AUDIT_ALLOWLIST_TIMEOUT_MS must be between 1 and 120000',
    );
  }
  return timeout;
}

export function parseOptions(argv) {
  let level = 'high';
  let levelSeen = false;
  let workspace = 'root';
  let workspaceSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    let candidate;
    if (argument === '--audit-level') {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
        throw new AuditGateError('audit-allowlist: --audit-level requires a value');
      }
      candidate = argv[index + 1];
      index += 1;
    } else if (argument.startsWith('--audit-level=')) {
      candidate = argument.slice('--audit-level='.length);
      if (candidate.length === 0) {
        throw new AuditGateError('audit-allowlist: --audit-level requires a value');
      }
    } else if (argument === '--workspace' || argument.startsWith('--workspace=')) {
      const usesSeparateValue = argument === '--workspace';
      if (usesSeparateValue && (index + 1 >= argv.length || argv[index + 1].startsWith('--'))) {
        throw new AuditGateError('audit-allowlist: --workspace requires a value');
      }
      candidate = usesSeparateValue ? argv[index + 1] : argument.slice('--workspace='.length);
      if (usesSeparateValue) index += 1;
      if (candidate.length === 0) {
        throw new AuditGateError('audit-allowlist: --workspace requires a value');
      }
      if (workspaceSeen) {
        throw new AuditGateError('audit-allowlist: --workspace may be provided only once');
      }
      if (!WORKSPACES.includes(candidate)) {
        throw new AuditGateError(
          `audit-allowlist: unsupported workspace ${candidate}; expected one of ${WORKSPACES.join(', ')}`,
        );
      }
      workspace = candidate;
      workspaceSeen = true;
      continue;
    } else {
      throw new AuditGateError(`audit-allowlist: unsupported argument ${argument}`);
    }

    if (levelSeen) {
      throw new AuditGateError('audit-allowlist: --audit-level may be provided only once');
    }
    if (!Object.hasOwn(SEVERITY_RANK, candidate)) {
      throw new AuditGateError(
        `audit-allowlist: unsupported audit level ${candidate}; expected one of ${SEVERITIES.join(', ')}`,
      );
    }
    level = candidate;
    levelSeen = true;
  }

  return { level, workspace };
}

export function parseLevel(argv) {
  return parseOptions(argv).level;
}

function validateDate(date, index) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AllowlistValidationError(
      `audit-allowlist: allowlist entry ${index} has invalid expires date ${String(date)}`,
    );
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new AllowlistValidationError(
      `audit-allowlist: allowlist entry ${index} has impossible expires date ${date}`,
    );
  }
}

export function validateAllowlist(entries, now) {
  if (!Array.isArray(entries)) {
    throw new AllowlistValidationError('audit-allowlist: allowlist must be an array');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new AllowlistValidationError('audit-allowlist: current time must be a valid Date');
  }

  const active = new Map();
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry)) {
      throw new AllowlistValidationError(`audit-allowlist: allowlist entry ${index} must be an object`);
    }
    if (typeof entry.id !== 'string' || !ADVISORY_ID_PATTERN.test(entry.id)) {
      throw new AllowlistValidationError(
        `audit-allowlist: allowlist entry ${index} has invalid advisory id ${String(entry.id)}`,
      );
    }
    if (typeof entry.workspace !== 'string' || !WORKSPACES.includes(entry.workspace)) {
      throw new AllowlistValidationError(
        `audit-allowlist: allowlist entry ${index} has invalid workspace ${String(entry.workspace)}`,
      );
    }
    const key = `${entry.workspace}:${entry.id.toUpperCase()}`;
    if (active.has(key)) {
      throw new AllowlistValidationError(
        `audit-allowlist: duplicate allowlist advisory ${entry.id} for workspace ${entry.workspace}`,
      );
    }
    validateDate(entry.expires, index);
    if (typeof entry.tracking !== 'string' || entry.tracking.trim().length === 0) {
      throw new AllowlistValidationError(
        `audit-allowlist: allowlist entry ${index} must include a non-empty tracking reference`,
      );
    }

    const expiresAt = new Date(`${entry.expires}T23:59:59.999Z`);
    if (now > expiresAt) {
      throw new AllowlistValidationError(
        `audit-allowlist: allowlist advisory ${entry.id} expired ${entry.expires} (${entry.tracking})`,
      );
    }
    active.set(key, entry);
  }
  return active;
}

function validateVulnerabilityMetadata(metadata) {
  if (!isRecord(metadata) || !isRecord(metadata.vulnerabilities)) {
    throw new AuditReportValidationError(
      'audit-allowlist: npm audit report is missing metadata.vulnerabilities',
    );
  }
  for (const severity of [...SEVERITIES, 'total']) {
    const count = metadata.vulnerabilities[severity];
    if (!Number.isInteger(count) || count < 0) {
      throw new AuditReportValidationError(
        `audit-allowlist: npm audit metadata.vulnerabilities.${severity} must be a non-negative integer`,
      );
    }
  }
  const severityTotal = SEVERITIES.reduce(
    (total, severity) => total + metadata.vulnerabilities[severity],
    0,
  );
  if (metadata.vulnerabilities.total !== severityTotal) {
    throw new AuditReportValidationError(
      `audit-allowlist: npm audit metadata total ${metadata.vulnerabilities.total} does not match severity sum ${severityTotal}`,
    );
  }
}

export function validateAuditReport(report) {
  if (!isRecord(report)) {
    throw new AuditReportValidationError('audit-allowlist: npm audit report must be an object');
  }
  if (Object.hasOwn(report, 'error')) {
    throw new AuditReportValidationError(auditErrorEnvelopeMessage(report));
  }
  if (report.auditReportVersion !== 2) {
    throw new AuditReportValidationError(
      `audit-allowlist: unsupported npm audit report version ${String(report.auditReportVersion)}; expected 2`,
    );
  }
  if (!isRecord(report.vulnerabilities)) {
    throw new AuditReportValidationError('audit-allowlist: npm audit report is missing vulnerabilities');
  }
  validateVulnerabilityMetadata(report.metadata);

  const packageSeverityCounts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (!isRecord(vulnerability)) {
      throw new AuditReportValidationError(
        `audit-allowlist: vulnerability record for ${packageName} must be an object`,
      );
    }
    if (!Object.hasOwn(SEVERITY_RANK, vulnerability.severity)) {
      throw new AuditReportValidationError(
        `audit-allowlist: vulnerability record for ${packageName} has invalid severity ${String(vulnerability.severity)}`,
      );
    }
    packageSeverityCounts[vulnerability.severity] += 1;
    if (!Array.isArray(vulnerability.via)) {
      throw new AuditReportValidationError(
        `audit-allowlist: vulnerability record for ${packageName} must include a via array`,
      );
    }
    for (const via of vulnerability.via) {
      if (typeof via === 'string') continue;
      if (!isRecord(via)) {
        throw new AuditReportValidationError(
          `audit-allowlist: vulnerability record for ${packageName} has an invalid via entry`,
        );
      }
      if (!Object.hasOwn(SEVERITY_RANK, via.severity)) {
        throw new AuditReportValidationError(
          `audit-allowlist: advisory in ${packageName} has invalid severity ${String(via.severity)}`,
        );
      }
      if (typeof via.url !== 'string') {
        throw new AuditReportValidationError(
          `audit-allowlist: advisory in ${packageName} must include a URL`,
        );
      }
    }
  }

  for (const severity of SEVERITIES) {
    if (report.metadata.vulnerabilities[severity] !== packageSeverityCounts[severity]) {
      throw new AuditReportValidationError(
        `audit-allowlist: npm audit metadata ${severity} count ${report.metadata.vulnerabilities[severity]} does not match ${packageSeverityCounts[severity]} package record(s)`,
      );
    }
  }

  return report;
}

function advisoryFromVia(via, packageName) {
  const match = via.url.match(ADVISORY_ID_IN_URL_PATTERN);
  if (!match) return null;
  return {
    id: match[1].toUpperCase(),
    severity: via.severity,
    url: via.url,
    packageName,
  };
}

function collectPackageAdvisories(report, packageName, threshold, visited) {
  if (!Object.hasOwn(report.vulnerabilities, packageName)) {
    throw new AuditReportValidationError(
      `audit-allowlist: npm audit via reference points to missing package ${packageName}`,
    );
  }
  const vulnerability = report.vulnerabilities[packageName];
  if (visited.has(packageName)) return [];

  visited.add(packageName);
  const advisories = [];
  for (const via of vulnerability.via) {
    if (typeof via === 'string') {
      advisories.push(...collectPackageAdvisories(report, via, threshold, visited));
      continue;
    }
    if (SEVERITY_RANK[via.severity] < threshold) continue;
    const advisory = advisoryFromVia(via, packageName);
    if (!advisory) {
      throw new AuditReportValidationError(
        `audit-allowlist: advisory in ${packageName} is ${via.severity} but its URL has no resolvable GHSA/CVE`,
      );
    }
    advisories.push(advisory);
  }
  return advisories;
}

export function collectBlockingAdvisories(report, level) {
  const threshold = SEVERITY_RANK[level];
  const present = new Map();

  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (SEVERITY_RANK[vulnerability.severity] < threshold) continue;
    const advisories = collectPackageAdvisories(report, packageName, threshold, new Set());
    if (advisories.length === 0) {
      throw new AuditReportValidationError(
        `audit-allowlist: vulnerable package ${packageName} is >= ${level} but has no resolvable GHSA/CVE advisory`,
      );
    }
    for (const advisory of advisories) {
      const current = present.get(advisory.id) ?? {
        severity: advisory.severity,
        url: advisory.url,
        packages: new Set(),
      };
      current.packages.add(packageName);
      present.set(advisory.id, current);
    }
  }

  const metadataCount = Object.entries(report.metadata.vulnerabilities)
    .filter(([severity]) => Object.hasOwn(SEVERITY_RANK, severity) && SEVERITY_RANK[severity] >= threshold)
    .reduce((count, [, value]) => count + value, 0);
  if (metadataCount > 0 && present.size === 0) {
    throw new AuditReportValidationError(
      `audit-allowlist: npm reports ${metadataCount} vulnerability(s) >= ${level} but no advisory IDs were resolved`,
    );
  }

  return present;
}

function runNpmAuditAttempt(timeout) {
  const result = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  if (result.error) {
    throw new AuditExecutionError(
      `audit-allowlist: failed to run npm audit: ${sanitizeDiagnostic(result.error.message)}`,
    );
  }
  if (result.signal !== null) {
    throw new AuditExecutionError(`audit-allowlist: npm audit terminated by signal ${result.signal}`);
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new AuditExecutionError(
      `audit-allowlist: npm audit exited with unexpected status ${String(result.status)}`,
    );
  }
  if (typeof result.stdout !== 'string' || result.stdout.trim().length === 0) {
    throw new AuditExecutionError('audit-allowlist: npm audit returned empty output');
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AuditReportValidationError(
      `audit-allowlist: could not parse npm audit JSON: ${sanitizeDiagnostic(reason)}`,
    );
  }
  if (isRecord(report) && Object.hasOwn(report, 'error')) {
    throw new AuditExecutionError(auditErrorEnvelopeMessage(report));
  }
  const validatedReport = validateAuditReport(report);
  if (result.status === 1 && validatedReport.metadata.vulnerabilities.total === 0) {
    throw new AuditExecutionError(
      'audit-allowlist: npm audit exited with status 1 but reported zero vulnerabilities',
    );
  }
  return validatedReport;
}

function runNpmAudit(timeout) {
  const maximumAttempts = 2;
  let lastError;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return runNpmAuditAttempt(timeout);
    } catch (error) {
      if (!(error instanceof AuditExecutionError)) {
        if (error instanceof AuditGateError) throw error;
        throw new AuditExecutionError(
          `audit-allowlist: unexpected npm audit failure: ${sanitizeDiagnostic(error instanceof Error ? error.message : String(error))}`,
        );
      }
      lastError = error;
      if (attempt < maximumAttempts) {
        console.warn(
          `audit-allowlist: npm audit attempt ${attempt}/${maximumAttempts} failed: ${error.message}; retrying`,
        );
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
          0,
          0,
          NPM_AUDIT_RETRY_DELAY_MS,
        );
      }
    }
  }
  throw lastError;
}

export function partitionAdvisories(present, activeAllowlist, workspace) {
  const honored = [];
  const blocking = [];

  for (const [id, vulnerability] of present) {
    const entry = activeAllowlist.get(`${workspace}:${id}`);
    if (entry) honored.push({ id, ...vulnerability, entry });
    else blocking.push({ id, ...vulnerability });
  }
  return { honored, blocking };
}

export function runAuditGate(argv, now) {
  const { level, workspace } = parseOptions(argv);
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const expectedDirectory = workspace === 'root' ? repositoryRoot : path.join(repositoryRoot, workspace);
  if (canonicalPath(process.cwd()) !== canonicalPath(expectedDirectory)) {
    throw new AuditGateError(
      `audit-allowlist: --workspace=${workspace} must run from ${expectedDirectory}, not ${process.cwd()}`,
    );
  }
  const activeAllowlist = validateAllowlist(ALLOWLIST, now);
  const report = runNpmAudit(auditTimeoutMilliseconds(process.env.AUDIT_ALLOWLIST_TIMEOUT_MS));
  const present = collectBlockingAdvisories(report, level);
  const { honored, blocking } = partitionAdvisories(present, activeAllowlist, workspace);

  if (honored.length > 0) {
    console.log(`audit-allowlist: honoring ${honored.length} time-boxed exception(s) at level=${level}:`);
    for (const item of honored) {
      console.log(
        `  - ${item.id} [${item.severity}] (${[...item.packages].join(', ')}) -> allowed until ${item.entry.expires} (${item.entry.tracking})`,
      );
    }
  }
  if (blocking.length > 0) {
    console.error(`audit-allowlist: ${blocking.length} non-allowlisted vulnerability(s) >= ${level}:`);
    for (const item of blocking) {
      console.error(
        `  - ${item.id} [${item.severity}] (${[...item.packages].join(', ')}) ${sanitizeDiagnostic(item.url)}`,
      );
    }
    console.error('audit-allowlist: FAIL');
    return 1;
  }

  console.log(`audit-allowlist: PASS (no non-allowlisted vulnerabilities >= ${level}).`);
  return 0;
}

function canonicalPath(candidate) {
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  canonicalPath(fileURLToPath(import.meta.url)) === canonicalPath(process.argv[1]);
if (isDirectExecution) {
  try {
    process.exitCode = runAuditGate(process.argv.slice(2), new Date());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(sanitizeDiagnostic(message));
    process.exitCode = 1;
  }
}
