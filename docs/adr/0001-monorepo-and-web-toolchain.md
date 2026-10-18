# ADR 0001: Monorepo and web toolchain

- Status: accepted
- Date: 2026-10-18

## Context

Fullcut needs a Next.js web app now and, later, a Python ML service and Supabase migrations in the same repository (see "Repository layout" in `.github/AGENTS.md`). We want one install, one set of root commands and a CI check on every pull request.

## Decision

- **pnpm workspaces** monorepo (`pnpm-workspace.yaml`), pnpm version pinned via `packageManager`. JS workspace packages live in `apps/*`.
- **Node 24** pinned in `.nvmrc`; CI reads the same file.
- **apps/web**: Next.js (App Router), TypeScript `strict` plus `noUncheckedIndexedAccess`, Tailwind CSS v4, shadcn/ui (`base-nova` preset on Base UI), ESLint flat config from `eslint-config-next` with `no-explicit-any` as an error.
- **Tests**: Vitest for unit tests (`apps/web/tests/unit`), Playwright for e2e (`apps/web/tests/e2e`) with a desktop and a mobile (Pixel 7) project, since the booking page is mobile-first.
- **Typecheck** runs `next typegen` before `tsc --noEmit` so Next's generated route types (e.g. `LayoutProps`) exist without a full build.
- **CI** (GitHub Actions, pull requests): install with a frozen lockfile, then lint, typecheck and unit tests. E2E is not in CI yet.
- Root scripts delegate to `apps/web` with `pnpm --filter web`.

## Consequences

- Contributors need Node 24 and pnpm (via Corepack or a global install).
- The ML service (`services/ml`) will be a Python project managed by `uv`, outside the pnpm workspace; CI will need a separate job for it.
- E2E tests must be run locally until they are added to CI; this should happen once the booking flow exists.
