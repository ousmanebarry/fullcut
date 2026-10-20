-- Deposits with Stripe Connect: shop payment settings, the payments ledger, deposit holds in the public
-- booking write, and the state changes driven by Stripe webhooks (docs/adr/0009-payments-charge-model.md).

-- Shop settings ------------------------------------------------------------------

alter table public.shops
  add column stripe_account_id          text,
  add column stripe_charges_enabled     boolean not null default false,
  add column stripe_details_submitted   boolean not null default false,
  add column deposit_mode               text not null default 'off',
  add column deposit_default_type       text not null default 'fixed',
  add column deposit_default_cents      int not null default 0,
  add column deposit_default_percent    int not null default 0,
  add column free_cancel_hours          int not null default 24,
  add column late_cancel_keeps_deposit  boolean not null default true,
  add column no_show_keeps_deposit      boolean not null default true,
  add constraint shops_stripe_account_id_format check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  add constraint shops_stripe_account_id_unique unique (stripe_account_id),
  add constraint shops_deposit_mode_valid check (deposit_mode in ('off', 'all_bookings', 'per_service')),
  add constraint shops_deposit_default_type_valid check (deposit_default_type in ('fixed', 'percent')),
  add constraint shops_deposit_default_cents_valid check (deposit_default_cents between 0 and 100000),
  add constraint shops_deposit_default_percent_valid check (deposit_default_percent between 0 and 100),
  add constraint shops_free_cancel_hours_valid check (free_cancel_hours between 0 and 168);

alter table public.services
  add constraint services_price_not_below_deposit check (deposit_cents <= price_cents);

-- Owners may edit their shop row, but the Stripe link and status come only from the server.
create function public.shops_guard_stripe_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and (
    new.stripe_account_id is distinct from old.stripe_account_id
    or new.stripe_charges_enabled is distinct from old.stripe_charges_enabled
    or new.stripe_details_submitted is distinct from old.stripe_details_submitted
  ) then
    raise exception 'stripe_columns_server_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger shops_guard_stripe_columns
  before update on public.shops
  for each row execute function public.shops_guard_stripe_columns();

revoke execute on function public.shops_guard_stripe_columns() from public, anon, authenticated;

-- Payments -----------------------------------------------------------------------
-- One deposit per booking. The cancellation policy is copied from the shop when the client books,
-- because that is the policy they agreed to. refund_due_cents is the total that should be refunded;
-- refunded_cents is what Stripe reports as refunded.

create table public.payments (
  id                          uuid primary key default gen_random_uuid(),
  shop_id                     uuid not null references public.shops (id) on delete cascade,
  booking_id                  uuid not null,
  stripe_account_id           text not null,
  stripe_checkout_session_id  text,
  stripe_payment_intent_id    text,
  amount_cents                int not null,
  platform_fee_cents          int not null default 0,
  currency                    char(3) not null,
  status                      text not null default 'pending',
  free_cancel_hours           int not null,
  late_cancel_keeps_deposit   boolean not null,
  no_show_keeps_deposit       boolean not null,
  paid_at                     timestamptz,
  refund_due_cents            int not null default 0,
  refund_decided_at           timestamptz,
  refunded_cents              int not null default 0,
  refund_owed_cents           int generated always as (refund_due_cents - refunded_cents) stored,
  refund_error                text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint payments_shop_booking_unique unique (shop_id, booking_id),
  constraint payments_checkout_session_unique unique (stripe_checkout_session_id),
  constraint payments_status_valid check (status in ('pending', 'succeeded', 'expired')),
  constraint payments_amount_positive check (amount_cents > 0),
  constraint payments_platform_fee_valid check (platform_fee_cents between 0 and amount_cents),
  constraint payments_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint payments_refund_due_valid check (refund_due_cents between 0 and amount_cents),
  constraint payments_refunded_valid check (refunded_cents between 0 and amount_cents),
  constraint payments_refund_needs_payment check (status = 'succeeded' or (refund_due_cents = 0 and refunded_cents = 0)),
  constraint payments_refund_error_length check (char_length(refund_error) <= 500),
  constraint payments_paid_at_matches_status check ((status = 'succeeded') = (paid_at is not null)),
  -- No cascade: a booking with a payment record cannot be deleted.
  constraint payments_booking_same_shop_fk foreign key (shop_id, booking_id)
    references public.bookings (shop_id, id)
);

