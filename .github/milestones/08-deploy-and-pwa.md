# Milestone 08 — Deploy, PWA and CI/CD

**Goal:** Fullcut runs on the internet with a real URL, deploys automatically, and the dashboard installs on a phone or iPad like an app. Deploying now (before messaging and ML) gives you a live demo early and catches production-only problems while the app is small.

**Depends on:** 07
**Skills to read:** `fullcut-data-and-tenancy`

## Manual steps for the human (agent should list these, not do them)

- Create a Supabase cloud project (Canada region if available, otherwise nearest).
- Create a Vercel project linked to the GitHub repo.
- Add production environment variables in Vercel (from `.env.example`).
- Buy/point a domain if wanted (optional).

## In scope

- Production database migrations workflow
- Vercel deployment and preview deployments
- PWA manifest, icons, installability
- Error monitoring and basic security headers

## Tasks

### 8.1 Database deployment

1. Document the flow: `supabase link` → `supabase db push` for migrations. Never run seed data in production.
2. CI job on `main`: apply migrations to production after tests pass (or a manual "deploy DB" workflow with approval — recommend one).
3. Run Supabase's security and performance advisors against the cloud project; fix any RLS or index warnings.

### 8.2 Web deployment

- Vercel production from `main`, previews for PRs. Preview deployments should point at a separate Supabase project or branch, never production data.
- Auth redirect URLs configured for production and preview domains.

### 8.3 Demo shop

- A production "demo" shop with synthetic data and a read-only demo login (or a reset-nightly demo), so recruiters can click around safely. Separate from real shops.

### 8.4 PWA

- Web app manifest (name "Fullcut", short name, theme colours, icons 192/512 + maskable, `start_url: /dashboard`, `display: standalone`).
- Apple touch icons and meta tags for iOS home-screen install.
- Minimal service worker: offline fallback page and static asset caching only. Do **not** cache API responses or booking data.
- Install prompt hint in the dashboard for first-time users on mobile.

### 8.5 Observability and security

- Error monitoring (e.g. Sentry) for web; scrub personal data (names, phones, emails) from events.
- Security headers: CSP (allow Supabase), `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, HSTS.
- Check that no server secrets are in the client bundle (search build output for key prefixes).

### 8.6 CI/CD polish

- Required checks on PRs: lint, typecheck, unit, DB tests, e2e (against a preview or local stack).
- README: setup steps, scripts, architecture diagram, environments table.

## Acceptance criteria

- Pushing to `main` deploys; PRs get preview URLs.
- The dashboard installs to an iPhone/Android home screen and opens full-screen.
- Supabase advisors show no security warnings.
- The demo shop is browsable by a stranger without signing up.

## Agent prompt

```
Read .github/AGENTS.md and .github/milestones/08-deploy-and-pwa.md. First list
the manual steps I need to do in Supabase/Vercel dashboards and the env vars
needed. Then plan the CI workflows, PWA files and headers. Wait for my OK
before changing workflows. Implement, then give me a deployment checklist.
```
