-- Waitlist and slot refill, part 1: settings, tables, joining and leaving (milestone 10).
-- Freed-slot detection, matching, offers and claims arrive in later migrations.

-- Settings ---------------------------------------------------------------------

alter table public.shops
  add column waitlist_enabled              boolean not null default false,
  add column waitlist_wave_size            int not null default 3,
  add column waitlist_offer_minutes        int not null default 15,
  add column waitlist_min_notice_minutes   int not null default 60,
  add constraint shops_waitlist_wave_size_valid check (waitlist_wave_size between 1 and 10),
  add constraint shops_waitlist_offer_minutes_valid check (waitlist_offer_minutes between 5 and 120),
  add constraint shops_waitlist_min_notice_valid check (waitlist_min_notice_minutes between 15 and 1440);

-- Entries ----------------------------------------------------------------------
-- time_windows: [{"weekday": 0-6 (0 = Sunday), "start": "HH:MM", "end": "HH:MM"}], shop-local; [] = any time.
-- offers_requested_at is the recorded request to be texted (CASL/TCPA); entries never exist without it.

create table public.waitlist_entries (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references public.shops (id) on delete cascade,
  client_id            uuid not null,
  service_id           uuid not null,
  staff_id             uuid,
  earliest_date        date not null,
  latest_date          date not null,
  time_windows         jsonb not null default '[]'::jsonb,
  status               text not null default 'active',
  offers_requested_at  timestamptz not null default now(),
  request_method       text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint waitlist_entries_shop_id_id_unique unique (shop_id, id),
  constraint waitlist_entries_status_valid check (status in ('active', 'booked', 'expired', 'cancelled')),
  constraint waitlist_entries_request_method_valid check (request_method in ('booking_page', 'staff')),
  constraint waitlist_entries_dates_order check (earliest_date <= latest_date),
  constraint waitlist_entries_time_windows_valid check (
    jsonb_typeof(time_windows) = 'array' and jsonb_array_length(time_windows) <= 14
  ),
  constraint waitlist_entries_client_same_shop_fk foreign key (shop_id, client_id)
    references public.clients (shop_id, id) on delete cascade,
  constraint waitlist_entries_service_same_shop_fk foreign key (shop_id, service_id)
    references public.services (shop_id, id) on delete cascade,
  constraint waitlist_entries_staff_same_shop_fk foreign key (shop_id, staff_id)
    references public.staff (shop_id, id) on delete cascade
);

create index waitlist_entries_match_idx on public.waitlist_entries (shop_id, service_id, status);
create index waitlist_entries_shop_client_idx on public.waitlist_entries (shop_id, client_id);
create index waitlist_entries_shop_staff_idx on public.waitlist_entries (shop_id, staff_id);

create trigger waitlist_entries_set_updated_at before update on public.waitlist_entries
  for each row execute function public.set_updated_at();

-- Freed slots ------------------------------------------------------------------
-- The slot_freed job: written by a bookings trigger in the same transaction, worked off by the jobs tick.
-- It records only what was freed, never why, so any release path can queue one.

create table public.freed_slots (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops (id) on delete cascade,
  staff_id          uuid not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  freed_booking_id  uuid,
  status            text not null default 'pending',
  wave              int not null default 0,
  next_run_at       timestamptz not null default now(),
  locked_at         timestamptz,
  drop_reason       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint freed_slots_shop_id_id_unique unique (shop_id, id),
  constraint freed_slots_booking_start_unique unique (freed_booking_id, starts_at),
  constraint freed_slots_status_valid check (
    status in ('pending', 'offering', 'filled', 'exhausted', 'dropped', 'cancelled')
  ),
  constraint freed_slots_time_order check (starts_at < ends_at),
  constraint freed_slots_wave_valid check (wave >= 0),
  constraint freed_slots_staff_same_shop_fk foreign key (shop_id, staff_id)
    references public.staff (shop_id, id) on delete cascade,
  constraint freed_slots_booking_same_shop_fk foreign key (shop_id, freed_booking_id)
    references public.bookings (shop_id, id) on delete set null (freed_booking_id)
);

