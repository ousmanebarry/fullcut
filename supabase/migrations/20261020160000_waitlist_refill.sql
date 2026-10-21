-- Waitlist and slot refill, part 2: freed-slot detection, offers in waves, claims (milestone 10).

-- One booking write path ---------------------------------------------------------------
-- create_public_booking's body moves here so waitlist claims insert through exactly the same steps.

create function private.insert_public_booking(
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
  p_link_expires_at   timestamptz,
  p_slot_offer_id     uuid
)
returns table (booking_id uuid, client_id uuid)
language plpgsql
security definer
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
    status, source, price_cents, client_notes, slot_offer_id
  )
  values (
    p_shop_id, p_staff_id, v_client_id, p_service_id, p_starts_at, p_ends_at, p_blocked_until,
    'confirmed', p_source, p_price_cents, nullif(p_notes, ''), p_slot_offer_id
  )
  returning id into v_booking_id;

  insert into public.booking_links (shop_id, booking_id, token_hash, expires_at)
  values (p_shop_id, v_booking_id, p_token_hash, p_link_expires_at);

  return query select v_booking_id, v_client_id;
end;
$$;

create or replace function public.create_public_booking(
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
language sql
security definer
set search_path = ''
as $$
  select * from private.insert_public_booking(
    p_shop_id, p_staff_id, p_service_id, p_starts_at, p_ends_at, p_blocked_until, p_price_cents,
    p_source, p_client_name, p_phone_e164, p_email, p_notes, p_marketing_opt_in, p_token_hash,
    p_link_expires_at, null
  );
$$;

revoke execute on function private.insert_public_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, int, text, text, text, text, text, boolean, text, timestamptz, uuid
) from public, anon, authenticated;

-- Freed-slot detection ---------------------------------------------------------------------
-- A confirmed booking that is cancelled or moved frees its old time. Only time far enough ahead is
-- worth offering; the job input is just the freed time, never the reason.

create function private.queue_freed_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled     boolean;
  v_min_notice  int;
begin
  if old.status <> 'confirmed' then
    return null;
  end if;
  if not (
    new.status = 'cancelled'
    or (new.status = 'confirmed' and (new.starts_at <> old.starts_at or new.staff_id <> old.staff_id))
  ) then
    return null;
  end if;

  select waitlist_enabled, waitlist_min_notice_minutes into v_enabled, v_min_notice
  from public.shops where id = old.shop_id;
  if not v_enabled or old.starts_at <= now() + make_interval(mins => v_min_notice) then
    return null;
  end if;

  insert into public.freed_slots (shop_id, staff_id, starts_at, ends_at, freed_booking_id)
  values (old.shop_id, old.staff_id, old.starts_at, old.blocked_until, old.id)
  on conflict on constraint freed_slots_booking_start_unique do nothing;
  return null;
end;
$$;

create trigger bookings_queue_freed_slot
  after update of status, starts_at, staff_id on public.bookings
  for each row execute function private.queue_freed_slot();

-- An open offer whose time another booking now occupies can no longer be claimed. Offers in the
-- same refill as a claimed one are marked 'taken' by the claim itself.
create function private.withdraw_overlapping_offers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_freed_slot_id uuid;
begin
  if new.status <> 'confirmed' then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'confirmed'
     and new.staff_id = old.staff_id
     and new.starts_at = old.starts_at
     and new.blocked_until = old.blocked_until then
    return null;
  end if;

  if new.slot_offer_id is not null then
    select freed_slot_id into v_freed_slot_id from public.slot_offers where id = new.slot_offer_id;
  end if;

  with withdrawn as (
    update public.slot_offers o set status = 'withdrawn'
    where o.shop_id = new.shop_id
      and o.staff_id = new.staff_id
      and o.status = 'sent'
      and tstzrange(o.starts_at, o.blocked_until, '[)') && new.during
      and o.id is distinct from new.slot_offer_id
      and (v_freed_slot_id is null or o.freed_slot_id is distinct from v_freed_slot_id)
    returning o.id
  )
  update public.scheduled_messages set status = 'cancelled'
  where status = 'queued' and slot_offer_id in (select id from withdrawn);
  return null;
