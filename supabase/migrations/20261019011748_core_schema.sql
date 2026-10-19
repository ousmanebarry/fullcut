-- Core schema: shops, members, staff, services, clients, bookings, availability, time off, webhook idempotency.
-- Same-shop references use composite foreign keys (docs/adr/0002-cross-shop-integrity-composite-fks.md).

create extension if not exists btree_gist with schema extensions;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Tables -------------------------------------------------------------------

create table public.shops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  timezone    text not null,
  currency    char(3) not null default 'CAD',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint shops_slug_unique unique (slug)
);

create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops (id) on delete cascade,
  display_name  text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint staff_shop_id_id_unique unique (shop_id, id)
);

create table public.shop_members (
  shop_id     uuid not null references public.shops (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null,
  staff_id    uuid,
  created_at  timestamptz not null default now(),
  primary key (shop_id, user_id),
  constraint shop_members_role_valid check (role in ('owner', 'staff')),
  constraint shop_members_staff_same_shop_fk foreign key (shop_id, staff_id)
    references public.staff (shop_id, id) on delete set null (staff_id)
);

create table public.services (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops (id) on delete cascade,
  name              text not null,
  duration_minutes  int  not null,
  buffer_minutes    int  not null default 0,
  price_cents       int  not null,
  deposit_cents     int  not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint services_shop_id_id_unique unique (shop_id, id),
  constraint services_duration_positive check (duration_minutes > 0),
  constraint services_buffer_nonnegative check (buffer_minutes >= 0),
  constraint services_price_nonnegative check (price_cents >= 0),
  constraint services_deposit_nonnegative check (deposit_cents >= 0)
);

create table public.clients (
  id                      uuid primary key default gen_random_uuid(),
  shop_id                 uuid not null references public.shops (id) on delete cascade,
  name                    text not null,
  phone_e164              text,
  email                   text,
  marketing_opt_in        boolean not null default false,
  marketing_opt_in_at     timestamptz,
  marketing_opt_in_method text,
  sms_opted_out           boolean not null default false,
  first_source            text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint clients_shop_id_id_unique unique (shop_id, id),
  constraint clients_shop_phone_unique unique (shop_id, phone_e164),
  constraint clients_phone_e164_format check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  constraint clients_email_normalized check (email = lower(btrim(email)))
);

create table public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null references public.shops (id) on delete cascade,
  staff_id            uuid not null,
  client_id           uuid not null,
  service_id          uuid not null,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  -- ends_at + service buffer, computed by the app (timestamptz + interval is not immutable)
  blocked_until       timestamptz not null,
  status              text not null,
  pending_expires_at  timestamptz,
  source              text not null default 'direct',
  price_cents         int  not null,
  deposit_cents       int  not null default 0,
  risk_score          real,
  risk_model_version  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  during              tstzrange generated always as (tstzrange(starts_at, blocked_until, '[)')) stored,
  constraint bookings_status_valid check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  constraint bookings_time_order check (starts_at < ends_at and ends_at <= blocked_until),
  constraint bookings_price_nonnegative check (price_cents >= 0),
  constraint bookings_deposit_nonnegative check (deposit_cents >= 0),
  constraint bookings_risk_score_range check (risk_score between 0 and 1),
  constraint bookings_staff_same_shop_fk foreign key (shop_id, staff_id)
    references public.staff (shop_id, id),
  constraint bookings_service_same_shop_fk foreign key (shop_id, service_id)
    references public.services (shop_id, id),
  constraint bookings_client_same_shop_fk foreign key (shop_id, client_id)
    references public.clients (shop_id, id),
  constraint bookings_no_overlap exclude using gist (
    staff_id with =,
    during   with &&
  ) where (status in ('pending', 'confirmed'))
);

