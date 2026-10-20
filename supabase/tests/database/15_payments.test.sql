begin;
select plan(47);

select tests.seed_two_shops();

-- Books shop A's service with staff p_staff through the public RPC; p_deposit 0 means no hold.
create function tests.book(p_staff uuid, p_starts_at timestamptz, p_phone text, p_deposit int, p_expires timestamptz)
returns uuid
language sql
as $$
  select booking_id from public.create_public_booking(
    tests.id('shop_a'), p_staff, tests.id('service_a'),
    p_starts_at, p_starts_at + interval '30 minutes', p_starts_at + interval '40 minutes',
    3000, 'direct', 'Test Client', p_phone, '', '', false,
    md5(p_phone || p_starts_at::text) || md5(p_starts_at::text || p_phone),
    p_starts_at + interval '7 days',
    p_deposit, 0, p_expires
  );
$$;

-- Settings constraints -----------------------------------------------------------------

select throws_ok(
  $$update public.shops set deposit_mode = 'sometimes' where id = tests.id('shop_a')$$,
  '23514', null, 'deposit mode is off, all_bookings or per_service'
);
select throws_ok(
  $$update public.shops set deposit_default_percent = 101 where id = tests.id('shop_a')$$,
  '23514', null, 'a percentage deposit is at most 100%'
);
select throws_ok(
  $$update public.shops set free_cancel_hours = 200 where id = tests.id('shop_a')$$,
  '23514', null, 'free cancellation window is at most a week'
);
select throws_ok(
  $$update public.shops set stripe_account_id = 'not-an-account' where id = tests.id('shop_a')$$,
  '23514', null, 'stripe account ids look like acct_...'
);
select throws_ok(
  $$update public.services set deposit_cents = 3001 where id = tests.id('service_a')$$,
  '23514', null, 'a service deposit cannot exceed its price'
);

-- Stripe columns are server-only -------------------------------------------------------

select tests.authenticate_as(tests.id('user_a'));
select throws_ok(
  $$update public.shops set stripe_charges_enabled = true where id = tests.id('shop_a')$$,
  '42501', 'stripe_columns_server_only', 'owners cannot mark their own Stripe account as ready'
);
select throws_ok(
  $$update public.shops set stripe_account_id = 'acct_123' where id = tests.id('shop_a')$$,
  '42501', 'stripe_columns_server_only', 'owners cannot change the linked Stripe account'
);
select is(
  tests.affected($$update public.shops set deposit_mode = 'all_bookings', deposit_default_cents = 1500 where id = tests.id('shop_a')$$),
  1, 'owners can change deposit settings'
);
select tests.clear_authentication();

-- Deposit holds through the public RPC -------------------------------------------------

select throws_ok(
  $$select tests.book(tests.id('staff_a'), '2030-04-02 15:00Z', '+14165550101', 1500, now() + interval '30 minutes')$$,
  'FC002', 'payments_not_ready', 'no deposit hold before Stripe can take charges'
);

update public.shops set stripe_account_id = 'acct_testA', stripe_charges_enabled = true,
  free_cancel_hours = 48, late_cancel_keeps_deposit = false
where id = tests.id('shop_a');

select throws_ok(
  $$select tests.book(tests.id('staff_a'), '2030-04-02 15:00Z', '+14165550101', 1500, now() - interval '1 minute')$$,
  'FC002', 'payments_not_ready', 'a hold must expire in the future'
);

create temp table ids (name text primary key, id uuid);

insert into ids values ('hold1', tests.book(tests.id('staff_a'), '2030-04-02 15:00Z', '+14165550101', 1500, now() + interval '30 minutes'));

select results_eq(
  $$select status, deposit_cents, pending_expires_at from public.bookings where id = (select id from ids where name = 'hold1')$$,
  $$values ('pending'::text, 1500, now() + interval '30 minutes')$$,
  'a deposit booking is a pending hold with the deposit amount and expiry'
);
select results_eq(
  $$select status, amount_cents, platform_fee_cents, currency::text, stripe_account_id,
      free_cancel_hours, late_cancel_keeps_deposit, no_show_keeps_deposit
    from public.payments where booking_id = (select id from ids where name = 'hold1')$$,
  $$values ('pending'::text, 1500, 0, 'CAD', 'acct_testA', 48, false, true)$$,
  'the hold creates a pending payment with the shop''s account and a copy of its policy'
);
select is(
  (select count(*)::int from public.scheduled_messages where booking_id = (select id from ids where name = 'hold1')),
  0, 'a hold queues no texts'
);

insert into ids select 'plain', booking_id from public.create_public_booking(
  tests.id('shop_a'), tests.id('staff_a2'), tests.id('service_a'),
  '2030-04-02 15:00Z', '2030-04-02 15:30Z', '2030-04-02 15:40Z', 3000, 'direct', 'Plain', '+14165550102',
  '', '', false, repeat('a', 64), '2030-04-09 15:00Z'
);
select results_eq(
  $$select b.status, (select count(*)::int from public.payments p where p.booking_id = b.id)
    from public.bookings b where b.id = (select id from ids where name = 'plain')$$,
  $$values ('confirmed'::text, 0)$$,
  'the previous RPC signature still books without a deposit'
);

