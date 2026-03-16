## What does this PR do?

<!-- Brief description of the change and why it's needed. -->

## Why now?

<!-- Link to Linear issue and motivation. Use: Fixes PROJ-42 or Closes LAB-17 -->

## Scope Guardrails

- [ ] One logical change only (single-sentence PR scope)
- [ ] Independently mergeable (main remains green after merge)
- [ ] No unrelated cleanup/refactor bundled in this PR
- [ ] Diff kept reviewable (target ~50-300 meaningful lines)
- [ ] Branch includes issue ID (e.g., `proj-42-short-description` or `lab-17-short-description`)

## Area

<!-- Check the primary area(s) affected -->
- [ ] Scoring
- [ ] Feed
- [ ] Governance
- [ ] Admin / CLI / MCP
- [ ] Ingestion
- [ ] Transparency
- [ ] Frontend
- [ ] Database / Migrations
- [ ] Tests
- [ ] Docs
- [ ] Build / Config

## Checklist

- [ ] PR title is imperative and specific (not "WIP" or "Various fixes")
- [ ] PR description includes: what, why, testing, reviewer focus
- [ ] PR description includes Linear close keyword (`Fixes PROJ-42` or `Closes LAB-17`)
- [ ] `npm run verify` passes
- [ ] `python3 -m py_compile scripts/generate-report.py scripts/generate-report-pdf.py scripts/report_utils.py` passes
- [ ] `MPLCONFIGDIR=/tmp python3 scripts/generate-report.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run` passes
- [ ] `MPLCONFIGDIR=/tmp python3 scripts/generate-report-pdf.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run` passes
- [ ] `npm audit --audit-level=moderate` passes
- [ ] `cd web && npm audit --audit-level=moderate` passes
- [ ] Migrations included for schema changes
- [ ] No hardcoded secrets, DIDs, or production domains
- [ ] Parameterized SQL only (no string interpolation)
- [ ] Scoring changes preserve full decomposition (raw, weight, weighted per component)
- [ ] `CHANGELOG.md` updated for user/operator-visible changes
- [ ] Notes included for operational or rollout impact
- [ ] CodeRabbit feedback addressed (or explicitly discussed in-thread if intentionally not changed)

## Related Issues

<!-- Closes #123, Fixes #456 -->