end;
$$;

create trigger bookings_withdraw_offers
  after insert or update of status, starts_at, blocked_until, staff_id on public.bookings
  for each row execute function private.withdraw_overlapping_offers();

revoke execute on function private.queue_freed_slot() from public, anon, authenticated;
revoke execute on function private.withdraw_overlapping_offers() from public, anon, authenticated;

-- Job: claim due refills -------------------------------------------------------------------
-- SKIP LOCKED so concurrent ticks never work the same slot; a lock older than 5 minutes means the
-- worker died and the slot can be picked up again.

create function public.claim_due_freed_slots(p_limit int)
returns setof public.freed_slots
language plpgsql
set search_path = ''
as $$
begin
  return query
  update public.freed_slots f
  set locked_at = now()
  where f.id in (
    select d.id from public.freed_slots d
    where d.status in ('pending', 'offering')
      and d.next_run_at <= now()
      and (d.locked_at is null or d.locked_at < now() - interval '5 minutes')
    order by d.next_run_at
    limit p_limit
    for update skip locked
  )
  returning f.*;
end;
$$;

-- Job: expire stale offers and entries ------------------------------------------------------

create function public.expire_waitlist()
returns table (offers_expired int, entries_expired int)
language plpgsql
set search_path = ''
as $$
declare
  v_offers   int;
  v_entries  int;
begin
  with expired as (
    update public.slot_offers set status = 'expired'
    where status = 'sent' and expires_at <= now()
    returning id
  ),
  cancelled as (
    update public.scheduled_messages set status = 'cancelled'
    where status = 'queued' and slot_offer_id in (select id from expired)
    returning 1
  )
  select count(*) into v_offers from expired;

  update public.waitlist_entries e set status = 'expired'
  from public.shops s
  where s.id = e.shop_id
    and e.status = 'active'
    and e.latest_date < (now() at time zone s.timezone)::date;
  get diagnostics v_entries = row_count;

  return query select v_offers, v_entries;
end;
$$;

-- Job: send a wave -------------------------------------------------------------------------
-- p_offers: [{"entry_id", "service_id", "starts_at", "ends_at", "blocked_until"}]. The unique
-- (entry, staff, start) key silently drops an offer the client has already had.

