---
name: community-feed
description: Complete implementation specification for the community-governed Bluesky feed generator. Use when implementing any layer of the feed system, writing database schemas, scoring components, API endpoints, or governance logic. Contains working TypeScript code patterns, exact database schemas, and API contracts.
---

# Community Feed Implementation Spec

The full specification is in `docs/IMPLEMENTATION_SPEC.md` (2,500+ lines). This skill provides navigation guidance.

## When to Read Which Section

| Working on... | Read spec section |
|---|---|
| Project setup, dependencies, env vars | §3, §4, §5, Appendix A (Config Validation) |
| Database schemas, migrations | §6 (all four migrations + seed data) |
| Jetstream connection, event handling | §7 (all subsections) |
| Scoring components, pipeline | §8 (Orchestrator + all 5 component implementations) |
| getFeedSkeleton, pagination | §9 (API contract, cursor strategy, routes) |
| Governance voting, epochs | §10 (lifecycle, aggregation, epoch manager, vote API) |
| Transparency, explainability | §11 (post explanation, feed stats) |
| Authentication, DID management | §12 (did:plc, JWT verification, governance auth) |
| Error handling, resilience | §13 (reconnection, DB handling, process errors) |
| Rate limits, API constraints | §14 (Bluesky limits, strategy) |
| Deployment, Docker | §16 (Docker Compose, production, publish feed script) |
| Implementation order | §17 (6 phases with checkboxes) |
| Critical rules reference | §18 (10 non-negotiable rules) |

## How to Use
Read the relevant section of `docs/IMPLEMENTATION_SPEC.md` using bash:
```bash
# Read a specific section (e.g., Scoring Pipeline)
sed -n '/^## 8\. Layer 2/,/^## 9\./p' docs/IMPLEMENTATION_SPEC.md
```

The spec contains complete, working TypeScript code patterns for every component. Use them as the starting point rather than writing from scratch.
