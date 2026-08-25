# PROJ-2225 Acceptance Receipt

[VALIDATION RECEIPT] ops/receipts/2026-08-25/PROJ-2225/acceptance-receipt.md

Issue: PROJ-2225 — Semantically refresh release docs and health OpenAPI
Date: 2026-08-24 (America/Los_Angeles)
Repository: `andrewnordstrom-eng/corgi`
Branch: `dev/PROJ-2225-m0-docs-semantically-refresh-release-docs-and-health-openapi`
PR: https://github.com/andrewnordstrom-eng/corgi/pull/394
Merge commit: not merged yet; normal branch protections and exact-head convergence remain authoritative.
CodeRabbit final state: local and hosted review findings on composed-enum handling, byte-level artifact equality, full-to-public operation completeness, invalid-reference propagation, inherited path parameters, and the `/health` revision contract were fixed with focused regressions; hosted incremental review is pending the final fix push.
Known warnings: forcing the unstamped source test process to `NODE_ENV=production` makes promotion-readiness tests fail closed because no production release artifact exists. The repository's canonical CI command does not force that invalid state and passes in full.

## Runtime Health Check

- No deployment, migration, service restart, workflow dispatch, credential change, or production docs publication was performed.
- The full, public, and docs-site OpenAPI artifacts were regenerated from the current server source.
- The public and docs-site artifacts are byte-identical.
- The public artifacts exclude admin, debug, and loopback-only `/health/promotion-ready` routes.
- The public `/health` schema includes the nullable full-SHA `revision`; `/health/live` and `/health/ready` response enums match current route schemas.

## Deterministic Eval

- `npm run docs:verify` passed: 15 tracked documents and 37 Markdown files scanned.
- Focused docs and generator-cleanup suite passed: 3 files, 56 tests.
- Canonical `npm run verify` passed: 157 test files and 2,147 tests, plus backend TypeScript, CLI, SDK, external SDK fixture, legacy frontend lint/build, and canonical Next.js build.
- Root, CLI, legacy web, and `web-next` audit-allowlist gates passed at the moderate threshold.
- Report-script compilation and both offline dry runs passed.
- Regeneration matched the committed full/public artifacts, public/site byte comparison passed, and `git diff --check` passed.

## Live Acceptance

- PR #394 is rebased onto current `main` and contains only issue-scoped commits.
- The release and operations prose reflects the merged manual exact-SHA promotion gateway rather than the obsolete pre-#385 push-triggered workflow.
- GitHub CI, hosted CodeRabbit exact-head review, required human approval, normal merge, and post-merge closeout remain pending and must not be represented as complete.
- No admin bypass is authorized or used.

### Automation Summary

The guard validates public/site byte-equivalence, restricted-route exclusion,
public/full operation and inherited path-parameter parity, health-response
status enums, and the required nullable full-SHA `/health` revision. Local JSON
references and composed schemas are resolved without recursion loops; invalid
references fail closed, `allOf` status constraints intersect, and `anyOf` and
`oneOf` retain union behavior.
The Apache-2.0 consistency guard already on `main` remains intact.

## Validation

PR: https://github.com/andrewnordstrom-eng/corgi/pull/394
Merge commit: not merged yet; record the squash merge SHA in the authoritative Linear closeout after normal merge.
CodeRabbit final state: all six valid hosted guard findings are addressed; the repository-identity sweep was left to overlapping PR #387 to avoid cross-packet churn; hosted incremental state is pending the final fix push.
Known warnings: exact-head hosted checks and review have not run on the final local patch yet; this receipt records local pre-push evidence only.
