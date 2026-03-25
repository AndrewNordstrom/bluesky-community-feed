# Security Best Practices Report

Date: March 16, 2026
Scope: deploy pipeline, repository/security controls, application code, and VPS runtime hardening.

## Executive Summary

- Deploy failures were caused by VPS deploy tests loading production `.env` tuning values, causing deterministic test assertions to fail.
- Core web/runtime posture is strong (CSP/HSTS/security headers present, UFW active, fail2ban active, dependency audits clean).
- I found and fixed two concrete VPS hardening issues during this pass:
  - secrets file permissions (`/opt/bluesky-feed/.env`) were too open
  - app bind address was unnecessarily exposed (`0.0.0.0:3001`)
- Remaining highest-priority gap: the service still runs as `root` on VPS.

## Critical Findings

### SEC-001 (Fixed): Secrets file was world-readable on VPS
- Severity: Critical
- Location: `/opt/bluesky-feed/.env` (runtime host)
- Evidence:
  - Before: `644 root:root /opt/bluesky-feed/.env`
  - After: `600 root:root /opt/bluesky-feed/.env`
- Impact: any local user/process could read production secrets.
- Fix applied: `chmod 600 /opt/bluesky-feed/.env`.

## High Findings

### SEC-002 (Open): Service process runs as root
- Severity: High
- Location:
  - Unit file has no `User=` directive: [ops/bluesky-feed.service](ops/bluesky-feed.service):21
  - Runtime verification on VPS: `svc_user=root`
- Impact: app compromise can become full host compromise.
- Recommended fix:
  - run service as dedicated non-root user/group
  - set least-privilege filesystem access for app paths and `.env`
  - keep prestart dependency checks with explicit privileges only where required.

### SEC-003 (Fixed): App listener exposed beyond localhost
- Severity: High
- Location: VPS runtime `.env` (`FEEDGEN_LISTENHOST`)
- Evidence:
  - Before: `FEEDGEN_LISTENHOST=0.0.0.0`
  - After: `FEEDGEN_LISTENHOST=127.0.0.1`
  - Verified listener: `127.0.0.1:3001` only
- Impact: unnecessary attack surface if firewall/proxy rules drift.
- Fix applied: updated `.env`, restarted service, validated health.

## Medium Findings

### SEC-004 (Fixed): Branch protection was too permissive
- Severity: Medium
- Location: GitHub branch protection for `main`
- Evidence before:
  - required approvals: `0`
  - admins enforced: `false`
- Evidence after:
  - required approvals: `1`
  - admins enforced: `true`
  - strict checks + conversation resolution still enabled
- Impact: easier unreviewed changes to reach `main`.
- Fix applied via GitHub API.

### SEC-005 (Open): No explicit CSRF token mechanism for cookie-auth governance mutations
- Severity: Medium
- Location:
  - Cookie auth setup: [src/governance/routes/auth.ts](src/governance/routes/auth.ts):42
  - Mutation endpoint using cookie/bearer auth: [src/governance/routes/vote.ts](src/governance/routes/vote.ts):99
- Evidence:
  - authenticated mutations rely on session cookie + auth checks; no CSRF token/origin enforcement path found for vote/logout mutation routes.
- Impact: if `SameSite` policy is weakened/misconfigured in future, cookie-auth mutation endpoints become CSRF-prone.
- Recommended fix:
  - add CSRF token validation (double-submit or synchronizer token) for cookie-auth mutation routes
  - optionally enforce origin/fetch-metadata checks as defense in depth.

### SEC-006 (Pending Fix): Deploy workflow tests are environment-dependent on VPS production `.env`
- Severity: Medium (availability/integrity of delivery)
- Location: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):29
- Evidence:
  - repeated deploy failures in runs `23171200718`, `23171250974`, `23171295744`, `23171341498`, `23171392136`
  - failures were deterministic assertion mismatches (`5000` vs `2500`, `0.15` vs `0.25`)
- Impact: valid `main` changes repeatedly fail deployment pipeline.
- Remediation implemented in PR:
  - [PR #44](https://github.com/AndrewNordstrom/bluesky-community-feed/pull/44)
  - deploy tests now run with deterministic `.env.example` and restore production `.env` afterward.

## Low Findings

### SEC-007 (Open): SSH `X11Forwarding` enabled
- Severity: Low
- Location: VPS `/etc/ssh/sshd_config` (`X11Forwarding yes`)
- Impact: unnecessary SSH surface for a headless production service host.
- Recommended fix: set `X11Forwarding no` and reload sshd during maintenance window.

### SEC-008 (Verification Gap): Direct API read of code/dependabot/secret alerts returned 404
- Severity: Low (process visibility gap)
- Location: GitHub API access path used for audit
- Evidence:
  - `gh api .../code-scanning/alerts` -> 404
  - `gh api .../dependabot/alerts` -> 404
  - `gh api .../secret-scanning/alerts` -> 404
- Notes:
  - repository-level settings confirm security features enabled:
    - `secret_scanning`: enabled
    - `secret_scanning_push_protection`: enabled
    - `dependabot_security_updates`: enabled
  - likely token permission/scope limitation for alert listing.

## Validation Performed

- Live dependency audits:
  - root: `npm audit --audit-level=moderate` -> 0 high / 0 moderate
  - web: `npm audit --audit-level=moderate` -> 0 high / 0 moderate
- Runtime header checks (public):
  - CSP, HSTS, frame protections, nosniff present on `https://feed.corgi.network/`
- Runtime protection checks (VPS):
  - UFW active with default deny incoming
  - fail2ban active
  - Docker Postgres/Redis bound to loopback
  - app health endpoint returns healthy after hardening changes
- Auth surface check:
  - `/docs` returns `401` in production (admin-gated).

## Current Risk Status

- Immediate critical exposures addressed in this pass.
- Highest remaining hardening priority: run the feed service as non-root.
- Deploy reliability fix is ready in PR #44 and should be merged promptly.
