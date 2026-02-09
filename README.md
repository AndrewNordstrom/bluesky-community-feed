# Community-Governed Bluesky Feed

A Bluesky custom feed where the community votes on ranking behavior.

This project combines:
- Governance voting for algorithm weights and content rules
- A scoring pipeline that stores decomposed component scores
- A feed generator endpoint that serves ranked post URIs

## Quick Start

1. Install dependencies:
```bash
npm install
cd web && npm install && cd ..
```
2. Copy environment config:
```bash
cp .env.example .env
```
3. Start local services:
```bash
docker compose up -d
```
4. Run database migrations:
```bash
npm run migrate
```
5. Build and run:
```bash
npm run build
npm run dev
```

For the web app:
```bash
cd web
npm run dev
```

## Architecture

```text
GOVERNANCE (voting UI) -> epoch weights/content rules
    |
    v
SCORING PIPELINE (batch) -> post_scores + ranked Redis feed
    |
    v
FEED SERVING (getFeedSkeleton) -> Bluesky clients
```

## Key Paths

- Backend app: `src/`
- Governance logic: `src/governance/`
- Scoring pipeline: `src/scoring/`
- Feed serving: `src/feed/`
- Admin routes: `src/admin/routes/`
- Frontend app: `web/`

## Safety Invariants

- Every score is decomposed per component (not only `total_score`)
- Every score row is tagged with `epoch_id`
- Soft-delete behavior is used for ingestion entities
- `getFeedSkeleton` does not call external APIs
- Governance audit log is append-only

## Documentation

- Technical spec: `docs/IMPLEMENTATION_SPEC.md`
- Admin UX spec: `docs/ADMIN_DASHBOARD_SPEC.md`
- System overview: `docs/SYSTEM_OVERVIEW.md`
- Deployment guide: `docs/DEPLOYMENT.md`
- Security guide: `docs/SECURITY.md`

## Plan V1 Hardening Tracker

Execution branch: `codex/no-drift-hardening-v1`

- [x] Phase 0 baseline captured
- [ ] Phase 1 critical integrity fixes
- [ ] Phase 2 perimeter and validation hardening
- [ ] Phase 3 runtime resilience
- [ ] Phase 4 ops correctness fixes
- [ ] Phase 5 frontend quality/security cleanup

Baseline gate snapshot (Phase 0):
- Backend build: pass (`npm run build`)
- Backend tests: pass (`CI=1 npm test -- --run`)
- Web build: pass (`cd web && npm run build`)
- Web lint: fail with pre-existing issues (`cd web && npm run lint`)

## Contributing

See `CONTRIBUTING.md`.

## License

MIT. See `LICENSE`.