create index freed_slots_due_idx on public.freed_slots (next_run_at) where status in ('pending', 'offering');
create index freed_slots_shop_staff_idx on public.freed_slots (shop_id, staff_id);
create index freed_slots_shop_booking_idx on public.freed_slots (shop_id, freed_booking_id);

create trigger freed_slots_set_updated_at before update on public.freed_slots
  for each row execute function public.set_updated_at();

-- Offers -----------------------------------------------------------------------
-- token_hash is set when the offer text goes out (only the hash is stored, like manage links).
-- ends_at / blocked_until are what the offered booking would occupy, so a competing booking can withdraw the offer.

create table public.slot_offers (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops (id) on delete cascade,
  waitlist_entry_id  uuid not null,
  freed_slot_id      uuid,
  freed_booking_id   uuid,
  staff_id           uuid not null,
  service_id         uuid not null,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  blocked_until      timestamptz not null,
  wave               int not null default 1,
  token_hash         text,
  status             text not null default 'sent',
  sent_at            timestamptz not null default now(),
  expires_at         timestamptz not null,
  booking_id         uuid,
  created_at         timestamptz not null default now(),
  constraint slot_offers_shop_id_id_unique unique (shop_id, id),
  -- A client is never offered the same slot twice.
  constraint slot_offers_entry_slot_unique unique (waitlist_entry_id, staff_id, starts_at),
  constraint slot_offers_token_hash_unique unique (token_hash),
  constraint slot_offers_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint slot_offers_status_valid check (status in ('sent', 'claimed', 'taken', 'expired', 'withdrawn')),
  constraint slot_offers_time_order check (starts_at < ends_at and ends_at <= blocked_until),
  constraint slot_offers_wave_valid check (wave >= 1),
  constraint slot_offers_entry_same_shop_fk foreign key (shop_id, waitlist_entry_id)
    references public.waitlist_entries (shop_id, id) on delete cascade,
  constraint slot_offers_freed_slot_same_shop_fk foreign key (shop_id, freed_slot_id)
    references public.freed_slots (shop_id, id) on delete set null (freed_slot_id),
  constraint slot_offers_freed_booking_same_shop_fk foreign key (shop_id, freed_booking_id)
    references public.bookings (shop_id, id) on delete set null (freed_booking_id),
  constraint slot_offers_staff_same_shop_fk foreign key (shop_id, staff_id)
    references public.staff (shop_id, id) on delete cascade,
  constraint slot_offers_service_same_shop_fk foreign key (shop_id, service_id)
    references public.services (shop_id, id) on delete cascade,
  constraint slot_offers_booking_same_shop_fk foreign key (shop_id, booking_id)
    references public.bookings (shop_id, id) on delete set null (booking_id)
);

create index slot_offers_shop_entry_idx on public.slot_offers (shop_id, waitlist_entry_id);
create index slot_offers_shop_freed_slot_idx on public.slot_offers (shop_id, freed_slot_id);
create index slot_offers_shop_freed_booking_idx on public.slot_offers (shop_id, freed_booking_id);
create index slot_offers_shop_staff_idx on public.slot_offers (shop_id, staff_id);
create index slot_offers_shop_service_idx on public.slot_offers (shop_id, service_id);
create index slot_offers_shop_booking_idx on public.slot_offers (shop_id, booking_id);
create index slot_offers_open_idx on public.slot_offers (staff_id, starts_at) where status = 'sent';

alter table public.bookings
  add column slot_offer_id uuid,
  add constraint bookings_slot_offer_same_shop_fk foreign key (shop_id, slot_offer_id)
    references public.slot_offers (shop_id, id) on delete set null (slot_offer_id);

create index bookings_shop_slot_offer_idx on public.bookings (shop_id, slot_offer_id) where slot_offer_id is not null;

-- Links ------------------------------------------------------------------------
-- "View or leave the waitlist" links. Only the SHA-256 hex of the token is stored (ADR 0005).

create table public.waitlist_links (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops (id) on delete cascade,
  waitlist_entry_id  uuid not null,
  token_hash         text not null,
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  constraint waitlist_links_token_hash_unique unique (token_hash),
  constraint waitlist_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint waitlist_links_entry_same_shop_fk foreign key (shop_id, waitlist_entry_id)
    references public.waitlist_entries (shop_id, id) on delete cascade
);

