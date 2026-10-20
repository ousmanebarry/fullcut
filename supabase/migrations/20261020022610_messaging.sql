-- SMS messaging and background jobs: per-shop message settings, the outgoing-message outbox filled by a
-- bookings trigger, inbound replies, and the per-minute job tick
-- (docs/adr/0008-background-jobs-and-messaging.md).

create extension if not exists pg_net with schema extensions;

-- Settings and booking columns ---------------------------------------------------

alter table public.shops
  add column sms_confirmation_enabled     boolean not null default true,
  add column sms_reminder_enabled         boolean not null default true,
  add column sms_confirm_request_enabled  boolean not null default true,
  add column sms_rescheduled_enabled      boolean not null default true,
  add column sms_cancelled_enabled        boolean not null default true,
  add column sms_reminder_lead_hours      int not null default 24,
  add column sms_sign_off                 text,
  add constraint shops_sms_reminder_lead_valid check (sms_reminder_lead_hours between 3 and 72),
  add constraint shops_sms_sign_off_length check (char_length(sms_sign_off) between 1 and 40);

alter table public.bookings
  add column client_confirmed_at  timestamptz,
  add column cancelled_by         text,
  add constraint bookings_cancelled_by_valid check (cancelled_by in ('client', 'shop', 'system'));

-- Outbox -------------------------------------------------------------------------
-- dedupe_key is the type for one-off messages and type@<epoch>[@staff] for per-appointment-time ones.
-- body is stored with the manage link removed.

