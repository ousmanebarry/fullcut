---
name: fullcut-data-and-tenancy
description: Use when changing the Fullcut database — writing Supabase migrations, adding tables or columns, row-level security policies, multi-tenant (shop_id) isolation, constraints, or regenerating database types.
---

# Fullcut: data model and multi-tenancy

Fullcut is multi-tenant: many shops share one Postgres database. Isolation is enforced by row-level security (RLS), not by application code alone.

## Rules

1. Every tenant-owned table has `shop_id uuid not null references public.shops(id) on delete cascade`.
2. `alter table ... enable row level security;` on every tenant table, in the same migration that creates it.
3. Every tenant table gets policies for the operations it needs, using the `public.is_shop_member()` helper below.
4. Every new tenant table gets a database test proving a member of shop A cannot select, insert, update or delete rows of shop B.
5. Migrations are append-only. Create with `supabase migration new <name>`; never edit an applied migration.
6. After schema changes, regenerate types (`pnpm db:types`) and commit them.
7. Name constraints explicitly (`bookings_no_overlap`, `clients_shop_phone_unique`) so errors map cleanly to user messages.
8. Never seed real personal data. `seed.sql` uses obviously fake names and `+1 555` style numbers.
9. A tenant row that references another tenant row uses a composite foreign key `(shop_id, x_id) references x (shop_id, id)` so it can never point into another shop (ADR 0002). Parents carry `unique (shop_id, id)`.

## Core schema (starting point)

The applied schema lives in `supabase/migrations/`. It follows the shapes below, plus: `created_at` on every table, `updated_at` with a `set_updated_at()` trigger on shops, staff, services, clients and bookings, composite same-shop FKs instead of the simple `staff_id`/`client_id`/`service_id` references shown here, and named checks such as `clients_phone_e164_format` and `clients_email_normalized`.

Adjust as the product evolves, but keep these shapes and invariants.

```sql
create extension if not exists btree_gist;  -- needed for the overlap exclusion constraint

create table public.shops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,                 -- used in the public booking URL
  timezone    text not null,                        -- IANA, e.g. 'America/Toronto'
  currency    char(3) not null default 'CAD',
  created_at  timestamptz not null default now()
);

create table public.shop_members (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner', 'staff')),
  staff_id    uuid,                                 -- links a login to a staff profile, optional
  primary key (shop_id, user_id)
);

create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id) on delete cascade,
  display_name  text not null,
  active        boolean not null default true
);

create table public.services (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops(id) on delete cascade,
  name              text not null,
  duration_minutes  int  not null check (duration_minutes > 0),
  buffer_minutes    int  not null default 0 check (buffer_minutes >= 0),
  price_cents       int  not null check (price_cents >= 0),
  deposit_cents     int  not null default 0 check (deposit_cents >= 0),
  active            boolean not null default true
);

create table public.clients (
  id                      uuid primary key default gen_random_uuid(),
  shop_id                 uuid not null references public.shops(id) on delete cascade,
  name                    text not null,
  phone_e164              text,
  email                   text,
  marketing_opt_in        boolean not null default false,
  marketing_opt_in_at     timestamptz,
  marketing_opt_in_method text,                    -- e.g. 'booking_form_checkbox'
  sms_opted_out           boolean not null default false,  -- set when the client replies STOP
  first_source            text,
  created_at              timestamptz not null default now(),
  constraint clients_shop_phone_unique unique (shop_id, phone_e164)
);

create table public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null references public.shops(id) on delete cascade,
  staff_id            uuid not null references public.staff(id),
  client_id           uuid not null references public.clients(id),
  service_id          uuid not null references public.services(id),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  blocked_until       timestamptz not null,        -- ends_at + buffer, computed by the app
  status              text not null check (status in ('pending','confirmed','completed','cancelled','no_show')),
  pending_expires_at  timestamptz,                 -- hold expiry while a deposit is being paid
  source              text not null default 'direct',
  price_cents         int  not null,
  deposit_cents       int  not null default 0,
  risk_score          real check (risk_score between 0 and 1),
  risk_model_version  text,
  created_at          timestamptz not null default now(),
  during              tstzrange generated always as (tstzrange(starts_at, blocked_until, '[)')) stored,
  constraint bookings_time_order check (starts_at < ends_at and ends_at <= blocked_until),
  constraint bookings_no_overlap exclude using gist (
    staff_id with =,
    during   with &&
  ) where (status in ('pending', 'confirmed'))
);

create table public.availability_rules (       -- weekly working hours, local wall-clock time
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  weekday     int  not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time  time not null,
  end_time    time not null,
  constraint availability_rules_time_order check (start_time < end_time)
);

create table public.time_off (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  constraint time_off_time_order check (starts_at < ends_at)
);

create table public.webhook_events (            -- idempotency for Stripe/Twilio events
  provider     text not null,
  event_id     text not null,
  received_at  timestamptz not null default now(),
  primary key (provider, event_id)
);
```

