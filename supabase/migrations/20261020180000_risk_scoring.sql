-- No-show risk scores on bookings, risk-based confirmation (confirm-or-release) and the owner's
-- controls (docs/adr/0010-risk-scoring.md). Scores come from the ML service via the app; the
-- database only stores them, queues the planned texts and enforces who may change what.

-- Shop settings --------------------------------------------------------------------------------
-- Everything starts off: until the owner turns actions on, scores are shown but change nothing.

alter table public.shops
  add column risk_actions_enabled              boolean not null default false,
  add column risk_medium_threshold             real not null default 0.15,
  add column risk_high_threshold               real not null default 0.35,
  add column risk_medium_confirm_request       boolean not null default true,
  add column risk_medium_require_confirmation  boolean not null default false,
  add column risk_medium_extra_reminder        boolean not null default false,
  add column risk_medium_suggest_standby       boolean not null default false,
  add column risk_high_confirm_request         boolean not null default true,
  add column risk_high_require_confirmation    boolean not null default true,
  add column risk_high_extra_reminder          boolean not null default true,
  add column risk_high_suggest_standby         boolean not null default true,
  add column risk_auto_release                 boolean not null default false,
  add column risk_confirm_cap                  int not null default 3,
  add column risk_confirm_deadline_hours       int not null default 24,
  add constraint shops_risk_thresholds_valid check (
    0 < risk_medium_threshold and risk_medium_threshold < risk_high_threshold and risk_high_threshold < 1
  ),
  add constraint shops_risk_medium_confirmation_valid check (
    not risk_medium_require_confirmation or risk_medium_confirm_request
  ),
  add constraint shops_risk_high_confirmation_valid check (
    not risk_high_require_confirmation or risk_high_confirm_request
  ),
  add constraint shops_risk_confirm_cap_valid check (risk_confirm_cap between 1 and 10),
  add constraint shops_risk_confirm_deadline_valid check (risk_confirm_deadline_hours between 2 and 72);

-- Booking columns ------------------------------------------------------------------------------
-- confirmation_status is separate from status: an unconfirmed booking still blocks its slot, and a
-- release is an ordinary cancel by the shop with release_reason set.

alter table public.bookings
  add column risk_tier            text,
  add column risk_method          text,
  add column risk_factors         jsonb,
  add column risk_scored_at       timestamptz,
  add column risk_trusted_at      timestamptz,
  add column risk_trusted_by      uuid references auth.users (id) on delete set null,
  add column confirmation_status  text not null default 'not_required',
  add column confirmation_due_at  timestamptz,
  add column release_reason       text,
  add constraint bookings_risk_tier_valid check (risk_tier in ('low', 'medium', 'high', 'unknown')),
  add constraint bookings_risk_method_valid check (risk_method in ('model', 'heuristic')),
  add constraint bookings_risk_factors_valid check (
    jsonb_typeof(risk_factors) = 'array' and jsonb_array_length(risk_factors) <= 5
  ),
  add constraint bookings_risk_model_version_length check (char_length(risk_model_version) <= 64),
  add constraint bookings_confirmation_status_valid check (
    confirmation_status in ('not_required', 'requested', 'confirmed', 'unconfirmed', 'released')
  ),
  add constraint bookings_release_reason_valid check (release_reason in ('unconfirmed')),
  add constraint bookings_release_consistent check (
    (confirmation_status = 'released') = (release_reason is not null)
    and (release_reason is null or status = 'cancelled')
  );

create index bookings_risk_trusted_by_idx on public.bookings (risk_trusted_by) where risk_trusted_by is not null;
create index bookings_upcoming_confirmed_idx on public.bookings (starts_at) where status = 'confirmed';
create index bookings_confirmation_due_idx on public.bookings (confirmation_due_at)
  where confirmation_status = 'requested';

-- Members can update bookings (RLS), so the score and the confirmation timeline are guarded here:
-- signed-in users may only mark a requested confirmation as confirmed (the client phoned in).
-- The same trigger resets a pending confirmation when the booking moves; the new time is re-scored.
create function private.bookings_guard_risk()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      if new.risk_score is not null or new.risk_tier is not null or new.risk_method is not null
         or new.risk_model_version is not null or new.risk_factors is not null
         or new.risk_scored_at is not null or new.risk_trusted_at is not null
         or new.risk_trusted_by is not null or new.confirmation_status <> 'not_required'
         or new.confirmation_due_at is not null or new.release_reason is not null then
        raise exception 'risk_columns_read_only' using errcode = '42501';
      end if;
      return new;
    end if;

    if (new.risk_score, new.risk_tier, new.risk_method, new.risk_model_version, new.risk_factors,
        new.risk_scored_at, new.risk_trusted_at, new.risk_trusted_by, new.confirmation_due_at,
        new.release_reason)
       is distinct from
       (old.risk_score, old.risk_tier, old.risk_method, old.risk_model_version, old.risk_factors,
        old.risk_scored_at, old.risk_trusted_at, old.risk_trusted_by, old.confirmation_due_at,
        old.release_reason)
       or (new.confirmation_status is distinct from old.confirmation_status
           and not (new.confirmation_status = 'confirmed'
                    and old.confirmation_status in ('requested', 'unconfirmed'))) then
      raise exception 'risk_columns_read_only' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'confirmed'
     and (new.starts_at <> old.starts_at or new.staff_id <> old.staff_id)
     and new.confirmation_status in ('requested', 'unconfirmed') then
    new.confirmation_status := 'not_required';
    new.confirmation_due_at := null;
  end if;
  return new;