-- Confirming a paid deposit ------------------------------------------------------------

update public.payments set stripe_checkout_session_id = 'cs_hold1' where booking_id = (select id from ids where name = 'hold1');
select is(
  public.confirm_deposit_payment(tests.id('shop_a'), (select id from ids where name = 'hold1'), 'cs_wrong', 'pi_1'),
  'not_found', 'a session that is not the booking''s own is ignored'
);
select is(
  public.confirm_deposit_payment(tests.id('shop_b'), (select id from ids where name = 'hold1'), 'cs_hold1', 'pi_1'),
  'not_found', 'another shop''s id cannot confirm the booking'
);
select is(
  public.confirm_deposit_payment(tests.id('shop_a'), (select id from ids where name = 'hold1'), 'cs_hold1', 'pi_1'),
  'confirmed', 'payment confirms the hold'
);
select results_eq(
  $$select b.status, b.pending_expires_at, p.status, p.stripe_payment_intent_id, p.paid_at
    from public.bookings b join public.payments p on p.booking_id = b.id
    where b.id = (select id from ids where name = 'hold1')$$,
  $$values ('confirmed'::text, null::timestamptz, 'succeeded'::text, 'pi_1'::text, now())$$,
  'booking confirmed and payment recorded as succeeded'
);
select is(
  (select count(*)::int from public.scheduled_messages
    where booking_id = (select id from ids where name = 'hold1') and type = 'confirmation'),
  1, 'the confirmation text is queued once the deposit is paid'
);
select is(
  public.confirm_deposit_payment(tests.id('shop_a'), (select id from ids where name = 'hold1'), 'cs_hold1', 'pi_1'),
  'already_paid', 'a replayed payment changes nothing'
);

-- The app created the session but crashed before recording its id: the signed event still confirms it.
insert into ids values ('hold6', tests.book(tests.id('staff_a2'), '2030-04-08 15:00Z', '+14165550109', 1500, now() + interval '30 minutes'));
select is(
  public.confirm_deposit_payment(tests.id('shop_a'), (select id from ids where name = 'hold6'), 'cs_hold6', 'pi_6'),
  'confirmed', 'a payment for a session that was never recorded still confirms the hold'
);
select is(
  (select stripe_checkout_session_id from public.payments where booking_id = (select id from ids where name = 'hold6')),
  'cs_hold6', 'the session id is recorded from the event'
);

-- Checkout expiry ----------------------------------------------------------------------

insert into ids values ('hold2', tests.book(tests.id('staff_a'), '2030-04-03 15:00Z', '+14165550103', 1500, now() + interval '30 minutes'));
update public.payments set stripe_checkout_session_id = 'cs_hold2' where booking_id = (select id from ids where name = 'hold2');

select ok(
  public.expire_deposit_checkout(tests.id('shop_a'), (select id from ids where name = 'hold2'), 'cs_hold2'),
  'an expired checkout is applied'
);
select results_eq(
  $$select b.status, b.cancelled_by, p.status from public.bookings b join public.payments p on p.booking_id = b.id
    where b.id = (select id from ids where name = 'hold2')$$,
  $$values ('cancelled'::text, 'system'::text, 'expired'::text)$$,
  'expiry cancels the hold and closes the payment'
);
select ok(
  not public.expire_deposit_checkout(tests.id('shop_a'), (select id from ids where name = 'hold2'), 'cs_hold2'),
  'a replayed expiry changes nothing'
);
select ok(
  not public.expire_deposit_checkout(tests.id('shop_a'), (select id from ids where name = 'hold1'), 'cs_hold1'),
  'an expiry arriving after the payment changes nothing'
);
select is(
  (select status from public.bookings where id = (select id from ids where name = 'hold1')),
  'confirmed', 'the paid booking stays confirmed'
);

-- Hold expiry job ----------------------------------------------------------------------

insert into ids values ('hold3', tests.book(tests.id('staff_a'), '2030-04-04 15:00Z', '+14165550104', 1500, now() + interval '30 minutes'));
update public.payments set stripe_checkout_session_id = 'cs_hold3' where booking_id = (select id from ids where name = 'hold3');

select is(public.expire_pending_holds(), 0, 'holds still inside their window are kept');
update public.bookings set pending_expires_at = now() - interval '1 second' where id = (select id from ids where name = 'hold3');
select is(public.expire_pending_holds(), 1, 'the job releases a lapsed hold');
select results_eq(
  $$select b.status, b.cancelled_by, p.status from public.bookings b join public.payments p on p.booking_id = b.id
    where b.id = (select id from ids where name = 'hold3')$$,
  $$values ('cancelled'::text, 'system'::text, 'pending'::text)$$,
  'the slot is released but the payment waits for Stripe'
);

