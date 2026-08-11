import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  collectBlockingAdvisories,
  partitionAdvisories,
  validateAllowlist,
  validateAuditReport,
} from '../scripts/audit-allowlist.mjs';

const REPOSITORY_ROOT = process.cwd();
const SCRIPT = path.join(REPOSITORY_ROOT, 'scripts', 'audit-allowlist.mjs');
const TEMP_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'corgi-audit-allowlist-'));
const FAKE_NPM = path.join(TEMP_DIRECTORY, 'npm');
const SCRIPT_SYMLINK = path.join(TEMP_DIRECTORY, 'audit-allowlist.mjs');

writeFileSync(
  FAKE_NPM,
  `#!/usr/bin/env node
if (process.env.FAKE_NPM_MODE === 'signal') {
  process.kill(process.pid, 'SIGTERM');
} else if (process.env.FAKE_NPM_MODE === 'hang') {
  setInterval(() => {}, 1_000);
} else {
  process.stdout.write(process.env.FAKE_NPM_STDOUT ?? '');
  process.exit(Number(process.env.FAKE_NPM_STATUS ?? '0'));
}
`,
  'utf8',
);
chmodSync(FAKE_NPM, 0o755);
symlinkSync(SCRIPT, SCRIPT_SYMLINK);

afterAll(() => {
  rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
});

function cleanReport(): Record<string, unknown> {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
      },
    },
  };
}

function runWrapper(
  mode: 'exit' | 'hang' | 'signal',
  stdout: string,
  status: number,
  arguments_: string[],
): SpawnSyncReturns<string> {
  return runWrapperScript(SCRIPT, mode, stdout, status, arguments_);
}

function runWrapperScript(
  script: string,
  mode: 'exit' | 'hang' | 'signal',
  stdout: string,
  status: number,
  arguments_: string[],
): SpawnSyncReturns<string> {
  return runWrapperScriptFromDirectory(script, REPOSITORY_ROOT, mode, stdout, status, arguments_);
}

