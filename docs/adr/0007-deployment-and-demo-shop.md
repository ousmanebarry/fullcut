# ADR 0007: Deployment pipeline, security headers and the public demo shop

- Status: accepted
- Date: 2026-10-19

## Context

Fullcut goes live on Vercel (web) and Supabase cloud (database, auth). Schema changes and app code must ship in an order that never runs new code against an old schema, previews must never touch production data, and a stranger (for example a recruiter) should be able to click around a realistic shop without signing up.

## Decision

- **Environments:** local (Docker, `supabase start`), staging (a second free Supabase project, used by Vercel preview deployments), production. Supabase Branching was rejected because it is a paid feature.
- **Deploys:** `.github/workflows/deploy.yml` runs on every push to `main`: the full CI workflow (reused via `workflow_call`), then `supabase db push` to staging, then (after a required reviewer approves the `production` GitHub environment) `supabase db push` to production followed by `vercel build --prod` and `vercel deploy --prebuilt --prod`. `apps/web/vercel.json` turns off Vercel's own auto-deploy of `main`; PR previews still come from the Vercel Git integration. Deploys queue rather than cancel, so a migration is never interrupted. `seed.sql` is never pushed.
- **Migration rule:** because the schema ships before the code, migrations must be backward compatible with the previous app version (expand first, contract in a later release).
- **CSP without nonces:** nonce-based CSP needs every page dynamically rendered, which conflicts with `cacheComponents` / partial prerendering. The policy in `next.config.ts` therefore allows `'unsafe-inline'` scripts and styles, but restricts every origin: `connect-src` is self plus the Supabase project (https and wss), `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`. HSTS and `upgrade-insecure-requests` are only sent from Vercel (`VERCEL_ENV`), and the Vercel preview toolbar origins only on previews.
- **Secret scan:** `pnpm --filter web check:bundle` fails the build if `.next/static` contains a Supabase or Stripe secret-key pattern or the literal value of any server-only secret in the environment. It runs in CI and before every production deploy.
- **PWA:** a manifest (`start_url: /dashboard`, standalone), generated icons and a minimal service worker. The worker caches only content-hashed `/_next/static/*` files and icons, and falls back to `/offline.html` when a page load fails. It never caches API responses, RSC payloads, server actions or booking data.
- **Demo shop:** one shared, writable demo login.
  - `private.demo_config` (a schema the Data API never exposes) names the demo shop and its owner user. `private.configure_demo_shop(user, slug)` is run once by hand and refuses a user who belongs to any other shop, so a real owner can never be wiped.
  - `private.reset_demo_shop()` deletes the demo shop (cascading to all its data) and rebuilds it with fake data relative to today. pg_cron runs it nightly at 08:00 UTC.
  - Visitors may change bookings, clients, notes, staff and services. Triggers raise `demo_shop_locked` for signed-in changes to the shop row (slug, booking page) and memberships, so the public demo link cannot be hijacked.
  - "Open the demo dashboard" calls a server action that restores the demo user's email and password through the admin API before signing in, so a visitor who changes them locks nobody out. It is rate limited per IP (10/hour). The password lives only in a server env var and is never shown.
  - `public.is_demo_shop(shop_id)` lets later features opt out for the demo (Milestone 09 must never send SMS for the demo shop).

## Consequences

- Visitors' edits to the demo are visible to other visitors until the nightly reset; increase the cron frequency if that becomes a problem.
- All demo sign-ins come from Vercel's servers, so Supabase Auth's per-IP sign-in limit applies to the demo as a whole.
- Free Supabase projects pause after a week without activity; a paused staging project fails the `migrate-staging` job until it is restored in the dashboard.
- With `--prebuilt`, Vercel system env vars are not set at build time; the workflow sets `VERCEL_ENV=production` itself, and anything else the build needs must be set explicitly.
- Leaked-password protection in Supabase Auth requires the Pro plan, so its advisor warning is accepted on the free plan.
- Error monitoring (e.g. Sentry) is deferred; Vercel and Supabase logs are the only signal for now.
