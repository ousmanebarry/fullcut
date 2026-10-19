-- Public booking page: client-facing settings, booking notes, manage links, rate limits and the
-- atomic booking write used by the public API (docs/adr/0005-public-booking-links-and-rate-limits.md).

alter table public.shops
  add column cancel_cutoff_hours            int not null default 2,
  add column max_active_bookings_per_phone  int not null default 3,
  add constraint shops_cancel_cutoff_valid check (cancel_cutoff_hours between 0 and 168),
  add constraint shops_max_active_bookings_valid check (max_active_bookings_per_phone between 1 and 20);

alter table public.bookings
  add column client_notes text,
  add constraint bookings_client_notes_length check (char_length(client_notes) <= 500),
  add constraint bookings_shop_id_id_unique unique (shop_id, id);

-- Manage links ---------------------------------------------------------------
-- Only a SHA-256 hex digest of the token is stored; the token itself exists only in the client's link.

create table public.booking_links (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  booking_id  uuid not null,
  token_hash  text not null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint booking_links_token_hash_unique unique (token_hash),
  constraint booking_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_links_booking_same_shop_fk foreign key (shop_id, booking_id)
    references public.bookings (shop_id, id) on delete cascade
);

create index booking_links_booking_id_idx on public.booking_links (booking_id);

-- Rate limits ----------------------------------------------------------------
-- Fixed windows keyed by hashed identifiers (never raw IPs or phone numbers).

create table public.public_rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          int not null default 1,
  primary key (key, window_start)
);

create index public_rate_limits_window_start_idx on public.public_rate_limits (window_start);

-- Both tables are server-only: RLS on with no policies, and no grants for client roles.
revoke all on table public.booking_links, public.public_rate_limits from anon, authenticated;
alter table public.booking_links enable row level security;
alter table public.public_rate_limits enable row level security;

create function public.hit_rate_limit(p_key text, p_window_seconds int, p_max int)
returns table (allowed boolean, retry_after_seconds int)
language plpgsql
set search_path = ''
as $$
declare
  v_window_start timestamptz :=
    pg_catalog.to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into public.public_rate_limits as r (key, window_start, hits)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- Occasional pruning keeps the table small without a scheduled job.
  if random() < 0.01 then
    delete from public.public_rate_limits where window_start < now() - interval '1 day';
  end if;

  return query select
    v_hits <= p_max,
    case
      when v_hits <= p_max then 0
      else ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - now())))::int
    end;
end;
$$;

revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

-- Public booking write -------------------------------------------------------
-- Times and price are computed by the app from server-loaded data; this function makes the
-- client upsert, the per-phone cap, the insert and the manage link one atomic step.
-- Empty p_email / p_notes mean "not given".

create function public.create_public_booking(
  p_shop_id           uuid,
  p_staff_id          uuid,
  p_service_id        uuid,
  p_starts_at         timestamptz,
  p_ends_at           timestamptz,
  p_blocked_until     timestamptz,
  p_price_cents       int,
  p_source            text,
  p_client_name       text,
  p_phone_e164        text,
  p_email             text,
  p_notes             text,
  p_marketing_opt_in  boolean,
  p_token_hash        text,
  p_link_expires_at   timestamptz
)
returns table (booking_id uuid, client_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_client_id   uuid;
  v_booking_id  uuid;
  v_max_active  int;
  v_active      int;
begin
  -- Serialise per phone so parallel requests cannot both slip under the cap.
  perform pg_advisory_xact_lock(hashtextextended('fullcut.public_booking:' || p_shop_id::text || ':' || p_phone_e164, 0));

  select max_active_bookings_per_phone into v_max_active from public.shops where id = p_shop_id;
  if v_max_active is null then
    raise exception 'shop_not_found' using errcode = 'P0002';
  end if;

  -- A stale hold must never block a real client.
  update public.bookings
  set status = 'cancelled'
  where staff_id = p_staff_id
    and status = 'pending'
    and pending_expires_at <= now();

  insert into public.clients as c (
    shop_id, name, phone_e164, email,
    marketing_opt_in, marketing_opt_in_at, marketing_opt_in_method, first_source
  )
  values (
    p_shop_id, p_client_name, p_phone_e164, nullif(p_email, ''),
    p_marketing_opt_in,
    case when p_marketing_opt_in then now() end,
    case when p_marketing_opt_in then 'booking_form_checkbox' end,
    p_source
  )
  on conflict on constraint clients_shop_phone_unique do update set
    name = case when btrim(c.name) = '' then excluded.name else c.name end,
    email = coalesce(c.email, excluded.email),
    -- Consent can be given here but never withdrawn by omission.
    marketing_opt_in = c.marketing_opt_in or excluded.marketing_opt_in,
    marketing_opt_in_at = case
      when not c.marketing_opt_in and excluded.marketing_opt_in then excluded.marketing_opt_in_at
      else c.marketing_opt_in_at
    end,
    marketing_opt_in_method = case
      when not c.marketing_opt_in and excluded.marketing_opt_in then excluded.marketing_opt_in_method
      else c.marketing_opt_in_method
    end
  returning c.id into v_client_id;

  select count(*) into v_active
  from public.bookings b
  where b.shop_id = p_shop_id
    and b.client_id = v_client_id
    and b.status in ('pending', 'confirmed')
    and b.starts_at > now();

  if v_active >= v_max_active then
    raise exception 'max_active_bookings' using errcode = 'FC001';
  end if;

  insert into public.bookings (
    shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until,
    status, source, price_cents, client_notes
  )
  values (
    p_shop_id, p_staff_id, v_client_id, p_service_id, p_starts_at, p_ends_at, p_blocked_until,
    'confirmed', p_source, p_price_cents, nullif(p_notes, '')
  )
  returning id into v_booking_id;

  insert into public.booking_links (shop_id, booking_id, token_hash, expires_at)
  values (p_shop_id, v_booking_id, p_token_hash, p_link_expires_at);

  return query select v_booking_id, v_client_id;
end;
$$;

revoke execute on function public.create_public_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, int, text, text, text, text, text, boolean, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_public_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, int, text, text, text, text, text, boolean, text, timestamptz
) to service_role;
