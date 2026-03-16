# Contributing

## Development Setup

1. Install dependencies:
```bash
npm install
cd web && npm install && cd ..
```
2. Configure environment:
```bash
cp .env.example .env
```
3. Start services:
```bash
docker compose up -d
```
4. Run migrations:
```bash
npm run migrate
```

## Useful Commands

- Build backend: `npm run build`
- Run backend tests: `npm test -- --run`
- Build frontend: `cd web && npm run build`
- Run frontend dev server: `cd web && npm run dev`
- Full local gate: `npm run verify`

## Project Structure

- `src/ingestion/`: Jetstream ingestion
- `src/scoring/`: scoring components + pipeline
- `src/governance/`: voting, aggregation, epoch lifecycle
- `src/feed/`: feed generator routes
- `src/admin/`: admin routes and status
- `src/transparency/`: public transparency APIs
- `web/`: React frontend

## Contribution Guidelines

- Keep core governance invariants intact (decomposed scores, epoch tagging, soft deletes)
- Add or update tests for behavior changes
- Avoid adding external API calls in feed serving paths
- Keep changes scoped and easy to review
- Follow issue label policy in [`docs/ISSUE_TRIAGE.md`](docs/ISSUE_TRIAGE.md)
- Follow release/changelog policy in [`RELEASING.md`](RELEASING.md)

## PR Guidelines (Required)

### PR Granularity

- One PR must represent one logical change.
- Target reviewable diffs (about 50-300 meaningful lines) whenever possible.
- Each PR must be independently mergeable with green checks on `main`.
- Do not bundle unrelated work (feature + refactor, bug fix + dependency cleanup, etc.).

### Branch Naming

- Include the Linear issue ID in branch names.
- Pattern examples:
  - `proj-42-implement-int8-matmul`
  - `lab-17-add-vote-normalization`

### PR Title and Description

- Use imperative, descriptive titles.
- PR description must include:
  - what this PR does
  - why this is needed (with Linear link/context)
  - testing performed
  - reviewer focus areas
- Include an auto-close keyword for Linear issue tracking (for example: `Fixes PROJ-42` or `Closes LAB-17`).

### CodeRabbit Review-Fix Loop

- Expect CodeRabbit auto-review on each PR.
- Address findings by pushing follow-up commits to the same branch.
- If you disagree with a finding, respond with rationale in the PR thread instead of dismissing silently.
- Iterate until findings are resolved and checks remain green.

### Sensitive Changes

- Security-sensitive changes (auth, input validation, data access) should be isolated in dedicated PRs.
- Add the `security` label in Linear for security-sensitive work.

## Adding A Votable Weight

1. Update backend parameter config in `src/config/votable-params.ts`.
2. Add any required schema/migration changes for new vote columns.
3. Wire scoring/aggregation consumers that depend on the new field.
4. Update frontend parameter config in `web/src/config/votable-params.ts`.
5. Run full verification (`npm run build`, `npm test`, `cd web && npm run build`).

## Pull Request Checklist

- `npm run verify` passes
- `python3 -m py_compile scripts/generate-report.py scripts/generate-report-pdf.py scripts/report_utils.py` passes
- `MPLCONFIGDIR=/tmp python3 scripts/generate-report.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run` passes
- `MPLCONFIGDIR=/tmp python3 scripts/generate-report-pdf.py --csv tests/fixtures/report/report-sample.csv --epoch-json tests/fixtures/report/epoch-sample.json --dry-run` passes
- `npm audit --audit-level=moderate` passes
- `cd web && npm audit --audit-level=moderate` passes
- `CHANGELOG.md` updated for user/operator-visible changes
- Migrations included for schema changes
- Notes included for operational or rollout impact
