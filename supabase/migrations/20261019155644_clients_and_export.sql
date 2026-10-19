-- Client book and data export: private notes, an owner-only audit log, per-client visit stats,
-- merging duplicate clients and anonymising a client on request
-- (docs/adr/0006-client-data-export-and-deletion.md).

-- Clients --------------------------------------------------------------------

alter table public.clients
  add column anonymised_at timestamptz,
  add constraint clients_anonymised_no_contact check (
    anonymised_at is null or (phone_e164 is null and email is null)
  );

-- Staff keep read and edit; deleting a client row is owner-only.
drop policy clients_members_all on public.clients;

create policy clients_select_members on public.clients
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy clients_insert_members on public.clients
  for insert to authenticated
  with check (public.is_shop_member(shop_id));

create policy clients_update_members on public.clients
  for update to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy clients_delete_owners on public.clients
  for delete to authenticated
  using (public.is_shop_owner(shop_id));

-- Private notes ----------------------------------------------------------------

create table public.client_notes (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops (id) on delete cascade,
  client_id       uuid not null,
  author_user_id  uuid default auth.uid() references auth.users (id) on delete set null,
  body            text not null,
  created_at      timestamptz not null default now(),
  constraint client_notes_body_length check (char_length(btrim(body)) between 1 and 1000),
  constraint client_notes_client_same_shop_fk foreign key (shop_id, client_id)
    references public.clients (shop_id, id) on delete cascade
);

create index client_notes_client_created_at_idx on public.client_notes (client_id, created_at desc);

alter table public.client_notes enable row level security;

create policy client_notes_select_members on public.client_notes
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy client_notes_insert_members on public.client_notes
  for insert to authenticated
  with check (public.is_shop_member(shop_id) and author_user_id = (select auth.uid()));

create policy client_notes_update_author_or_owner on public.client_notes
  for update to authenticated
  using (
    public.is_shop_owner(shop_id)
    or (public.is_shop_member(shop_id) and author_user_id = (select auth.uid()))
  )
  with check (
    public.is_shop_owner(shop_id)
    or (public.is_shop_member(shop_id) and author_user_id = (select auth.uid()))
  );

create policy client_notes_delete_author_or_owner on public.client_notes
  for delete to authenticated
  using (
    public.is_shop_owner(shop_id)
    or (public.is_shop_member(shop_id) and author_user_id = (select auth.uid()))
  );

-- Audit log ----------------------------------------------------------------------
-- Append-only record of sensitive owner actions. details holds ids and counts, never personal data.

create table public.audit_events (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops (id) on delete cascade,
  actor_user_id  uuid references auth.users (id) on delete set null,
  actor_email    text,
  action         text not null,
  subject_id     uuid,
  details        jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  constraint audit_events_action_valid check (action in ('client_merge', 'client_anonymise', 'export'))
);

create index audit_events_shop_created_at_idx on public.audit_events (shop_id, created_at desc);

-- The actor always comes from the session, so a caller cannot write someone else's name into the log.
create function public.audit_events_stamp_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.actor_user_id := auth.uid();
    new.actor_email := auth.jwt() ->> 'email';
  end if;
  return new;
end;
$$;

create trigger audit_events_stamp_actor
  before insert on public.audit_events
  for each row execute function public.audit_events_stamp_actor();

alter table public.audit_events enable row level security;

create policy audit_events_select_owners on public.audit_events
  for select to authenticated
  using (public.is_shop_owner(shop_id));

create policy audit_events_insert_owners on public.audit_events
  for insert to authenticated
  with check (public.is_shop_owner(shop_id));

-- Grants -----------------------------------------------------------------------

revoke all on table public.client_notes, public.audit_events from anon;
revoke truncate, references, trigger on table public.client_notes, public.audit_events from authenticated;
revoke update, delete on table public.audit_events from authenticated;

-- Visit stats --------------------------------------------------------------------
-- One row per client; security_invoker keeps the clients and bookings RLS policies in force.

create view public.client_stats
with (security_invoker = true)
as
select
  c.id,
  c.shop_id,
  c.name,
  c.phone_e164,
  c.email,
  c.anonymised_at,
  c.created_at,
  s.visits,
  s.no_shows,
  s.cancellations,
  s.total_bookings,
  s.last_visit_at,
  s.next_booking_at,
  s.avg_spend_cents
from public.clients c
cross join lateral (
  select
    count(*) filter (where b.status = 'completed')::int as visits,
    count(*) filter (where b.status = 'no_show')::int as no_shows,
    count(*) filter (where b.status = 'cancelled')::int as cancellations,
    count(*)::int as total_bookings,
    max(b.starts_at) filter (where b.status = 'completed') as last_visit_at,
    min(b.starts_at) filter (
      where b.starts_at > now()
        and (b.status = 'confirmed' or (b.status = 'pending' and (b.pending_expires_at is null or b.pending_expires_at > now())))
    ) as next_booking_at,
    round(avg(b.price_cents) filter (where b.status = 'completed'))::int as avg_spend_cents
  from public.bookings b
  where b.shop_id = c.shop_id
    and b.client_id = c.id
) s;

revoke all on table public.client_stats from anon, authenticated;
grant select on table public.client_stats to authenticated;

-- Merge --------------------------------------------------------------------------
-- Folds p_merge_id into p_keep_id: bookings and notes move, empty fields are filled from the merged
-- client, and p_contact (name, phone_e164, email the owner was saving) is applied last.
-- Security definer so it can write the audit row; every statement filters by the checked shop.

create function public.merge_clients(p_keep_id uuid, p_merge_id uuid, p_contact jsonb default null)
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

revoke execute on function public.merge_clients(uuid, uuid, jsonb) from public, anon;
grant execute on function public.merge_clients(uuid, uuid, jsonb) to authenticated;

-- Anonymise ------------------------------------------------------------------------
-- "Delete client data": contact details and notes go, booking rows stay (stats and ML keep working).
-- Security definer because manage links are server-only (no RLS policies).

create function public.anonymise_client(p_client_id uuid)
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

revoke execute on function public.anonymise_client(uuid) from public, anon;
grant execute on function public.anonymise_client(uuid) to authenticated;