Notes:

- `blocked_until` is computed in the app: `timestamptz + interval` is not immutable, so it cannot live in a generated column. The `tstzrange` constructor is immutable, so `during` can.
- The exclusion constraint only covers `pending` and `confirmed`. Cancelled, completed and no-show bookings never block the calendar; an expired hold stops blocking as soon as its status changes (see `fullcut-booking-engine`).
- `[)` (half-open) ranges mean a booking ending at 10:00 and one starting at 10:00 do not overlap.
- Concurrent inserts into an exclusion constraint can deadlock (`40P01`) instead of raising `23P01`. The `bookings_lock_staff` trigger takes a per-staff transaction advisory lock before each booking write, so concurrent writers for one staff queue up and losers always get `23P01`. Keep it when changing bookings.
- `webhook_events` is written only by server code using the service role. Enable RLS on it with no policies so client roles cannot touch it.
- Verify the constraint and policies against the current Supabase/Postgres docs when you first apply them; adjust syntax if your Postgres version differs.

## RLS pattern

```sql
create or replace function public.is_shop_member(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shop_members m
    where m.shop_id = p_shop_id
      and m.user_id = (select auth.uid())
  );
$$;

alter table public.bookings enable row level security;

create policy bookings_select_members on public.bookings
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy bookings_write_members on public.bookings
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
```

Owner-only actions (billing, deleting staff, changing deposit policy, exports) need an `is_shop_owner()` helper in the same style, checking `role = 'owner'`.

## Public (anonymous) access

Clients booking on the public page are not logged in. Do **not** grant the `anon` role direct read access to `bookings` or `clients`.

- Availability is computed on the server and only free slots are returned — never other clients' names or booking details.
- Creating a booking happens in a server route handler that uses the service role, validates input with zod, derives `shop_id` from the URL slug on the server, and inserts.
- Public shop info (name, services, prices) is exposed through a narrow view or server route, never by opening up the base tables.

## Data export (the shop owns its data)

Any new table holding shop data must be included in the CSV export feature, in the same change.

## Writing an RLS test

For each tenant table, a test should:

1. Create two shops, each with one owner user.
2. Insert a row for each shop (as service role).
3. As shop A's user: selecting returns only shop A's row; inserting with `shop_id = B` fails; updating or deleting shop B's row affects 0 rows.

Use pgTAP (`supabase test db`) or an integration test that signs in as each user through the Supabase client. The pgTAP suite in `supabase/tests/database/` has helpers in `00_helpers.test.sql`: `tests.seed_two_shops()`, `tests.authenticate_as(uuid)`, and `tests.rls_isolation(table, cols, values_a, values_b)`, which emits the standard 9 cross-shop checks for a table.

## Checklist for a migration

- [ ] New file via `supabase migration new`
- [ ] `shop_id`, RLS enabled, policies
- [ ] Explicitly named constraints
- [ ] Database test for cross-shop isolation
- [ ] Types regenerated
- [ ] Export updated if the table holds shop data
- [ ] Destructive change? Ask the human first.
