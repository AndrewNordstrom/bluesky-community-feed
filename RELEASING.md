# Releasing

This project uses Semantic Versioning (`MAJOR.MINOR.PATCH`) and Keep a Changelog.

## Versioning Policy

- `PATCH` for bug fixes, docs-only operational fixes, and non-breaking dependency/security updates.
- `MINOR` for backward-compatible feature additions and new endpoints/tooling.
- `MAJOR` for breaking API/behavior changes or migration-required operator changes.

## Changelog Gate

Any user-visible, operator-visible, or contributor-visible change must add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) before merge.

Allowed omission:
- Internal refactors with zero observable behavior/tooling/docs impact.

## Pre-Release Checklist

Run from repository root:

```bash
npm run verify
npm run docs:verify
python3 -m py_compile scripts/generate-report.py scripts/generate-report-pdf.py scripts/report_utils.py
MPLCONFIGDIR=/tmp python3 scripts/generate-report.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run
MPLCONFIGDIR=/tmp python3 scripts/generate-report-pdf.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run
node scripts/audit-allowlist.mjs --workspace=root --audit-level=moderate
cd cli && node ../scripts/audit-allowlist.mjs --workspace=cli --audit-level=moderate
cd ../web && node ../scripts/audit-allowlist.mjs --workspace=web --audit-level=moderate
cd ../web-next && node ../scripts/audit-allowlist.mjs --workspace=web-next --audit-level=moderate
```

Before a release merge, inspect the live repository rulesets and deployment
workflow. A green PR is not permission to bypass an active emergency freeze.
The application deployment workflow requires a manual full-SHA dispatch, a
protected `production` environment approval, and the production enable flag;
merging to `main` does not deploy the application. Changes under
`docs/docs-site/**` do trigger the separate docs deployment workflow and need
their own production-mutation approval before merge.

## Release Procedure

1. Ensure `main` is green and branch protections are satisfied.
2. Confirm `CHANGELOG.md` has accurate `Unreleased` entries.
3. Create release PR (if needed) that:
   - bumps version(s),
   - moves `Unreleased` notes into a dated version section,
   - includes any migration/rollout notes.
4. Confirm the release PR's docs gate proves deterministic full/public/site
   OpenAPI artifacts, current health schemas, and no admin, debug, or
   loopback-only promotion route in either public artifact.
5. Confirm no emergency freeze is active and no docs-site mutation is included
   without its separate approval, then merge the release PR into `main`. Record
   the resulting full 40-character commit as `MERGED_SHA`.
6. Require successful post-merge CI for exactly `MERGED_SHA`. Stop on any failed,
   missing, skipped, or mismatched docs, build, test, lint, audit, or security
   receipt.
7. Only after a separate explicit production approval, enable production
   promotion if needed and dispatch `.github/workflows/deploy.yml` with
   `MERGED_SHA`; approve its protected `production` environment. Require its
   receipt to bind the built, deployed, and running revisions to `MERGED_SHA`
   and pass composite health.
   The loopback promotion probe is only one input; it never authorizes or proves
   a release on its own.
8. Tag the successfully promoted `MERGED_SHA` from `main`:

```bash
git checkout main
git pull
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

9. Publish GitHub release notes from the tag and include:
   - highlights,
   - migration notes,
   - rollback considerations.

## Cadence

- Target cadence: at least one release per month.
- Hotfix releases can happen any time for incidents/security issues.
