# AGENTS.md — Fullcut

Guidance for AI coding agents working in this repository. Read this file fully before making changes, then read the skill for the area you are touching (see "Skills" below).

This file lives at `.github/AGENTS.md`. All paths below are relative to the repository root, not to `.github/`.

---

## What Fullcut is

Fullcut is a booking and scheduling web app for **independent barbers and stylists who already have their own clients** (1–6 chairs).

**Pitch:** flat price, zero commission, your clients stay yours, and the app actively fills your chair.

It competes with Square Appointments, Booksy, Fresha, Vagaro and StyleSeat. Those platforms frustrate established professionals with new-client commissions (often ~20–30% of a first booking), fees charged on clients the stylist found themselves, add-on pricing that hides the real monthly cost, and marketplaces that list the shop's clients next to competitors. Fullcut exists to be the opposite.

### Differentiating features

1. **No-show prediction** — every booking gets a risk score; only risky bookings get extra friction (confirmation text, confirm-or-release, standby suggestions).
2. **Waitlist refill** — when a slot frees up, matching waitlisted clients get a text and the first to tap books it.
3. **"Who's due" rebooking** — learns each client's visit rhythm and nudges them with open slots when they are overdue.
4. **Honest source tracking** — every booking records where it came from (Instagram link, referral code, Google, returning client).
5. **Learned service durations + gap-aware slots** — learns how long each stylist really takes per service and suggests times that avoid dead gaps.
6. **Zero double bookings, guaranteed** — enforced at the database level.
7. **One-click migration** — import clients, services and history from competitor exports.
8. **Branded booking page** the shop controls — no marketplace, no competitor listings, full data export.

---

## Product principles (non-negotiable)

1. **No commission on clients. Ever.** Do not build marketplaces, competitor listings, "new client fees", or any logic that charges a shop based on where a client came from.
2. **Honest pricing.** Any fee is shown before it is charged. Fullcut does not take payments from clients (no deposits, cards on file or refunds).
3. **The shop owns its data.** A full CSV export of clients, services and bookings must always work. Never add features that lock data in.
4. **Frictionless client booking.** No account required, no app download, mobile-first, three steps or fewer: service → time → confirm.
5. **Smart features assist; the owner decides.** Every automated action (confirm-or-release, waitlist offer, rebooking nudge) can be turned off per shop and overridden per booking.
6. **ML is advisory.** If scoring fails or is slow, the booking still succeeds. Never block a client because of a model.

If a request conflicts with these principles, stop and ask the human before implementing it.

---

## Architecture

```
 Clients (phone browser)            Owners/staff (PWA on iPad/phone)
          │                                       │
          └──────────────────┬────────────────────┘
                             ▼
                 Next.js app (UI + API routes)
                             │
     ┌──────────────┬────────┴───────┬──────────────────┐
     ▼              ▼                ▼                  ▼
  Postgres      Background jobs   ML service        Twilio
  (Supabase)    (reminders,       (Python,          (SMS, replies,
                 waitlist offers,  FastAPI)          webhooks back in)
                 retraining)
```