create index payments_shop_created_idx on public.payments (shop_id, created_at desc);
create index payments_refund_owed_idx on public.payments (id) where refund_owed_cents > 0;

create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- Written only by the server (service role); members read, the payments list is owner-only in the app.
revoke all on table public.payments from anon, authenticated;
grant select on table public.payments to authenticated;

alter table public.payments enable row level security;

create policy payments_select_members on public.payments
  for select to authenticated
  using (public.is_shop_member(shop_id));

-- Public booking write with an optional deposit hold -----------------------------
-- With p_deposit_cents > 0 the booking is a `pending` hold until p_pending_expires_at and a pending
-- payment row is created in the same transaction. The previous signature stays (deposit-free) so the
-- app version deployed before this migration keeps working.

create function public.create_public_booking(
  p_shop_id             uuid,
  p_staff_id            uuid,
  p_service_id          uuid,
  p_starts_at           timestamptz,
  p_ends_at             timestamptz,
  p_blocked_until       timestamptz,
  p_price_cents         int,
  p_source              text,
  p_client_name         text,
  p_phone_e164          text,
  p_email               text,
  p_notes               text,
  p_marketing_opt_in    boolean,
  p_token_hash          text,
  p_link_expires_at     timestamptz,
  p_deposit_cents       int,
  p_platform_fee_cents  int,
  p_pending_expires_at  timestamptz
)
returns table (booking_id uuid, client_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_shop        public.shops;
  v_client_id   uuid;
  v_booking_id  uuid;
  v_active      int;
  v_hold        boolean := p_deposit_cents > 0;
begin
  -- Serialise per phone so parallel requests cannot both slip under the cap.
  perform pg_advisory_xact_lock(hashtextextended('fullcut.public_booking:' || p_shop_id::text || ':' || p_phone_e164, 0));

  select * into v_shop from public.shops where id = p_shop_id;
  if not found then
    raise exception 'shop_not_found' using errcode = 'P0002';
  end if;

  if v_hold and (
    not v_shop.stripe_charges_enabled
    or v_shop.stripe_account_id is null
    or p_pending_expires_at is null
    or p_pending_expires_at <= now()
    or public.is_demo_shop(p_shop_id)
  ) then
    raise exception 'payments_not_ready' using errcode = 'FC002';
  end if;

  -- A stale hold must never block a real client.
  update public.bookings
  set status = 'cancelled', cancelled_by = 'system'
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

  if v_active >= v_shop.max_active_bookings_per_phone then
    raise exception 'max_active_bookings' using errcode = 'FC001';
  end if;

  insert into public.bookings (
    shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until,
    status, pending_expires_at, source, price_cents, deposit_cents, client_notes
  )
  values (
    p_shop_id, p_staff_id, v_client_id, p_service_id, p_starts_at, p_ends_at, p_blocked_until,
    case when v_hold then 'pending' else 'confirmed' end,
    case when v_hold then p_pending_expires_at end,
    p_source, p_price_cents, greatest(p_deposit_cents, 0), nullif(p_notes, '')
  )
  returning id into v_booking_id;

  insert into public.booking_links (shop_id, booking_id, token_hash, expires_at)
  values (p_shop_id, v_booking_id, p_token_hash, p_link_expires_at);

  if v_hold then
    insert into public.payments (
      shop_id, booking_id, stripe_account_id, amount_cents, platform_fee_cents, currency,
      free_cancel_hours, late_cancel_keeps_deposit, no_show_keeps_deposit
    )
    values (
      p_shop_id, v_booking_id, v_shop.stripe_account_id, p_deposit_cents, p_platform_fee_cents, v_shop.currency,
      v_shop.free_cancel_hours, v_shop.late_cancel_keeps_deposit, v_shop.no_show_keeps_deposit
    );
  end if;

  return query select v_booking_id, v_client_id;
end;
$$;

revoke execute on function public.create_public_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, int, text, text, text, text, text, boolean, text, timestamptz,
  int, int, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_public_booking(
  uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, int, text, text, text, text, text, boolean, text, timestamptz,
  int, int, timestamptz
) to service_role;

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
set search_path = ''
as $$
  select * from public.create_public_booking(
    p_shop_id, p_staff_id, p_service_id, p_starts_at, p_ends_at, p_blocked_until, p_price_cents, p_source,
    p_client_name, p_phone_e164, p_email, p_notes, p_marketing_opt_in, p_token_hash, p_link_expires_at,
    0, 0, null::timestamptz
  );
$$;

-- Webhook-driven state changes ---------------------------------------------------
-- Each is conditional on the current state, so replayed or out-of-order events change nothing.

-- Returns 'not_found', 'already_paid', 'confirmed' (hold confirmed, or a lapsed hold revived because its
-- slot was still free) or 'refund_due' (the booking can no longer happen; the full deposit is owed back).
create function public.confirm_deposit_payment(
  p_shop_id            uuid,
  p_booking_id         uuid,
  p_session_id         text,
  p_payment_intent_id  text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_payment  public.payments;
  v_booking  public.bookings;
begin
  select * into v_payment from public.payments
  where shop_id = p_shop_id and booking_id = p_booking_id
  for update;
  -- A null session id means the app created the session but failed to record it; the signed event is the source.
  if not found or coalesce(v_payment.stripe_checkout_session_id, p_session_id) <> p_session_id then
    return 'not_found';
  end if;
  if v_payment.status = 'succeeded' then
    return 'already_paid';
  end if;

  update public.payments
  set status = 'succeeded', stripe_checkout_session_id = p_session_id,
    stripe_payment_intent_id = p_payment_intent_id, paid_at = now()
  where id = v_payment.id;

  select * into v_booking from public.bookings where id = p_booking_id for update;

  if v_booking.status = 'pending' then
    update public.bookings set status = 'confirmed', pending_expires_at = null where id = p_booking_id;
    return 'confirmed';
  end if;
  if v_booking.status in ('confirmed', 'completed', 'no_show') then
    return 'confirmed';
  end if;

  -- Paid after the hold lapsed: revive it if nobody has taken the slot since.
  if v_booking.status = 'cancelled' and coalesce(v_booking.cancelled_by, 'system') = 'system'
     and v_booking.starts_at > now() then
    begin
      -- Via pending so the messaging trigger treats it like any confirmed hold.
      update public.bookings set status = 'pending', cancelled_by = null where id = p_booking_id;
      update public.bookings set status = 'confirmed', pending_expires_at = null where id = p_booking_id;
      return 'confirmed';
    exception when exclusion_violation then
      null;
    end;
  end if;

  update public.payments
  set refund_due_cents = amount_cents, refund_decided_at = now()
  where id = v_payment.id;
  return 'refund_due';
end;
$$;

-- Checkout expired or abandoned: the payment is closed and the hold released.
create function public.expire_deposit_checkout(p_shop_id uuid, p_booking_id uuid, p_session_id text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  update public.payments set status = 'expired', stripe_checkout_session_id = p_session_id
  where shop_id = p_shop_id and booking_id = p_booking_id
    and coalesce(stripe_checkout_session_id, p_session_id) = p_session_id and status = 'pending'
  returning * into v_payment;
  if not found then
    return false;
  end if;

  update public.bookings set status = 'cancelled', cancelled_by = 'system'
  where shop_id = p_shop_id and id = p_booking_id and status = 'pending';
  return true;
end;
$$;

-- Job: releases every hold past its expiry. Payments stay pending until Stripe reports the session
-- expired, because a client can still be finishing the payment at the boundary.
create function public.expire_pending_holds()
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.bookings set status = 'cancelled', cancelled_by = 'system'
  where status = 'pending' and pending_expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.confirm_deposit_payment(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.expire_deposit_checkout(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.expire_pending_holds() from public, anon, authenticated;
grant execute on function public.confirm_deposit_payment(uuid, uuid, text, text) to service_role;
grant execute on function public.expire_deposit_checkout(uuid, uuid, text) to service_role;
grant execute on function public.expire_pending_holds() to service_role;