-- Paid after the hold lapsed, slot still free: the booking comes back.
select is(
  public.confirm_deposit_payment(tests.id('shop_a'), (select id from ids where name = 'hold3'), 'cs_hold3', 'pi_3'),
  'confirmed', 'a late payment revives the booking when its slot is still free'
);
select results_eq(
  $$select status, cancelled_by, cancelled_at from public.bookings where id = (select id from ids where name = 'hold3')$$,
  $$values ('confirmed'::text, null::text, null::timestamptz)$$,
  'the revived booking is an ordinary confirmed booking'
);
select is(
  (select count(*)::int from public.scheduled_messages
    where booking_id = (select id from ids where name = 'hold3') and type = 'confirmation'),
  1, 'the revived booking gets its confirmation text'
);

-- Paid after the hold lapsed and someone else took the slot: the deposit is owed back.
insert into ids values ('hold4', tests.book(tests.id('staff_a'), '2030-04-05 15:00Z', '+14165550105', 1500, now() + interval '30 minutes'));
update public.payments set stripe_checkout_session_id = 'cs_hold4' where booking_id = (select id from ids where name = 'hold4');
update public.bookings set pending_expires_at = now() - interval '1 second' where id = (select id from ids where name = 'hold4');

select lives_ok(
  $$insert into ids values ('taker', tests.book(tests.id('staff_a'), '2030-04-05 15:00Z', '+14165550106', 0, null))$$,
  'an expired hold does not block a new booking for the same slot'
);
select is(
  (select cancelled_by from public.bookings where id = (select id from ids where name = 'hold4')),
  'system', 'the stale hold was released by the new booking'
);
select is(
  public.confirm_deposit_payment(tests.id('shop_a'), (select id from ids where name = 'hold4'), 'cs_hold4', 'pi_4'),
  'refund_due', 'a late payment for a taken slot is owed back'
);
select results_eq(
  $$select b.status, p.status, p.refund_due_cents, p.refund_decided_at from public.bookings b
    join public.payments p on p.booking_id = b.id where b.id = (select id from ids where name = 'hold4')$$,
  $$values ('cancelled'::text, 'succeeded'::text, 1500, now())$$,
  'the full deposit is recorded as due'
);

-- Paid after the client cancelled the hold: also owed back.
insert into ids values ('hold5', tests.book(tests.id('staff_a'), '2030-04-06 15:00Z', '+14165550107', 1500, now() + interval '30 minutes'));
update public.payments set stripe_checkout_session_id = 'cs_hold5' where booking_id = (select id from ids where name = 'hold5');
update public.bookings set status = 'cancelled', cancelled_by = 'client' where id = (select id from ids where name = 'hold5');
select is(
  public.confirm_deposit_payment(tests.id('shop_a'), (select id from ids where name = 'hold5'), 'cs_hold5', 'pi_5'),
  'refund_due', 'a payment after the client cancelled is owed back'
);

select throws_ok(
  $$delete from public.bookings where id = (select id from ids where name = 'hold1')$$,
  '23503', null, 'a booking with a payment record cannot be deleted'
);

-- Isolation and grants -----------------------------------------------------------------

insert into public.payments (shop_id, booking_id, stripe_account_id, amount_cents, currency, free_cancel_hours,
  late_cancel_keeps_deposit, no_show_keeps_deposit)
values (tests.id('shop_b'), tests.id('booking_b'), 'acct_testB', 1000, 'CAD', 24, true, true);

select tests.authenticate_as(tests.id('user_a'));
select is((select count(*)::int from public.payments where shop_id <> tests.id('shop_a')), 0,
  'payments: sees no other shop''s rows');
select ok((select count(*) from public.payments where shop_id = tests.id('shop_a')) > 0,
  'payments: sees own shop''s rows');
select throws_ok(
  $$insert into public.payments (shop_id, booking_id, stripe_account_id, amount_cents, currency, free_cancel_hours,
      late_cancel_keeps_deposit, no_show_keeps_deposit)
    values (tests.id('shop_a'), tests.id('booking_a'), 'acct_x', 100, 'CAD', 24, true, true)$$,
  '42501', null, 'payments: members cannot insert'
);
select throws_ok($$update public.payments set refund_due_cents = 0$$, '42501', null, 'payments: members cannot update');
select throws_ok($$delete from public.payments$$, '42501', null, 'payments: members cannot delete');
select throws_ok($$select public.expire_pending_holds()$$, '42501', null, 'members cannot run the hold expiry');

select tests.authenticate_as(tests.id('user_a_staff'));
select ok((select count(*) from public.payments) > 0, 'staff members can read their shop''s payments');
select tests.clear_authentication();

-- Demo shop ----------------------------------------------------------------------------

-- The local database may already have a demo configured; this transaction is rolled back.
delete from private.demo_config;
insert into private.demo_config (shop_id, owner_user_id, slug) values (tests.id('shop_a'), tests.id('user_a'), 'test-shop-a');
select throws_ok(
  $$select tests.book(tests.id('staff_a2'), '2030-04-07 15:00Z', '+14165550108', 1500, now() + interval '30 minutes')$$,
  'FC002', 'payments_not_ready', 'the demo shop never takes deposits'
);

select * from finish();
rollback;