create index waitlist_links_shop_entry_idx on public.waitlist_links (shop_id, waitlist_entry_id);

-- Grants and RLS -----------------------------------------------------------------
-- Writes come from the service role and security-definer functions. Members read, and may cancel an entry.

revoke all on table
  public.waitlist_entries, public.freed_slots, public.slot_offers, public.waitlist_links
from anon, authenticated;
grant select on table public.waitlist_entries, public.freed_slots, public.slot_offers to authenticated;
grant update (status) on table public.waitlist_entries to authenticated;

alter table public.waitlist_entries enable row level security;
alter table public.freed_slots enable row level security;
alter table public.slot_offers enable row level security;
alter table public.waitlist_links enable row level security;

create policy waitlist_entries_select_members on public.waitlist_entries
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy waitlist_entries_cancel_members on public.waitlist_entries
  for update to authenticated
  using (public.is_shop_member(shop_id) and status = 'active')
  with check (public.is_shop_member(shop_id) and status = 'cancelled');

create policy freed_slots_select_members on public.freed_slots
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy slot_offers_select_members on public.slot_offers
  for select to authenticated
  using (public.is_shop_member(shop_id));

-- Outbox: waitlist messages ------------------------------------------------------
-- A message belongs to exactly one subject: a booking, a waitlist entry (join confirmation) or an offer.

alter table public.scheduled_messages
  alter column booking_id drop not null,
  add column waitlist_entry_id uuid,
  add column slot_offer_id uuid,
  drop constraint scheduled_messages_type_valid,
  add constraint scheduled_messages_type_valid check (
    type in (
      'confirmation', 'reminder', 'confirm_request', 'rescheduled', 'cancelled',
      'waitlist_joined', 'waitlist_offer'
    )
  ),
  add constraint scheduled_messages_subject_valid check (
    case
      when type = 'waitlist_joined' then waitlist_entry_id is not null and booking_id is null and slot_offer_id is null
      when type = 'waitlist_offer' then slot_offer_id is not null and booking_id is null and waitlist_entry_id is null
      else booking_id is not null and waitlist_entry_id is null and slot_offer_id is null
    end
  ),
  add constraint scheduled_messages_entry_dedupe_unique unique (waitlist_entry_id, dedupe_key),
  add constraint scheduled_messages_offer_dedupe_unique unique (slot_offer_id, dedupe_key),
  add constraint scheduled_messages_entry_same_shop_fk foreign key (shop_id, waitlist_entry_id)
    references public.waitlist_entries (shop_id, id) on delete cascade,
  add constraint scheduled_messages_offer_same_shop_fk foreign key (shop_id, slot_offer_id)
    references public.slot_offers (shop_id, id) on delete cascade;

create index scheduled_messages_shop_entry_idx on public.scheduled_messages (shop_id, waitlist_entry_id)
  where waitlist_entry_id is not null;
create index scheduled_messages_shop_offer_idx on public.scheduled_messages (shop_id, slot_offer_id)
  where slot_offer_id is not null;

-- Joining ------------------------------------------------------------------------
-- Errors: FC002 per-phone entry cap, FC003 waitlist off, FC004 client replied STOP.