| Concern                            | Choice                                                                |
| ---------------------------------- | --------------------------------------------------------------------- |
| Web app (booking page + dashboard) | Next.js (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui    |
| Owner/staff app                    | Same Next.js app, installable as a PWA                                |
| Database + auth                    | Supabase (Postgres, Auth, row-level security)                         |
| Background jobs                    | Supabase cron (pg_cron) or a job runner such as Inngest / Trigger.dev |
| SMS                                | Twilio (Messaging Service, two-way replies)                           |
| ML                                 | Python service with FastAPI, scikit-learn / LightGBM                  |
| Hosting                            | Vercel (web), Railway or Fly.io (ML service)                          |

---

## Repository layout (planned)

```
fullcut/
├── .github/
│   ├── AGENTS.md             # this file
│   └── skills/               # agent skills, one folder per skill (see "Skills" below)
│       └── <skill-name>/SKILL.md
├── apps/
│   └── web/                  # Next.js app: public booking pages + shop dashboard
│       ├── app/
│       │   ├── (auth)/       # /login, /signup and their server actions
│       │   ├── auth/callback/ # email-link (PKCE / token hash) handler
│       │   ├── onboarding/   # first-run shop setup wizard
│       │   ├── [shopSlug]/   # public booking page per shop
│       │   ├── dashboard/    # authenticated owner/staff area (settings/ for shop setup)
│       │   └── api/          # route handlers: public/, manage/, waitlist/{claim,leave}, jobs/tick (pg_cron caller), webhooks/twilio/{status,inbound}
│       ├── proxy.ts          # session refresh + signed-in/out redirects (Next 16 "middleware")
│       ├── next.config.ts    # security headers (CSP etc.)
│       ├── public/           # sw.js (static-asset + offline-page cache only), offline.html
│       ├── components/ui/    # shadcn/ui components
│       ├── lib/              # domain logic (auth, booking engine, public booking, dashboard, clients, export, messaging, money, shop settings, supabase clients, time)
│       └── tests/            # unit/ (Vitest), db/ (Vitest against local Supabase), e2e/ (Playwright)
├── services/
│   └── ml/                   # FastAPI scoring service + training pipeline
├── supabase/
│   ├── migrations/           # SQL migrations (append-only)
│   ├── tests/                # database tests (RLS, constraints)
│   └── seed.sql              # fake demo data only
└── docs/
    └── adr/                  # architecture decision records
```

Update this section if the real layout differs.

---

## Commands

Run from the repository root (Node 24 per `.nvmrc`, pnpm pinned in `package.json`). Root scripts delegate to `apps/web`.

```bash
pnpm install                 # install JS dependencies
pnpm dev                     # run the web app locally (http://localhost:3000)
pnpm jobs:dev                # tick /api/jobs/tick every 15 s locally (needs JOBS_SECRET in apps/web/.env.local)
pnpm lint                    # ESLint
pnpm typecheck               # next typegen && tsc --noEmit
pnpm test                    # Vitest unit tests (apps/web/tests/unit)
pnpm test:e2e                # Playwright e2e, desktop + mobile projects (starts `next dev` itself; needs db:start + apps/web/.env.local)

pnpm --filter web exec playwright install chromium   # one-time: download the e2e browser
pnpm --filter web exec shadcn add <component>        # add a shadcn/ui component

pnpm db:start                # local Supabase via Docker (ports 553xx; Studio http://127.0.0.1:55323)
pnpm db:stop
pnpm db:reset                # rebuild local DB from migrations + seed
pnpm db:test                 # pgTAP tests (supabase/tests) + DB integration tests (apps/web/tests/db: concurrency, settings authz)
pnpm db:types                # regenerate + format apps/web/lib/database.types.ts
pnpm exec supabase migration new <name>
```

CI (`.github/workflows/ci.yml`) runs `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, a build and the client-bundle secret scan (`pnpm --filter web check:bundle`) on pull requests, plus a `database` job (`supabase start`, `db:reset`, `db:test`) and an `e2e` job (Playwright against `next build` + `next start`, with `DEMO_*` set so the demo spec runs).

Deploys (`.github/workflows/deploy.yml`, on push to `main`): CI again → `supabase db push` to staging → approval → `supabase db push` to production → `vercel build` / `vercel deploy --prebuilt --prod`. Migrations ship before code, so they must work with the previous app version. See `docs/adr/0007-deployment-and-demo-shop.md` for headers, the PWA service worker rules and the demo shop.
Background jobs and SMS (`docs/adr/0008-background-jobs-and-messaging.md`): a `bookings` trigger queues texts in `scheduled_messages`; pg_cron + pg_net POST `/api/jobs/tick` every minute (no-op until the `jobs_tick_url` / `jobs_secret` Vault secrets exist). `MESSAGING_MODE=log` (default) never contacts Twilio. Send-time rules live in `apps/web/lib/messaging/rules.ts`, templates in `templates.ts`. New periodic work belongs in the tick route, not a new cron job.
Waitlist refill (`docs/adr/0009-waitlist-refill.md`): a `bookings` trigger queues `freed_slots`; the tick runs `lib/waitlist/refill.ts` (pure matcher in `match.ts`) before the message worker. Claim links are `/w/<token>` (claims on POST only), view/leave links `/wl/<token>`.

> Not available yet (`services/ml/` does not exist). Intended commands once it does:

```bash
cd services/ml && uv run pytest        # ML tests
cd services/ml && uv run fastapi dev   # run scoring service locally
```

---

## Critical invariants

Breaking any of these is a serious bug. Tests must cover each one.

1. **Tenant isolation.** Every tenant-owned table has `shop_id uuid not null`, has row-level security enabled, and has policies that restrict access to members of that shop. Never query tenant data with the service-role key from client-reachable code paths without an explicit `shop_id` filter that was derived server-side.
2. **No double bookings.** A Postgres exclusion constraint on each staff member's blocked time range makes overlapping active bookings impossible. Application checks are for nice error messages only; the database is the source of truth. Catch SQLSTATE `23P01` and return a "slot just taken" response.
3. **Time.** Store instants as `timestamptz` (UTC). Each shop has an IANA timezone (e.g. `America/Toronto`). Generate slots and render times in the shop's timezone. Availability rules (e.g. "Tue 09:00–17:00") are stored as local wall-clock times. Every slot-generation change needs DST-transition tests.
4. **Money.** Integer cents plus an ISO currency code (default `CAD`). Never use floats for money. Format only at the UI edge.
5. **Webhooks.** Verify signatures (Twilio) using the raw request body. Process each provider event at most once (store processed event IDs). Handlers must be safe to retry.
6. **Contact data.** Phone numbers stored in E.164 format; emails trimmed and lowercased.
7. **Secrets.** The Supabase service-role key and Twilio auth token are server-only. Never put them in `NEXT_PUBLIC_*` variables, client components or logs.
8. **Messaging consent.** Transactional messages (confirmations, reminders for a booked appointment) are separate from marketing messages (rebooking nudges, promotions). Marketing messages require recorded opt-in consent and an unsubscribe path. Respect STOP replies immediately. Respect quiet hours in the shop's timezone.
9. **ML never blocks.** Scoring is called with a short timeout; on failure the booking proceeds with `risk_score = null` and default (non-friction) handling.
10. **Demo shop.** The shop where `public.is_demo_shop(shop_id)` is true is public and reset nightly: never send real SMS/email for it.

---

## Coding conventions

**TypeScript / Next.js**

- `strict` mode; no `any` (use `unknown` and narrow). No non-null assertions without a comment explaining why.
- Validate every external input (forms, route handlers, webhooks, imports) with `zod` at the boundary.
- Domain logic lives in `apps/web/lib/` as plain, testable functions. Route handlers and server actions stay thin.
- Prefer server components; use client components only for interactivity.
- Use generated Supabase types; do not hand-write table types.
- Accessibility: WCAG 2.1 AA. Keyboard-operable booking flow, visible focus, labelled inputs, sufficient contrast. The public booking page must work well on a small phone screen.
- Dates: use a timezone-aware library (e.g. `date-fns-tz` or Luxon); never do timezone math by hand with offsets.

**SQL / Supabase**

- Schema changes only through new migration files. Never edit a migration that has been applied anywhere.
- Every new tenant table: `shop_id`, RLS enabled, policies, and a test proving another shop cannot read or write it.
- Name constraints explicitly so errors are recognisable.

**Python (ML service)**

- Type hints everywhere, `pydantic` models for request/response, `ruff` for lint/format, `pytest` for tests.
- Training code and serving code share feature-building functions so features cannot drift.

---

## Testing expectations

| Area           | Tests required                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Booking engine | Unit tests for slot generation incl. DST days, buffers, time off, lead time; concurrency test proving two simultaneous bookings for one slot cannot both succeed |
| Database       | RLS tests (cross-shop access denied), constraint tests                                                                                                           |
| Messaging      | Webhook signature rejection, idempotent replays, consent and quiet-hours rules                                                                                   |
| Booking flow   | Playwright e2e: book as a client on a mobile viewport; claim a waitlist offer                                                                                    |
| ML             | Feature tests (no leakage), metrics regression test against a fixed holdout                                                                                      |

Never use real customer data in tests, fixtures or seeds. Generate fake data.

---

## Skills

Skills live in `.github/skills/<skill-name>/SKILL.md`. Before working in an area, read its skill:

| Area                                                                         | Skill                      |
| ---------------------------------------------------------------------------- | -------------------------- |
| Slots, availability, creating/changing bookings, statuses, waitlist matching | `fullcut-booking-engine`   |
| Schema, migrations, RLS, multi-tenancy, generated types                      | `fullcut-data-and-tenancy` |
| Twilio SMS, confirm-or-release, waitlist offers, webhooks, consent           | `fullcut-messaging`        |
| No-show model, "who's due", learned durations, ML service                    | `fullcut-noshow-ml`        |
| Importing data from Square, Vagaro, Fresha, Booksy                           | `fullcut-client-import`    |

---

## How to work in this repo

1. Restate the task and the invariants it touches before coding.
2. Keep changes small and focused; one concern per change.
3. Run lint, typecheck and the relevant tests before calling a task done. Report what you ran and the results.
4. Write or update tests in the same change as the code.
5. Record significant decisions in `docs/adr/` (short: context, decision, consequences).

**Ask the human before:**

- Changing pricing, fees, or anything about how Fullcut makes money
- Collecting any payment from clients (deposits, cards on file)
- Adding a heavy dependency or a new external service
- Destructive migrations (dropping columns/tables, rewriting data)
- Anything that would send real SMS (use Twilio test credentials in development)
- Relaxing an invariant above

---

## Glossary

| Term               | Meaning                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Shop               | A business account (tenant). Has a slug, timezone, currency.                                                              |
| Staff              | A barber/stylist who takes bookings. Belongs to one shop.                                                                 |
| Member             | A login user with access to a shop (`owner` or `staff` role).                                                             |
| Service            | Something bookable: name, duration, buffer, price.                                                                        |
| Booking            | A client's appointment. Statuses: `confirmed`, `completed`, `cancelled`, `no_show`.                                       |
| Blocked range      | Time a booking occupies on the calendar: start until end plus buffer.                                                     |
| Risk score         | Model estimate (0–1) that a booking will be a no-show.                                                                    |
| Risk tier          | `low` / `medium` / `high`, derived from the risk score with shop-configurable thresholds.                                 |
| Confirm-or-release | A risky booking must be confirmed by a deadline; if not, it's flagged, or released to the waitlist if the owner opted in. |
| Waitlist entry     | A client asking to be texted when a matching slot opens (service, staff, dates, times).                                   |
| Slot offer         | A text offering a freed slot to waitlisted clients; the first to tap books it.                                            |
| Standby            | A waitlisted client suggested for a slot that is likely to open up (an unconfirmed risky booking).                        |
| Due list           | Clients past their usual rebooking interval with no future booking.                                                       |
| Source             | Where a booking came from (link, referral code, Google, returning, import).                                               |

---

## Definition of done

- The feature works end-to-end in local dev.
- Lint, typecheck and tests pass; new behaviour has tests.
- Invariants above still hold (and are tested where touched).
- Migrations are new files, types regenerated.
- UI is usable on a phone viewport and keyboard-accessible.
- No secrets, real customer data or debug logging of personal data committed.