end;
$$;

create trigger bookings_guard_risk
  before insert or update on public.bookings
  for each row execute function private.bookings_guard_risk();

-- Outbox: risk texts -------------------------------------------------------------------------
-- final_warning names the confirmation deadline; released tells the client their slot was given up;
-- extra_reminder is the same-day nudge for risky bookings.

alter table public.scheduled_messages
  drop constraint scheduled_messages_type_valid,
  add constraint scheduled_messages_type_valid check (
    type in (
      'confirmation', 'reminder', 'confirm_request', 'rescheduled', 'cancelled',
      'final_warning', 'extra_reminder', 'released',
      'waitlist_joined', 'waitlist_offer'
    )
  );

create or replace function private.enqueue_booking_messages()
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
      if new.release_reason is not null then
        perform private.queue_booking_message(new, 'released', 'released', now());
      else
        perform private.queue_booking_message(new, 'cancelled', 'cancelled', now());
      end if;
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
    where booking_id = new.id and status = 'queued'
      and type in ('reminder', 'confirm_request', 'final_warning', 'extra_reminder');
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

-- Storing a score --------------------------------------------------------------------------
-- Called by the app (service role) after scoring. The plan's times come from lib/risk/plan.ts; a
-- booking that moved or ended since it was scored is left alone (returns null). A new plan replaces
-- the texts an earlier score queued; texts already sent stay sent.

