# PROJ-2265 dependency remediation validation

Validation date: 2026-09-05
Base revision: `c703244da266679a289109871920d0320f14ebf3`

## Runtime Health Check

Repository validation used Node.js 20.19.0. The backend TypeScript build passes after numeric `TRUST_PROXY` hop counts were replaced with an explicit `TypeError` and migration guidance. IP/CIDR, named ranges, boolean aliases, and address lists retain their existing behavior.

No production endpoint, host, configuration, deployment, or freeze state was inspected or changed. Any deployed numeric `TRUST_PROXY` value requires migration to an explicit trusted proxy address or range before rollout.

## Deterministic Eval

- `npm run verify`: PASS with public `.env.example` values supplied to the process, excluding `NODE_ENV` so Vitest and Next.js select their normal modes. This includes docs verification, backend build, 157 test files / 2,155 tests, CLI build, SDK build and fixture compilation, legacy frontend lint/build, and Next.js static export.
- The existing `build:mcp-local` command reports that the optional `src/mcp-local` directory is absent and skips its build; no new skip was introduced.
- Focused security defaults suite: 11 / 11 PASS, including six numeric forms and trusted/untrusted peer injection cases with the installed Fastify package.
- All four shipped workspace moderate-threshold audit guards: PASS (root, CLI, web, web-next).
- All four raw `npm audit --omit=dev --audit-level=moderate` checks: PASS, zero reported vulnerabilities.
- Earlier candidate clean installs under Node.js 20.19.0 passed in all four workspaces; manifests and lockfiles were unchanged during this compatibility repair.
- `git diff --check`: PASS.
- Audit guard is byte-identical to the base; SHA-256 `8279603234edd2284d4bbf24f2969940ae2d1c9bfbf298f6eff1d20f04c9bc8e`.

The initial reproduction failed with TS2769 at `src/feed/server.ts` because the parser returned `number` while Fastify 5.12.1 no longer supports it. The final build succeeds and numeric configurations throw before Fastify construction. Real injection tests verify that untrusted immediate peers cannot override forwarded IP, host, or protocol, while trusted peers retain that behavior.

Two validation harness failures were resolved without product changes: the sandbox denied localhost listeners (`listen EPERM`), and exporting development `NODE_ENV` into Next.js caused a prerender failure. The final full run permitted local test networking and let each tool select its standard mode.

## Live Acceptance

Local CodeRabbit review completed with no high or medium findings. Its single trivial suggestion was an additional trusted-CIDR test; existing tests already exercise the address-list configuration and the boundary review independently exercised address variants, so no implementation change was warranted. Independent candidate review reported no concrete bypass or regression.

Hosted CI and exact-head hosted review remain pending. This receipt does not establish merge, deployment, or production readiness.

### Automation Summary

The candidate contains the targeted dependency upgrades/lockfile refreshes, numeric proxy compatibility repair, regression coverage, and changelog migration guidance. Audit exceptions remain unchanged.

An authorized comment-only correction to `.env.example` remains unapplied: admission rejected the path as `proposed_claimed_paths:credential_path:.env.example`. The current example still lists the unsupported value `"1"`; its actual `loopback` default remains supported. This documentation blocker must be resolved through the admission policy before release; it was not bypassed.