-- Weekly working hours in shop-local wall-clock time; weekday 0 = Sunday.
create table public.availability_rules (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  staff_id    uuid not null,
  weekday     int  not null,
  start_time  time not null,
  end_time    time not null,
  created_at  timestamptz not null default now(),
  constraint availability_rules_weekday_valid check (weekday between 0 and 6),
  constraint availability_rules_time_order check (start_time < end_time),
  constraint availability_rules_staff_same_shop_fk foreign key (shop_id, staff_id)
    references public.staff (shop_id, id) on delete cascade
);

create table public.time_off (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  staff_id    uuid not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  created_at  timestamptz not null default now(),
  constraint time_off_time_order check (starts_at < ends_at),
  constraint time_off_staff_same_shop_fk foreign key (shop_id, staff_id)
    references public.staff (shop_id, id) on delete cascade
);

-- Stripe/Twilio idempotency; written by server code with the service role only.
create table public.webhook_events (
  provider     text not null,
  event_id     text not null,
  received_at  timestamptz not null default now(),
  primary key (provider, event_id)
);

-- Indexes ------------------------------------------------------------------

create index bookings_shop_starts_at_idx on public.bookings (shop_id, starts_at);
create index bookings_client_starts_at_idx on public.bookings (client_id, starts_at);
create index clients_shop_lower_name_idx on public.clients (shop_id, lower(name));
create index availability_rules_staff_weekday_idx on public.availability_rules (staff_id, weekday);
create index time_off_staff_starts_at_idx on public.time_off (staff_id, starts_at);

-- updated_at triggers ------------------------------------------------------

create trigger shops_set_updated_at before update on public.shops
  for each row execute function public.set_updated_at();
create trigger staff_set_updated_at before update on public.staff
  for each row execute function public.set_updated_at();
create trigger services_set_updated_at before update on public.services
  for each row execute function public.set_updated_at();
create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger bookings_set_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

-- RLS helpers --------------------------------------------------------------

create function public.is_shop_member(p_shop_id uuid)
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

create function public.is_shop_owner(p_shop_id uuid)
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
      and m.role = 'owner'
  );
$$;

revoke execute on function public.is_shop_member(uuid) from public, anon;
revoke execute on function public.is_shop_owner(uuid) from public, anon;
grant execute on function public.is_shop_member(uuid) to authenticated, service_role;
grant execute on function public.is_shop_owner(uuid) to authenticated, service_role;

-- Grants -------------------------------------------------------------------
-- Public booking goes through server routes with the service role; anon never touches tables.

revoke all on table
  public.shops, public.shop_members, public.staff, public.services, public.clients,
  public.bookings, public.availability_rules, public.time_off, public.webhook_events
from anon;

-- TRUNCATE bypasses RLS, so authenticated must never have it.
revoke truncate, references, trigger on table
  public.shops, public.shop_members, public.staff, public.services, public.clients,
  public.bookings, public.availability_rules, public.time_off
from authenticated;

revoke all on table public.webhook_events from authenticated;

-- Row-level security -------------------------------------------------------

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.bookings enable row level security;
alter table public.availability_rules enable row level security;
alter table public.time_off enable row level security;
alter table public.webhook_events enable row level security;

-- Shops are created during onboarding by the server with the service role.
create policy shops_select_members on public.shops
  for select to authenticated
  using (public.is_shop_member(id));

create policy shops_update_owners on public.shops
  for update to authenticated
  using (public.is_shop_owner(id))
  with check (public.is_shop_owner(id));

create policy shop_members_select_members on public.shop_members
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy shop_members_insert_owners on public.shop_members
  for insert to authenticated
  with check (public.is_shop_owner(shop_id));

create policy shop_members_update_owners on public.shop_members
  for update to authenticated
  using (public.is_shop_owner(shop_id))
  with check (public.is_shop_owner(shop_id));

create policy shop_members_delete_owners on public.shop_members
  for delete to authenticated
  using (public.is_shop_owner(shop_id));

create policy staff_members_all on public.staff
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy services_members_all on public.services
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy clients_members_all on public.clients
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy bookings_members_all on public.bookings
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy availability_rules_members_all on public.availability_rules
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy time_off_members_all on public.time_off
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