create function public.apply_booking_risk(
  p_booking_id           uuid,
  p_starts_at            timestamptz,
  p_tier                 text,
  p_factors              jsonb,
  p_score                real default null,
  p_method               text default null,
  p_model_version        text default null,
  p_confirm_request_at   timestamptz default null,
  p_final_warning_at     timestamptz default null,
  p_extra_reminder_at    timestamptz default null,
  p_confirmation_due_at  timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking  public.bookings;
  v_epoch    text;
  v_status   text;
  v_open     boolean;
  v_queue    boolean;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'confirmed' or v_booking.starts_at <> p_starts_at then
    return null;
  end if;
  v_epoch := extract(epoch from v_booking.starts_at)::bigint::text;
  -- Trusted or already settled bookings get no confirmation texts, whatever the score says.
  v_open := v_booking.risk_trusted_at is null and v_booking.confirmation_status in ('not_required', 'requested');
  v_queue := v_booking.source <> 'walk_in' and not public.is_demo_shop(v_booking.shop_id);

  update public.scheduled_messages set status = 'cancelled'
  where booking_id = p_booking_id and status = 'queued'
    and type in ('confirm_request', 'final_warning', 'extra_reminder');

  v_status := v_booking.confirmation_status;
  if v_open then
    if p_confirm_request_at is not null then
      v_status := 'requested';
    elsif v_status = 'requested' and not exists (
      select 1 from public.scheduled_messages
      where booking_id = p_booking_id and type = 'confirm_request' and status = 'sent'
    ) then
      v_status := 'not_required';
    end if;
  end if;

  update public.bookings set
    risk_score = p_score,
    risk_tier = p_tier,
    risk_method = p_method,
    risk_model_version = p_model_version,
    risk_factors = p_factors,
    risk_scored_at = now(),
    confirmation_status = v_status,
    confirmation_due_at = case
      when v_open then case when v_status = 'requested' then p_confirmation_due_at end
      else confirmation_due_at
    end
  where id = p_booking_id
  returning * into v_booking;

  if v_queue and v_open and p_confirm_request_at is not null then
    perform private.queue_booking_message(
      v_booking, 'confirm_request', 'confirm_request@' || v_epoch, greatest(p_confirm_request_at, now())
    );
    if p_final_warning_at is not null and p_confirmation_due_at is not null then
      perform private.queue_booking_message(
        v_booking, 'final_warning', 'final_warning@' || v_epoch, greatest(p_final_warning_at, now())
      );
    end if;
  end if;
  if v_queue and v_booking.risk_trusted_at is null and p_extra_reminder_at is not null
     and p_extra_reminder_at > now() then
    perform private.queue_booking_message(
      v_booking, 'extra_reminder', 'extra_reminder@' || v_epoch, p_extra_reminder_at
    );
  end if;
  return v_booking.confirmation_status;
end;
$$;

-- Upcoming confirmed bookings to (re-)score: never scored, or last scored before the final 48 hours
-- (so a reply or a confirmation can count). Soonest first.
create function public.bookings_due_for_scoring(p_limit int)
returns table (booking_id uuid)
language sql
stable
set search_path = ''
as $$
  select b.id
  from public.bookings b
  where b.status = 'confirmed'
    and b.starts_at > now()
    and (
      b.risk_scored_at is null
      or (b.starts_at <= now() + interval '48 hours' and b.risk_scored_at < b.starts_at - interval '48 hours')
    )
  order by b.starts_at
  limit p_limit;
$$;

-- Confirmation deadlines ----------------------------------------------------------------------
-- At the deadline a still-unconfirmed booking is released only when the owner opted in, the final
-- warning really went out before the deadline, nobody marked the booking trusted, and the slot can
-- still be refilled. Otherwise it is flagged "unconfirmed" for the owner to decide.

create function public.process_confirmation_deadlines(p_limit int)
returns table (booking_id uuid, outcome text)
language plpgsql
set search_path = ''
as $$
declare
  v_booking     public.bookings;
  v_shop        public.shops;
  v_warned      boolean;
begin
  for v_booking in
    select * from public.bookings b
    where b.confirmation_status = 'requested'
      and b.confirmation_due_at <= now()
      and b.status = 'confirmed'
    order by b.confirmation_due_at
    limit p_limit
    for update skip locked
  loop
    select * into v_shop from public.shops where id = v_booking.shop_id;
    v_warned := exists (
      select 1 from public.scheduled_messages m
      where m.booking_id = v_booking.id
        and m.type = 'final_warning'
        and m.status = 'sent'
        and m.sent_at < v_booking.confirmation_due_at
    );

    if v_shop.risk_actions_enabled and v_shop.risk_auto_release and v_warned
       and v_booking.risk_trusted_at is null
       and v_booking.starts_at > now() + make_interval(mins => v_shop.waitlist_min_notice_minutes) then
      update public.bookings set
        status = 'cancelled',
        cancelled_by = 'shop',
        cancel_reason = 'Not confirmed in time',
        confirmation_status = 'released',
        release_reason = 'unconfirmed'
      where id = v_booking.id;
      booking_id := v_booking.id;
      outcome := 'released';
    else
      update public.bookings set confirmation_status = 'unconfirmed' where id = v_booking.id;
      booking_id := v_booking.id;
      outcome := 'flagged';
    end if;
    return next;
  end loop;
end;
$$;

-- Owner override ------------------------------------------------------------------------------
-- "Trust this client" for one booking: no confirmation texts, never released. Owner only.

create function public.set_booking_trust(p_booking_id uuid, p_trusted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop_id uuid;
begin
  select shop_id into v_shop_id from public.bookings where id = p_booking_id;
  if v_shop_id is null or not public.is_shop_member(v_shop_id) then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not public.is_shop_owner(v_shop_id) then
    raise exception 'trust_forbidden' using errcode = '42501';
  end if;

  if p_trusted then
    update public.bookings set
      risk_trusted_at = coalesce(risk_trusted_at, now()),
      risk_trusted_by = coalesce(risk_trusted_by, auth.uid()),
      confirmation_status = case
        when confirmation_status in ('requested', 'unconfirmed') then 'not_required' else confirmation_status
      end,
      confirmation_due_at = case
        when confirmation_status in ('requested', 'unconfirmed') then null else confirmation_due_at
      end
    where id = p_booking_id;
    update public.scheduled_messages set status = 'cancelled'
    where booking_id = p_booking_id and status = 'queued'
      and type in ('confirm_request', 'final_warning', 'extra_reminder');
  else
    update public.bookings set risk_trusted_at = null, risk_trusted_by = null where id = p_booking_id;
  end if;
end;
$$;

revoke execute on function private.bookings_guard_risk() from public, anon, authenticated;
revoke execute on function public.apply_booking_risk(
  uuid, timestamptz, text, jsonb, real, text, text, timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_booking_risk(
  uuid, timestamptz, text, jsonb, real, text, text, timestamptz, timestamptz, timestamptz, timestamptz
) to service_role;
revoke execute on function public.bookings_due_for_scoring(int) from public, anon, authenticated;
grant execute on function public.bookings_due_for_scoring(int) to service_role;
revoke execute on function public.process_confirmation_deadlines(int) from public, anon, authenticated;
grant execute on function public.process_confirmation_deadlines(int) to service_role;
revoke execute on function public.set_booking_trust(uuid, boolean) from public, anon;
grant execute on function public.set_booking_trust(uuid, boolean) to authenticated;