function runWrapperScriptFromDirectory(
  script: string,
  workingDirectory: string,
  mode: 'exit' | 'hang' | 'signal',
  stdout: string,
  status: number,
  arguments_: string[],
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${TEMP_DIRECTORY}${path.delimiter}${process.env.PATH ?? ''}`,
      FAKE_NPM_MODE: mode,
      FAKE_NPM_STDOUT: stdout,
      FAKE_NPM_STATUS: String(status),
      ...(mode === 'hang' ? { AUDIT_ALLOWLIST_TIMEOUT_MS: '50' } : {}),
    },
  });
}

describe('audit allowlist command', () => {
  it('passes a clean npm audit v2 report', () => {
    const result = runWrapper('exit', JSON.stringify(cleanReport()), 0, ['--audit-level=moderate']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('audit-allowlist: PASS');
  });

  it('continues filtering when npm exits one for findings below the requested level', () => {
    const report = cleanReport();
    report.vulnerabilities = {
      example: {
        severity: 'low',
        via: [
          {
            severity: 'low',
            url: 'https://github.com/advisories/GHSA-2222-3333-4444',
          },
        ],
      },
    };
    report.metadata = {
      vulnerabilities: {
        info: 0,
        low: 1,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 1,
      },
    };

    const result = runWrapper('exit', JSON.stringify(report), 1, ['--audit-level=high']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('audit-allowlist: PASS');
  });

  it('fails closed on a parseable npm error envelope', () => {
    const result = runWrapper(
      'exit',
      JSON.stringify({ error: { code: 'ENETUNREACH', summary: 'registry unavailable' } }),
      1,
      ['--audit-level=moderate'],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm audit returned an error envelope: registry unavailable');
    expect(result.stderr).toContain('retrying');
  });

  it('redacts credentials from npm error diagnostics', () => {
    const result = runWrapper(
      'exit',
      JSON.stringify({
        error: {
          summary:
            'Authorization: Bearer secret-value request to https://username:password@registry.example failed token=plain-secret _authToken=npm-secret _auth=legacy-secret authorization=basic-secret',
        },
      }),
      1,
      ['--audit-level=moderate'],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Authorization: Bearer [redacted]');
    expect(result.stderr).toContain('https://[redacted]@registry.example');
    expect(result.stderr).not.toContain('secret-value');
    expect(result.stderr).not.toContain('username:password');
    expect(result.stderr).not.toContain('plain-secret');
    expect(result.stderr).not.toContain('npm-secret');
    expect(result.stderr).not.toContain('legacy-secret');
    expect(result.stderr).not.toContain('basic-secret');
  });

  it('fails closed when npm audit terminates by signal', () => {
    const result = runWrapper('signal', '', 0, ['--audit-level=moderate']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm audit terminated by signal SIGTERM');
    expect(result.stderr).toContain('retrying');
  });

  it('bounds each npm audit attempt', () => {
    const result = runWrapper('hang', '', 0, ['--audit-level=moderate']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ETIMEDOUT');
  });

  it('fails closed on unexpected npm audit exit status', () => {
    const result = runWrapper('exit', JSON.stringify(cleanReport()), 2, ['--audit-level=moderate']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm audit exited with unexpected status 2');
  });

  it('retries and fails closed on empty npm audit output', () => {
    const result = runWrapper('exit', '', 1, ['--audit-level=moderate']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm audit returned empty output');
    expect(result.stderr).toContain('retrying');
  });

  it.each([
    ['null JSON', 'null', 'npm audit report must be an object'],
    ['warning-prefixed JSON', `npm warning registry slow\n${JSON.stringify(cleanReport())}`, 'could not parse'],
  ])('fails closed without retrying on %s', (_name, stdout, expectedError) => {
    const result = runWrapper('exit', stdout, 1, ['--audit-level=moderate']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedError);
    expect(result.stderr).not.toContain('retrying');
  });

  it('fails closed when npm exits one with a clean-looking report', () => {
    const result = runWrapper('exit', JSON.stringify(cleanReport()), 1, ['--audit-level=moderate']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('status 1 but reported zero vulnerabilities');
  });

  it.each([
    ['invalid JSON', '{not-json', 'could not parse npm audit JSON'],
    ['missing report version', JSON.stringify({ vulnerabilities: {}, metadata: {} }), 'report version'],
    [
      'missing vulnerability metadata',
      JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} }),
      'metadata.vulnerabilities',
    ],
  ])('fails closed on %s', (_name, stdout, expectedError) => {
    const result = runWrapper('exit', stdout, 1, ['--audit-level=moderate']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedError);
  });

  it('does not expose credentials embedded in invalid npm audit output', () => {
    const result = runWrapper(
      'exit',
      '{"registry":"https://user:token@registry.example",not-json',
      1,
      ['--audit-level=moderate'],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not parse npm audit JSON');
    expect(result.stderr).not.toContain('user:token');
  });

  it('fails closed when npm vulnerability metadata is internally inconsistent', () => {
    const malformed = cleanReport();
    malformed.metadata = {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 1,
      },
    };

    const result = runWrapper('exit', JSON.stringify(malformed), 0, ['--audit-level=moderate']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not match severity sum');
  });

  it('resolves advisory IDs through npm via package references', () => {
    const report = cleanReport();
    report.vulnerabilities = {
      parent: { severity: 'high', via: ['child'] },
      child: {
        severity: 'high',
        via: [
          {
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-4444-5555-6666',
          },
        ],
      },
    };
    report.metadata = {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 2,
        critical: 0,
        total: 2,
      },
    };

    const result = runWrapper('exit', JSON.stringify(report), 1, ['--audit-level=high']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GHSA-4444-5555-6666');
    expect(result.stderr).toContain('(parent, child)');
  });

  it('executes the gate through a symlinked script path', () => {
    const report = cleanReport();
    report.vulnerabilities = {
      example: {
        severity: 'high',
        via: [
          {
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-2345-cfgh-jmpq',
          },
        ],
      },
    };
    report.metadata = {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 1,
        critical: 0,
        total: 1,
      },
    };

    const result = runWrapperScript(
      SCRIPT_SYMLINK,
      'exit',
      JSON.stringify(report),
      1,
      ['--workspace=root', '--audit-level=high'],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GHSA-2345-CFGH-JMPQ');
  });

  it('rejects a workspace label that does not match the audit directory', () => {
    const result = runWrapperScriptFromDirectory(
      SCRIPT,
      path.join(REPOSITORY_ROOT, 'web'),
      'exit',
      JSON.stringify(cleanReport()),
      0,
      ['--workspace=root', '--audit-level=moderate'],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--workspace=root must run from');
  });

  it('fails when any in-threshold advisory URL lacks a GHSA or CVE identifier', () => {
    const report = cleanReport();
    report.vulnerabilities = {
      example: {
        severity: 'high',
        via: [
          {
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-7777-8888-9999',
          },
          {
            severity: 'high',
            url: 'https://security.example/advisories/unidentified-high-risk',
          },
        ],
      },
    };
    report.metadata = {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 1,
        critical: 0,
        total: 1,
      },
    };
    const validated = validateAuditReport(report);

    expect(() => collectBlockingAdvisories(validated, 'high')).toThrow(/no resolvable GHSA\/CVE/);
  });

  it.each([
    'https://github.com/advisories/GHSA-abcd-cfgh-jmpq',
    'https://github.com/advisories/GHSA-23456-cfgh-jmpq',
    'https://github.com/advisories/GHSA-2345-cfgh-jmpq-extra',
    'https://security.example/CVE-2026-1234-extra',
  ])('rejects malformed advisory identifiers in URLs: %s', (url) => {
    const report = cleanReport();
    report.vulnerabilities = {
      example: {
        severity: 'high',
        via: [{ severity: 'high', url }],
      },
    };
    report.metadata = {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 1,
        critical: 0,
        total: 1,
      },
    };
    const validated = validateAuditReport(report);

    expect(() => collectBlockingAdvisories(validated, 'high')).toThrow(/no resolvable GHSA\/CVE/);
  });

  it('terminates cyclic via references while retaining their advisory', () => {
    const report = cleanReport();
    report.vulnerabilities = {
      alpha: { severity: 'high', via: ['beta'] },
      beta: {
        severity: 'high',
        via: [
          'alpha',
          {
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-2345-cfgh-jmpq',
          },
        ],
      },
    };
    report.metadata = {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 2,
        critical: 0,
        total: 2,
      },
    };

    const advisories = collectBlockingAdvisories(validateAuditReport(report), 'high');

    expect([...advisories]).toHaveLength(1);
    expect(advisories.get('GHSA-2345-CFGH-JMPQ')?.packages).toEqual(new Set(['alpha', 'beta']));
  });

  it('rejects inherited prototype keys as missing via packages', () => {
    const report = cleanReport();
    report.vulnerabilities = {
      alpha: { severity: 'high', via: ['constructor'] },
    };
    report.metadata = {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 1,
        critical: 0,
        total: 1,
      },
    };

    expect(() => collectBlockingAdvisories(validateAuditReport(report), 'high')).toThrow(
      /points to missing package constructor/,
    );
  });

  it('deduplicates a diamond via graph while retaining all affected packages', () => {
    const report = cleanReport();
    report.vulnerabilities = {
      alpha: { severity: 'high', via: ['beta', 'gamma'] },
      beta: { severity: 'high', via: ['delta'] },
      gamma: { severity: 'high', via: ['delta'] },
      delta: {
        severity: 'high',
        via: [
          {
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-2345-cfgh-jmpq',
          },
        ],
      },
    };
    report.metadata = {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 4,
        critical: 0,
        total: 4,
      },
    };

    const advisories = collectBlockingAdvisories(validateAuditReport(report), 'high');

    expect([...advisories]).toHaveLength(1);
    expect(advisories.get('GHSA-2345-CFGH-JMPQ')?.packages).toEqual(
      new Set(['alpha', 'beta', 'gamma', 'delta']),
    );
  });

  it('rejects missing and unknown audit levels before invoking npm', () => {
    const missing = runWrapper('exit', JSON.stringify(cleanReport()), 0, ['--audit-level']);
    const unknown = runWrapper('exit', JSON.stringify(cleanReport()), 0, ['--audit-level=urgent']);

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('--audit-level requires a value');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('unsupported audit level urgent');
  });
});

describe('audit allowlist validation', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');

  it('rejects expired entries even when no audit report contains the advisory', () => {
    expect(() =>
      validateAllowlist(
        [
          {
            id: 'GHSA-2222-3333-4444',
            workspace: 'root',
            expires: '2026-08-09',
            tracking: 'PROJ-1',
          },
        ],
        now,
      ),
    ).toThrow(/expired 2026-08-09/);
  });

  it('rejects invalid dates, missing tracking references, and duplicate IDs', () => {
    expect(() =>
      validateAllowlist(
        [
          {
            id: 'GHSA-2222-3333-4444',
            workspace: 'root',
            expires: '2026-02-30',
            tracking: 'PROJ-1',
          },
        ],
        now,
      ),
    ).toThrow(/impossible expires date/);
    expect(() =>
      validateAllowlist(
        [
          {
            id: 'GHSA-2222-3333-4444',
            workspace: 'root',
            expires: '2026-08-11',
            tracking: '',
          },
        ],
        now,
      ),
    ).toThrow(/non-empty tracking reference/);
    expect(() =>
      validateAllowlist(
        [
          {
            id: 'GHSA-2222-3333-4444',
            workspace: 'root',
            expires: '2026-08-11',
            tracking: 'PROJ-1',
          },
          {
            id: 'GHSA-2222-3333-4444',
            workspace: 'root',
            expires: '2026-08-12',
            tracking: 'PROJ-2',
          },
        ],
        now,
      ),
    ).toThrow(/duplicate allowlist advisory/);
  });

  it('scopes advisory exceptions to one workspace', () => {
    const advisoryId = 'GHSA-2345-CFGH-JMPQ';
    const present = new Map([
      [
        advisoryId,
        {
          severity: 'high',
          url: `https://github.com/advisories/${advisoryId}`,
          packages: new Set(['example']),
        },
      ],
    ]);
    const rootOnly = validateAllowlist(
      [
        {
          id: advisoryId,
          workspace: 'root',
          expires: '2026-08-11',
          tracking: 'PROJ-1',
        },
      ],
      now,
    );
    const matchingWeb = validateAllowlist(
      [
        {
          id: advisoryId,
          workspace: 'web',
          expires: '2026-08-11',
          tracking: 'PROJ-2',
        },
      ],
      now,
    );

    expect(partitionAdvisories(present, rootOnly, 'web')).toMatchObject({
      honored: [],
      blocking: [{ id: advisoryId }],
    });
    expect(partitionAdvisories(present, matchingWeb, 'web')).toMatchObject({
      honored: [{ id: advisoryId }],
      blocking: [],
    });
  });

  it('rejects missing and invalid workspace fields', () => {
    expect(() =>
      validateAllowlist(
        [
          {
            id: 'GHSA-2222-3333-4444',
            expires: '2026-08-11',
            tracking: 'PROJ-1',
          },
        ],
        now,
      ),
    ).toThrow(/invalid workspace/);
    expect(() =>
      validateAllowlist(
        [
          {
            id: 'GHSA-2222-3333-4444',
            workspace: 'unknown',
            expires: '2026-08-11',
            tracking: 'PROJ-1',
          },
        ],
        now,
      ),
    ).toThrow(/invalid workspace/);
  });
});