create table public.scheduled_messages (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shops (id) on delete cascade,
  booking_id       uuid not null,
  client_id        uuid not null,
  type             text not null,
  dedupe_key       text not null,
  send_at          timestamptz not null,
  status           text not null default 'queued',
  skip_reason      text,
  attempts         int not null default 0,
  last_error       text,
  locked_at        timestamptz,
  sent_at          timestamptz,
  twilio_sid       text,
  delivery_status  text,
  delivered_at     timestamptz,
  error_code       int,
  body             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint scheduled_messages_type_valid check (
    type in ('confirmation', 'reminder', 'confirm_request', 'rescheduled', 'cancelled')
  ),
  constraint scheduled_messages_status_valid check (
    status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')
  ),
  constraint scheduled_messages_delivery_status_valid check (
    delivery_status in ('accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'read', 'canceled')
  ),
  constraint scheduled_messages_attempts_valid check (attempts between 0 and 10),
  constraint scheduled_messages_body_length check (char_length(body) <= 1600),
  constraint scheduled_messages_booking_dedupe_unique unique (booking_id, dedupe_key),
  constraint scheduled_messages_twilio_sid_unique unique (twilio_sid),
  constraint scheduled_messages_booking_same_shop_fk foreign key (shop_id, booking_id)
    references public.bookings (shop_id, id) on delete cascade,
  constraint scheduled_messages_client_same_shop_fk foreign key (shop_id, client_id)
    references public.clients (shop_id, id) on delete cascade
);

create index scheduled_messages_due_idx on public.scheduled_messages (send_at) where status = 'queued';
create index scheduled_messages_sending_idx on public.scheduled_messages (locked_at) where status = 'sending';
create index scheduled_messages_shop_booking_idx on public.scheduled_messages (shop_id, booking_id, created_at);
create index scheduled_messages_shop_client_idx on public.scheduled_messages (shop_id, client_id);

create trigger scheduled_messages_set_updated_at before update on public.scheduled_messages
  for each row execute function public.set_updated_at();

-- Inbound replies ------------------------------------------------------------------
-- Keyword replies (STOP/START/YES) are kept as already handled; everything else feeds the shop inbox.

create table public.inbound_messages (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  client_id   uuid,
  booking_id  uuid,
  twilio_sid  text not null,
  from_phone  text,
  body        text,
  kind        text not null,
  handled_at  timestamptz,
  handled_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint inbound_messages_kind_valid check (kind in ('opt_out', 'opt_in', 'confirm', 'other')),
  constraint inbound_messages_from_phone_format check (from_phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint inbound_messages_body_length check (char_length(body) <= 1600),
  constraint inbound_messages_shop_twilio_sid_unique unique (shop_id, twilio_sid),
  constraint inbound_messages_client_same_shop_fk foreign key (shop_id, client_id)
    references public.clients (shop_id, id) on delete set null (client_id),
  constraint inbound_messages_booking_same_shop_fk foreign key (shop_id, booking_id)
    references public.bookings (shop_id, id) on delete set null (booking_id)
);

create index inbound_messages_inbox_idx on public.inbound_messages (shop_id, created_at desc)
  where kind = 'other' and handled_at is null;
create index inbound_messages_shop_client_idx on public.inbound_messages (shop_id, client_id);
create index inbound_messages_shop_booking_idx on public.inbound_messages (shop_id, booking_id);
create index inbound_messages_handled_by_idx on public.inbound_messages (handled_by);

-- The handler always comes from the session, so a member cannot attribute it to someone else.
create function public.inbound_messages_stamp_handler()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.handled_at is null then
    new.handled_by := null;
  elsif auth.uid() is not null then
    new.handled_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger inbound_messages_stamp_handler
  before update of handled_at on public.inbound_messages
  for each row execute function public.inbound_messages_stamp_handler();

revoke execute on function public.inbound_messages_stamp_handler() from public, anon, authenticated;

-- Grants and RLS -------------------------------------------------------------------
-- Only the server (service role) writes; members read, and may mark inbox replies handled.

revoke all on table public.scheduled_messages, public.inbound_messages from anon, authenticated;
grant select on table public.scheduled_messages, public.inbound_messages to authenticated;
grant update (handled_at) on table public.inbound_messages to authenticated;

alter table public.scheduled_messages enable row level security;
alter table public.inbound_messages enable row level security;

create policy scheduled_messages_select_members on public.scheduled_messages
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy inbound_messages_select_members on public.inbound_messages
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy inbound_messages_update_members on public.inbound_messages
  for update to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- Queueing rules -------------------------------------------------------------------
-- Runs in the booking's own transaction, so every writer is covered and a rolled-back booking
-- leaves nothing behind. Whether a message actually goes out is decided at send time.

create function private.queue_booking_message(
  p_booking     public.bookings,
  p_type        text,
  p_dedupe_key  text,
  p_send_at     timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.scheduled_messages as m (shop_id, booking_id, client_id, type, dedupe_key, send_at)
  values (p_booking.shop_id, p_booking.id, p_booking.client_id, p_type, p_dedupe_key, p_send_at)
  -- A message cancelled by an earlier change comes back; one already sent or skipped stays as it is.
  on conflict on constraint scheduled_messages_booking_dedupe_unique do update set
    status = 'queued',
    send_at = excluded.send_at,
    client_id = excluded.client_id,
    skip_reason = null,
    attempts = 0,
    last_error = null
  where m.status = 'cancelled';
$$;

create function private.enqueue_booking_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_hours  int;
  v_reminder_at timestamptz;
  v_epoch       text := extract(epoch from new.starts_at)::bigint::text;
begin
  if new.source = 'walk_in' or public.is_demo_shop(new.shop_id) then
    return null;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and new.status in ('cancelled', 'completed', 'no_show') then
    update public.scheduled_messages set status = 'cancelled'
    where booking_id = new.id and status = 'queued';
    if new.status = 'cancelled' and new.cancelled_by = 'shop'
       and old.status = 'confirmed' and new.starts_at > now() then
      perform private.queue_booking_message(new, 'cancelled', 'cancelled', now());
    end if;
    return null;
  end if;

  if new.status <> 'confirmed' or new.starts_at <= now() then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    if new.starts_at is not distinct from old.starts_at and new.staff_id is not distinct from old.staff_id then
      return null;
    end if;
    update public.scheduled_messages set status = 'cancelled'
    where booking_id = new.id and status = 'queued' and type in ('reminder', 'confirm_request');
    perform private.queue_booking_message(
      new, 'rescheduled', 'rescheduled@' || v_epoch || '@' || new.staff_id::text, now()
    );
  elsif tg_op = 'INSERT' or old.status = 'pending' then
    perform private.queue_booking_message(new, 'confirmation', 'confirmation', now());
  else
    return null;
  end if;

  select sms_reminder_lead_hours into v_lead_hours from public.shops where id = new.shop_id;
  v_reminder_at := new.starts_at - make_interval(hours => v_lead_hours);
  -- Booked inside the lead window: the confirmation just went out, so no reminder.
  if v_reminder_at > now() then
    perform private.queue_booking_message(new, 'reminder', 'reminder@' || v_epoch, v_reminder_at);
  end if;
  return null;
end;
$$;

create trigger bookings_enqueue_messages
  after insert or update of status, starts_at, staff_id on public.bookings
  for each row execute function private.enqueue_booking_messages();

-- Worker claim -----------------------------------------------------------------------
-- SKIP LOCKED: concurrent ticks never claim the same row. A row stuck in 'sending' means a worker
-- died mid-send; it is failed rather than retried so a client is never texted twice.

create function public.claim_due_messages(p_limit int)
returns setof public.scheduled_messages
language plpgsql
set search_path = ''
as $$
begin
  update public.scheduled_messages
  set status = 'failed', last_error = 'unknown_outcome', locked_at = null
  where status = 'sending' and locked_at < now() - interval '10 minutes';

  return query
  update public.scheduled_messages m
  set status = 'sending', attempts = m.attempts + 1, locked_at = now()
  where m.id in (
    select d.id from public.scheduled_messages d
    where d.status = 'queued' and d.send_at <= now()
    order by d.send_at
    limit p_limit
    for update skip locked
  )
  returning m.*;
end;
$$;

revoke execute on function public.claim_due_messages(int) from public, anon, authenticated;
grant execute on function public.claim_due_messages(int) to service_role;

-- Job tick -----------------------------------------------------------------------------
-- Calls the app's /api/jobs/tick every minute. Does nothing until both Vault secrets exist, so local
-- and CI databases never call out. Set them once per environment:
--   select vault.create_secret('https://<host>/api/jobs/tick', 'jobs_tick_url');
--   select vault.create_secret('<JOBS_SECRET>', 'jobs_secret');

create function private.trigger_jobs_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url     text;
  v_secret  text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'jobs_tick_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jobs_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function private.queue_booking_message(public.bookings, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function private.enqueue_booking_messages() from public, anon, authenticated;
revoke execute on function private.trigger_jobs_tick() from public, anon, authenticated;

select cron.schedule('fullcut-jobs-tick', '* * * * *', 'select private.trigger_jobs_tick()');

-- Client merge and anonymise cover the new tables ------------------------------------------

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

create or replace function public.anonymise_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop_id   uuid;
  v_client    public.clients;
  v_bookings  int;
  v_notes     int;
begin
  select shop_id into v_shop_id from public.clients where id = p_client_id;
  if v_shop_id is null or not public.is_shop_member(v_shop_id) then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  if not public.is_shop_owner(v_shop_id) then
    raise exception 'anonymise_forbidden' using errcode = '42501';
  end if;

  select * into v_client from public.clients
  where shop_id = v_shop_id and id = p_client_id
  for update;
  if v_client.anonymised_at is not null then
    return;
  end if;

  if exists (
    select 1 from public.bookings
    where shop_id = v_shop_id
      and client_id = p_client_id
      and ends_at > now()
      and (status = 'confirmed' or (status = 'pending' and (pending_expires_at is null or pending_expires_at > now())))
  ) then
    raise exception 'client_has_upcoming_bookings' using errcode = 'P0001';
  end if;

  delete from public.client_notes where shop_id = v_shop_id and client_id = p_client_id;
  get diagnostics v_notes = row_count;

  update public.bookings set client_notes = null, cancel_reason = null
  where shop_id = v_shop_id and client_id = p_client_id;
  get diagnostics v_bookings = row_count;

  update public.booking_links set revoked_at = now()
  where shop_id = v_shop_id
    and revoked_at is null
    and booking_id in (select id from public.bookings where shop_id = v_shop_id and client_id = p_client_id);

  -- Message texts can quote names, times and replies; the delivery log itself stays.
  update public.scheduled_messages set
    body = null,
    status = case when status = 'queued' then 'cancelled' else status end
  where shop_id = v_shop_id and client_id = p_client_id;

  update public.inbound_messages set body = null, from_phone = null
  where shop_id = v_shop_id and client_id = p_client_id;

  update public.clients set
    name = 'Deleted client',
    phone_e164 = null,
    email = null,
    marketing_opt_in = false,
    marketing_opt_in_at = null,
    marketing_opt_in_method = null,
    sms_opted_out = false,
    anonymised_at = now()
  where shop_id = v_shop_id and id = p_client_id;

  insert into public.audit_events (shop_id, action, subject_id, details)
  values (
    v_shop_id, 'client_anonymise', p_client_id,
    jsonb_build_object('bookings_kept', v_bookings, 'notes_deleted', v_notes)
  );
end;
$$;