create function private.add_waitlist_entry_for_client(
  p_shop_id        uuid,
  p_client_id      uuid,
  p_service_id     uuid,
  p_staff_id       uuid,
  p_earliest_date  date,
  p_latest_date    date,
  p_time_windows   jsonb,
  p_method         text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_active  constant int := 3;
  v_enabled     boolean;
  v_timezone    text;
  v_client      public.clients;
  v_active      int;
  v_window      jsonb;
  v_entry_id    uuid;
begin
  select waitlist_enabled, timezone into v_enabled, v_timezone from public.shops where id = p_shop_id;
  if v_enabled is null then
    raise exception 'shop_not_found' using errcode = 'P0002';
  end if;
  if not v_enabled then
    raise exception 'waitlist_disabled' using errcode = 'FC003';
  end if;

  -- Locking the client serialises concurrent joins so they cannot both slip under the cap.
  select * into v_client from public.clients where shop_id = p_shop_id and id = p_client_id for update;
  if v_client.id is null or v_client.anonymised_at is not null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  if v_client.phone_e164 is null then
    raise exception 'client_no_phone' using errcode = '22023';
  end if;
  if v_client.sms_opted_out then
    raise exception 'sms_opted_out' using errcode = 'FC004';
  end if;

  if jsonb_typeof(p_time_windows) is distinct from 'array' or jsonb_array_length(p_time_windows) > 14 then
    raise exception 'invalid_time_windows' using errcode = '22023';
  end if;
  for v_window in select * from jsonb_array_elements(p_time_windows) loop
    if coalesce(v_window ->> 'weekday', '') !~ '^[0-6]$'
       or coalesce(v_window ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(v_window ->> 'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_window ->> 'start') >= (v_window ->> 'end') then
      raise exception 'invalid_time_windows' using errcode = '22023';
    end if;
  end loop;

  -- Entries whose last date has passed no longer count, even before the expiry job marks them.
  select count(*) into v_active
  from public.waitlist_entries e
  where e.shop_id = p_shop_id
    and e.client_id = p_client_id
    and e.status = 'active'
    and e.latest_date >= (now() at time zone v_timezone)::date;
  if v_active >= c_max_active then
    raise exception 'max_waitlist_entries' using errcode = 'FC002';
  end if;

  insert into public.waitlist_entries (
    shop_id, client_id, service_id, staff_id, earliest_date, latest_date, time_windows, request_method
  )
  values (
    p_shop_id, p_client_id, p_service_id, p_staff_id, p_earliest_date, p_latest_date, p_time_windows, p_method
  )
  returning id into v_entry_id;

  -- The text carries a fresh view/leave link, which the worker issues at send time.
  insert into public.scheduled_messages (shop_id, waitlist_entry_id, client_id, type, dedupe_key, send_at)
  values (p_shop_id, v_entry_id, p_client_id, 'waitlist_joined', 'waitlist_joined', now());

  return v_entry_id;
end;
$$;

-- Public booking page: server only (service role), after the app has validated and rate limited.
create function public.join_waitlist(
  p_shop_id        uuid,
  p_service_id     uuid,
  p_earliest_date  date,
  p_latest_date    date,
  p_time_windows   jsonb,
  p_client_name    text,
  p_phone_e164     text,
  p_staff_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
begin
  if not exists (select 1 from public.shops where id = p_shop_id) then
    raise exception 'shop_not_found' using errcode = 'P0002';
  end if;

  insert into public.clients as c (shop_id, name, phone_e164, first_source)
  values (p_shop_id, p_client_name, p_phone_e164, 'direct')
  on conflict on constraint clients_shop_phone_unique do update set
    name = case when btrim(c.name) = '' then excluded.name else c.name end
  returning c.id into v_client_id;

  return private.add_waitlist_entry_for_client(
    p_shop_id, v_client_id, p_service_id, p_staff_id, p_earliest_date, p_latest_date, p_time_windows, 'booking_page'
  );
end;
$$;

-- Dashboard: staff add an entry for a client who asked by phone. Pass an existing client, or a name and phone.
create function public.add_waitlist_entry(
  p_shop_id        uuid,
  p_service_id     uuid,
  p_earliest_date  date,
  p_latest_date    date,
  p_time_windows   jsonb,
  p_staff_id       uuid default null,
  p_client_id      uuid default null,
  p_client_name    text default null,
  p_phone_e164     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := p_client_id;
begin
  if not public.is_shop_member(p_shop_id) then
    raise exception 'shop_not_found' using errcode = 'P0002';
  end if;

  if v_client_id is null then
    if p_phone_e164 is null or btrim(coalesce(p_client_name, '')) = '' then
      raise exception 'client_required' using errcode = '22023';
    end if;
    insert into public.clients as c (shop_id, name, phone_e164, first_source)
    values (p_shop_id, btrim(p_client_name), p_phone_e164, 'phone')
    on conflict on constraint clients_shop_phone_unique do update set
      name = case when btrim(c.name) = '' then excluded.name else c.name end
    returning c.id into v_client_id;
  end if;

  return private.add_waitlist_entry_for_client(
    p_shop_id, v_client_id, p_service_id, p_staff_id, p_earliest_date, p_latest_date, p_time_windows, 'staff'
  );
end;
$$;

revoke execute on function public.join_waitlist(uuid, uuid, date, date, jsonb, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.join_waitlist(uuid, uuid, date, date, jsonb, text, text, uuid) to service_role;

revoke execute on function public.add_waitlist_entry(uuid, uuid, date, date, jsonb, uuid, uuid, text, text)
  from public, anon;
grant execute on function public.add_waitlist_entry(uuid, uuid, date, date, jsonb, uuid, uuid, text, text)
  to authenticated;

revoke execute on function private.add_waitlist_entry_for_client(uuid, uuid, uuid, uuid, date, date, jsonb, text)
  from public, anon, authenticated;

-- Leaving, STOP and anonymising ----------------------------------------------------

-- An entry that stops being active (left, booked, expired) closes its open offers and their queued texts.
create function private.close_offers_for_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.scheduled_messages set status = 'cancelled'
  where shop_id = new.shop_id
    and status = 'queued'
    and slot_offer_id in (
      select o.id from public.slot_offers o
      where o.shop_id = new.shop_id and o.waitlist_entry_id = new.id and o.status = 'sent'
    );
  update public.slot_offers set status = 'withdrawn'
  where shop_id = new.shop_id and waitlist_entry_id = new.id and status = 'sent';
  return null;
end;
$$;

create trigger waitlist_entries_close_offers
  after update of status on public.waitlist_entries
  for each row
  when (old.status = 'active' and new.status <> 'active')
  execute function private.close_offers_for_entry();

-- STOP (however it arrives) and anonymising end the client's waitlist entries.
create function private.cancel_waitlist_for_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.waitlist_entries set status = 'cancelled'
  where shop_id = new.shop_id and client_id = new.id and status = 'active';

  if new.anonymised_at is not null then
    update public.waitlist_links set revoked_at = now()
    where shop_id = new.shop_id
      and revoked_at is null
      and waitlist_entry_id in (
        select e.id from public.waitlist_entries e where e.shop_id = new.shop_id and e.client_id = new.id
      );
  end if;
  return null;
end;
$$;

create trigger clients_cancel_waitlist
  after update of sms_opted_out, anonymised_at on public.clients
  for each row
  when (
    (new.sms_opted_out and not old.sms_opted_out)
    or (old.anonymised_at is null and new.anonymised_at is not null)
  )
  execute function private.cancel_waitlist_for_client();

revoke execute on function private.close_offers_for_entry() from public, anon, authenticated;
revoke execute on function private.cancel_waitlist_for_client() from public, anon, authenticated;

-- Client merge keeps the merged client's waitlist entries --------------------------------

create or replace function public.merge_clients(p_keep_id uuid, p_merge_id uuid, p_contact jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop_id   uuid;
  v_keep      public.clients;
  v_merge     public.clients;
  v_consent   public.clients;
  v_bookings  int;
  v_notes     int;
begin
  select shop_id into v_shop_id from public.clients where id = p_keep_id;
  if v_shop_id is null or not public.is_shop_member(v_shop_id) then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  if not public.is_shop_owner(v_shop_id) then
    raise exception 'merge_forbidden' using errcode = '42501';
  end if;
  if p_keep_id = p_merge_id then
    raise exception 'merge_same_client' using errcode = '22023';
  end if;

  -- Fixed lock order so two merges of the same pair cannot deadlock.
  perform 1 from public.clients
  where shop_id = v_shop_id and id in (p_keep_id, p_merge_id)
  order by id
  for update;

  select * into v_keep from public.clients where shop_id = v_shop_id and id = p_keep_id;
  select * into v_merge from public.clients where shop_id = v_shop_id and id = p_merge_id;
  if v_merge.id is null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  if v_keep.anonymised_at is not null or v_merge.anonymised_at is not null then
    raise exception 'merge_anonymised_client' using errcode = '22023';
  end if;

  update public.bookings set client_id = p_keep_id
  where shop_id = v_shop_id and client_id = p_merge_id;
  get diagnostics v_bookings = row_count;

  update public.client_notes set client_id = p_keep_id
  where shop_id = v_shop_id and client_id = p_merge_id;
  get diagnostics v_notes = row_count;

  update public.scheduled_messages set client_id = p_keep_id
  where shop_id = v_shop_id and client_id = p_merge_id;

  update public.inbound_messages set client_id = p_keep_id
  where shop_id = v_shop_id and client_id = p_merge_id;

  update public.waitlist_entries set client_id = p_keep_id
  where shop_id = v_shop_id and client_id = p_merge_id;

  -- Marketing consent travels as a whole from the most recent opt-in; a STOP on either record wins.
  if v_merge.marketing_opt_in
     and (not v_keep.marketing_opt_in or v_merge.marketing_opt_in_at > v_keep.marketing_opt_in_at) then
    v_consent := v_merge;
  else
    v_consent := v_keep;
  end if;

  -- Frees the phone number before it moves to the kept client.
  delete from public.clients where shop_id = v_shop_id and id = p_merge_id;

  update public.clients set
    name = coalesce(nullif(btrim(p_contact ->> 'name'), ''), nullif(btrim(v_keep.name), ''), v_merge.name),
    phone_e164 = coalesce(nullif(p_contact ->> 'phone_e164', ''), v_keep.phone_e164, v_merge.phone_e164),
    email = coalesce(nullif(p_contact ->> 'email', ''), v_keep.email, v_merge.email),
    marketing_opt_in = v_consent.marketing_opt_in,
    marketing_opt_in_at = v_consent.marketing_opt_in_at,
    marketing_opt_in_method = v_consent.marketing_opt_in_method,
    sms_opted_out = v_keep.sms_opted_out or v_merge.sms_opted_out,
    first_source = case
      when v_merge.created_at < v_keep.created_at then coalesce(v_merge.first_source, v_keep.first_source)
      else coalesce(v_keep.first_source, v_merge.first_source)
    end,
    created_at = least(v_keep.created_at, v_merge.created_at)
  where shop_id = v_shop_id and id = p_keep_id;

  insert into public.audit_events (shop_id, action, subject_id, details)
  values (
    v_shop_id, 'client_merge', p_keep_id,
    jsonb_build_object('merged_client_id', p_merge_id, 'bookings_moved', v_bookings, 'notes_moved', v_notes)
  );

  return p_keep_id;
end;
$$;

-- Demo shop ------------------------------------------------------------------------
-- The nightly reset keeps its name (cron and configure_demo_shop call it); the original body is now the
-- base step and this wrapper turns the waitlist on and seeds a few entries.

alter function private.reset_demo_shop() rename to reset_demo_shop_base;

create function private.reset_demo_shop()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_config  private.demo_config;
  v_today   date;
begin
  perform private.reset_demo_shop_base();

  select * into v_config from private.demo_config;
  if not found then
    return;
  end if;

  v_today := (now() at time zone 'America/Toronto')::date;

  update public.shops set waitlist_enabled = true where id = v_config.shop_id;

  insert into public.waitlist_entries (
    shop_id, client_id, service_id, staff_id, earliest_date, latest_date, time_windows, request_method, created_at
  )
  select
    v_config.shop_id,
    md5(v_config.shop_id::text || ':client:' || e.client_n)::uuid,
    (select s.id from public.services s where s.shop_id = v_config.shop_id and s.sort_order = e.service_sort),
    null,
    v_today + 1,
    v_today + 14,
    e.windows::jsonb,
    'booking_page',
    now() - make_interval(hours => e.age_hours)
  from (values
    (3, 1, '[]', 30),
    (7, 0, '[{"weekday":6,"start":"09:00","end":"13:00"}]', 20),
    (11, 3, '[]', 6)
  ) as e (client_n, service_sort, windows, age_hours);
end;
$$;

revoke execute on function private.reset_demo_shop() from public, anon, authenticated;
revoke execute on function private.reset_demo_shop_base() from public, anon, authenticated;
