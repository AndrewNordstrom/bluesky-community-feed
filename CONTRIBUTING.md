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
- Run backend tests: `npm test`
- Build frontend: `cd web && npm run build`
- Run frontend dev server: `cd web && npm run dev`

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

## Adding A Votable Weight

1. Update backend parameter config in `src/config/votable-params.ts`.
2. Add any required schema/migration changes for new vote columns.
3. Wire scoring/aggregation consumers that depend on the new field.
4. Update frontend parameter config in `web/src/config/votable-params.ts`.
5. Run full verification (`npm run build`, `npm test`, `cd web && npm run build`).

## Pull Request Checklist

- `npm run build` passes
- `npm test` passes
- `cd web && npm run build` passes (when frontend changes)
- Migrations included for schema changes
- Notes included for operational or rollout impact
