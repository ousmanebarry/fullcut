# Milestone 02 — Database foundation

**Goal:** a local Supabase database with Fullcut's core schema, tenant isolation enforced by RLS, double bookings made impossible by a constraint, fake seed data, generated types, and tests proving all of it.

**Depends on:** 01 (scaffold)
**Skills to read:** `fullcut-data-and-tenancy` (primary), `fullcut-booking-engine` (statuses)

## In scope

- `supabase init`, local config, first migration(s)
- Core tables, constraints, RLS helpers and policies
- Seed data, database tests, concurrency test, generated types
- CI job that runs database tests

## Out of scope

- Any UI, auth screens or API routes
- Twilio and ML columns beyond those already in the skill's schema

## Tasks

### 2.1 Supabase setup

1. Run `supabase init` at the repo root.
2. Confirm `supabase start` works locally and note the local URLs/keys in `.env.example` (names only).
3. Add root scripts: `db:start`, `db:stop`, `db:reset`, `db:test`, `db:types`.

### 2.2 Core schema migration

1. `supabase migration new core_schema`.
2. Create, following the skill: `shops`, `shop_members`, `staff`, `services`, `clients`, `bookings`, `availability_rules`, `time_off`, `webhook_events`.
3. Enable `btree_gist`; add the `bookings_no_overlap` exclusion constraint on `(staff_id, during)` for `confirmed` bookings only.
4. Add `created_at` to every table and `updated_at` with a trigger where rows are edited (shops, staff, services, clients, bookings).
5. Indexes: `bookings (shop_id, starts_at)`, `bookings (client_id, starts_at)`, `clients (shop_id, lower(name))`, `availability_rules (staff_id, weekday)`, `time_off (staff_id, starts_at)`.
6. Integrity guard: a booking's `staff_id`, `service_id` and `client_id` must belong to the same `shop_id` as the booking. Enforce with composite foreign keys (`(shop_id, staff_id) references staff(shop_id, id)` etc., which need `unique (shop_id, id)` on the parent tables) or a trigger. Pick one and note it in an ADR.

### 2.3 RLS

1. Helper functions `public.is_shop_member(uuid)` and `public.is_shop_owner(uuid)` (security definer, empty `search_path`, `(select auth.uid())`).
2. Enable RLS on every table in the same migration.
3. Policies:
   - Members can select/insert/update/delete rows of their shop for: staff, services, clients, bookings, availability_rules, time_off.
   - Only owners can update `shops` and manage `shop_members`.
   - Members can select their own shop row and member list.
   - `webhook_events`: RLS on, no policies (service role only).
   - `anon` gets **no** direct table access.
4. Revoke default broad grants if needed so only intended roles have access.

### 2.4 Seed data (`supabase/seed.sql`)

- Two shops in `America/Toronto`: "Demo Barbers" (slug `demo-barbers`, 3 staff) and "Other Shop" (1 staff), used for isolation checks.
- 4–5 services per shop with realistic durations/buffers/prices in cents.
- Weekly availability (e.g. Tue–Sat 09:00–18:00, staggered per staff).
- ~30 fake clients (`+1 555 …` numbers, `example.com` emails).
- ~2 months of past bookings (mostly `completed`, ~8–12% `no_show`, some `cancelled`) and ~2 weeks of future `confirmed` bookings, none overlapping.
- Two auth users: one owner per shop, with known dev-only passwords, documented in the README as local-only.

### 2.5 Database tests (`supabase/tests/`, run with `supabase test db`)

1. For **every** tenant table: shop A's owner cannot select, insert, update or delete shop B's rows; can do so for their own.
2. `anon` cannot read any table.
3. Exclusion constraint: overlapping active bookings rejected (incl. overlap only within the buffer); back-to-back allowed; overlapping `cancelled`/`completed` allowed; same time for two different staff allowed.
4. Check constraints: negative prices, `starts_at >= ends_at`, invalid status are rejected.
5. Cross-shop integrity: a booking referencing another shop's staff/service/client is rejected.

### 2.6 Concurrency test

- An integration test (Vitest, using `pg` or the Supabase client against the local DB) fires ~10 simultaneous inserts for the same staff and slot. Exactly one succeeds; the rest fail with SQLSTATE `23P01`.

### 2.7 Types and CI

1. Generate `apps/web/lib/database.types.ts`; add `pnpm db:types`.
2. CI job: install Supabase CLI, `supabase start`, `supabase db reset`, `supabase test db`, run the concurrency test. Keep it a separate job so web CI stays fast.

## Acceptance criteria

- `pnpm db:reset` builds the DB from scratch with seed data, no errors.
- `pnpm db:test` passes; the concurrency test passes.
- Generated types are committed and the web app typechecks.
- An ADR exists for the cross-shop integrity approach.

## Decisions to ask the human about

- Composite foreign keys vs trigger for cross-shop integrity (agent should recommend one).

## Agent prompt

```
Read .github/AGENTS.md and .github/milestones/02-database.md, then the skills
it lists. Compare the spec with what already exists in supabase/ (I may have
started). Give me a plan listing what's done, what's missing, and what you'll
change. Wait for my OK, then implement, run all database tests, and report.
```
