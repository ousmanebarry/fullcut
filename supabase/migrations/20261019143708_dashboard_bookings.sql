-- Dashboard booking management: outcome and cancellation tracking, the unmarked-outcomes index,
-- realtime for live calendars, and the write used for phone and walk-in bookings.

alter table public.bookings
  add column outcome_marked_at  timestamptz,
  add column cancelled_at       timestamptz,
  add column cancel_reason      text,
  add constraint bookings_cancel_reason_length check (char_length(cancel_reason) <= 200);

-- Every writer (dashboard, manage links, hold expiry) gets consistent timestamps.
create function public.bookings_track_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return new;
    end if;
  end if;
  new.outcome_marked_at := case when new.status in ('completed', 'no_show') then now() end;
  new.cancelled_at := case when new.status = 'cancelled' then now() end;
  return new;
end;
$$;

create trigger bookings_track_status
  before insert or update of status on public.bookings
  for each row execute function public.bookings_track_status();

-- Past confirmed bookings waiting for staff to mark completed / no-show.
create index bookings_unmarked_idx on public.bookings (shop_id, ends_at) where status = 'confirmed';

-- Realtime respects the bookings RLS policies; the publication is absent when realtime is not installed.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bookings;
  end if;
end;
$$;

-- Staff booking write ----------------------------------------------------------
-- Runs as the caller so RLS applies. Times and price are computed by the app from loaded data.
-- The client is p_client_id when given, else found or created by phone, else created by name only.

create function public.create_staff_booking(
  p_shop_id        uuid,
  p_staff_id       uuid,
  p_service_id     uuid,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_blocked_until  timestamptz,
  p_price_cents    int,
  p_source         text,
  p_client_name    text,
  p_notes          text,
  p_client_id      uuid default null,
  p_phone_e164     text default null
)
returns table (booking_id uuid, client_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_client_id   uuid;
  v_booking_id  uuid;
begin
  if not public.is_shop_member(p_shop_id) then
    raise exception 'not_shop_member' using errcode = '42501';
  end if;
  if p_source not in ('phone', 'walk_in') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  -- A stale hold must never block a real client.
  update public.bookings
  set status = 'cancelled'
  where shop_id = p_shop_id
    and staff_id = p_staff_id
    and status = 'pending'
    and pending_expires_at <= now();

  if p_client_id is not null then
    v_client_id := p_client_id;
  elsif nullif(p_phone_e164, '') is not null then
    insert into public.clients as c (shop_id, name, phone_e164, first_source)
    values (p_shop_id, p_client_name, p_phone_e164, p_source)
    on conflict on constraint clients_shop_phone_unique do update set
      name = case when btrim(c.name) = '' then excluded.name else c.name end
    returning c.id into v_client_id;
  else
    insert into public.clients as c (shop_id, name, first_source)
    values (p_shop_id, p_client_name, p_source)
    returning c.id into v_client_id;
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

  return query select v_booking_id, v_client_id;
end;
$$;

revoke execute on function public.create_staff_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, int, text, text, text, uuid, text
) from public, anon;
grant execute on function public.create_staff_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, int, text, text, text, uuid, text
) to authenticated;