create function public.create_slot_offers(
  p_freed_slot_id  uuid,
  p_offers         jsonb,
  p_expires_at     timestamptz,
  p_next_run_at    timestamptz
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_slot   public.freed_slots;
  v_count  int;
begin
  select * into v_slot from public.freed_slots where id = p_freed_slot_id for update;
  if v_slot.id is null or v_slot.status not in ('pending', 'offering') then
    return 0;
  end if;

  with inserted as (
    insert into public.slot_offers (
      shop_id, waitlist_entry_id, freed_slot_id, freed_booking_id, staff_id, service_id,
      starts_at, ends_at, blocked_until, wave, expires_at
    )
    select
      v_slot.shop_id, (o ->> 'entry_id')::uuid, v_slot.id, v_slot.freed_booking_id, v_slot.staff_id,
      (o ->> 'service_id')::uuid, (o ->> 'starts_at')::timestamptz, (o ->> 'ends_at')::timestamptz,
      (o ->> 'blocked_until')::timestamptz, v_slot.wave + 1, p_expires_at
    from jsonb_array_elements(p_offers) as o
    join public.waitlist_entries e
      on e.shop_id = v_slot.shop_id and e.id = (o ->> 'entry_id')::uuid and e.status = 'active'
    on conflict on constraint slot_offers_entry_slot_unique do nothing
    returning id, waitlist_entry_id
  ),
  queued as (
    insert into public.scheduled_messages (shop_id, slot_offer_id, client_id, type, dedupe_key, send_at)
    select v_slot.shop_id, i.id, e.client_id, 'waitlist_offer', 'waitlist_offer', now()
    from inserted i
    join public.waitlist_entries e on e.shop_id = v_slot.shop_id and e.id = i.waitlist_entry_id
    returning 1
  )
  select count(*) into v_count from queued;

  update public.freed_slots set
    status = case when v_count > 0 then 'offering' else status end,
    wave = case when v_count > 0 then wave + 1 else wave end,
    next_run_at = p_next_run_at,
    locked_at = null
  where id = v_slot.id;

  return v_count;
end;
$$;

revoke execute on function public.claim_due_freed_slots(int) from public, anon, authenticated;
grant execute on function public.claim_due_freed_slots(int) to service_role;
revoke execute on function public.expire_waitlist() from public, anon, authenticated;
grant execute on function public.expire_waitlist() to service_role;
revoke execute on function public.create_slot_offers(uuid, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.create_slot_offers(uuid, jsonb, timestamptz, timestamptz) to service_role;

-- Claim ------------------------------------------------------------------------------------
-- Outcomes: booked, invalid, expired, taken, claimed (link already used), inactive (entry closed),
-- too_many (per-phone booking cap). Lock order matches every other writer: staff, refill, entry,
-- offer; bookings_no_overlap still decides between concurrent claimants.

create function public.claim_slot_offer(p_token_hash text, p_manage_token_hash text)
returns table (outcome text, booking_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer      public.slot_offers;
  v_entry      public.waitlist_entries;
  v_client     public.clients;
  v_price      int;
  v_booking_id uuid;
begin
  select * into v_offer from public.slot_offers where token_hash = p_token_hash;
  if v_offer.id is null then
    return query select 'invalid', null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('fullcut.bookings.staff:' || v_offer.staff_id::text, 0));
  if v_offer.freed_slot_id is not null then
    perform 1 from public.freed_slots where id = v_offer.freed_slot_id for update;
  end if;
  select * into v_entry from public.waitlist_entries where id = v_offer.waitlist_entry_id for update;
  select * into v_offer from public.slot_offers where id = v_offer.id for update;

  if v_offer.status = 'claimed' then
    return query select 'claimed', v_offer.booking_id;
    return;
  end if;
  if v_offer.status in ('taken', 'withdrawn') then
    return query select 'taken', null::uuid;
    return;
  end if;
  if v_offer.status = 'expired' or v_offer.expires_at <= now() then
    return query select 'expired', null::uuid;
    return;
  end if;
  if v_entry.status <> 'active' then
    return query select 'inactive', null::uuid;
    return;
  end if;

  select * into v_client from public.clients where shop_id = v_offer.shop_id and id = v_entry.client_id;
  select price_cents into v_price from public.services
  where shop_id = v_offer.shop_id and id = v_offer.service_id and active;
  if v_client.phone_e164 is null or v_price is null then
    return query select 'inactive', null::uuid;
    return;
  end if;

  begin
    select b.booking_id into v_booking_id from private.insert_public_booking(
      v_offer.shop_id, v_offer.staff_id, v_offer.service_id, v_offer.starts_at, v_offer.ends_at,
      v_offer.blocked_until, v_price, 'waitlist', v_client.name, v_client.phone_e164, '', '', false,
      p_manage_token_hash, v_offer.starts_at + interval '7 days', v_offer.id
    ) as b;
  exception
    when exclusion_violation then
      update public.slot_offers set status = 'taken' where id = v_offer.id;
      return query select 'taken', null::uuid;
      return;
    when sqlstate 'FC001' then
      return query select 'too_many', null::uuid;
      return;
  end;

  update public.slot_offers set status = 'claimed', booking_id = v_booking_id where id = v_offer.id;

  if v_offer.freed_slot_id is not null then
    with taken as (
      update public.slot_offers set status = 'taken'
      where freed_slot_id = v_offer.freed_slot_id and status = 'sent'
      returning id
    )
    update public.scheduled_messages set status = 'cancelled'
    where status = 'queued' and slot_offer_id in (select id from taken);

    update public.freed_slots set status = 'filled', locked_at = null where id = v_offer.freed_slot_id;
  end if;

  update public.waitlist_entries set status = 'booked' where id = v_entry.id;

  return query select 'booked', v_booking_id;
end;
$$;

revoke execute on function public.claim_slot_offer(text, text) from public, anon, authenticated;
grant execute on function public.claim_slot_offer(text, text) to service_role;
