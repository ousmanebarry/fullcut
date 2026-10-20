begin;
select plan(51);

select tests.seed_two_shops();

-- seed_two_shops' booking_a / booking_b (2030, confirmed) each queued a confirmation and a reminder.

-- Settings constraints -----------------------------------------------------------------

select throws_ok(
  $$update public.shops set sms_reminder_lead_hours = 2 where id = tests.id('shop_a')$$,
  '23514', null, 'reminder lead time is at least 3 hours'
);
select throws_ok(
  $$update public.shops set sms_sign_off = '' where id = tests.id('shop_a')$$,
  '23514', null, 'the sign-off cannot be empty'
);
select throws_ok(
  $$update public.bookings set cancelled_by = 'robot' where id = tests.id('booking_a')$$,
  '23514', null, 'cancelled_by is client, shop or system'
);

-- Queueing on create -------------------------------------------------------------------

select results_eq(
  $$select type, dedupe_key, status, send_at from public.scheduled_messages
    where booking_id = tests.id('booking_a') order by type$$,
  $$values
    ('confirmation', 'confirmation', 'queued', now()),
    ('reminder', 'reminder@' || extract(epoch from '2030-01-08 15:00Z'::timestamptz)::bigint, 'queued', '2030-01-07 15:00Z'::timestamptz)$$,
  'a new confirmed booking queues a confirmation now and a reminder 24 h before'
);

select tests.insert_booking(tests.id('staff_a2'), now() + interval '5 hours', 30, 0, 'confirmed', tests.id('soon'));
select results_eq(
  $$select type from public.scheduled_messages where booking_id = tests.id('soon')$$,
  $$values ('confirmation')$$,
  'booked inside the lead window: confirmation only, no reminder'
);

insert into public.bookings (id, shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, source, price_cents)
values (tests.id('walk_in'), tests.id('shop_a'), tests.id('staff_a2'), tests.id('client_a'), tests.id('service_a'),
  now() + interval '1 hour', now() + interval '90 minutes', now() + interval '90 minutes', 'confirmed', 'walk_in', 3000);
select is(
  (select count(*)::int from public.scheduled_messages where booking_id = tests.id('walk_in')),
  0, 'walk-ins get no texts'
);

select tests.insert_booking(tests.id('staff_a2'), '2025-03-03 15:00Z', 30, 0, 'completed', tests.id('past'));
select is(
  (select count(*)::int from public.scheduled_messages where booking_id = tests.id('past')),
  0, 'past bookings get no texts'
);

update public.shops set sms_reminder_lead_hours = 48 where id = tests.id('shop_a');
select tests.insert_booking(tests.id('staff_a2'), '2030-02-05 15:00Z', 30, 0, 'pending', tests.id('held'));
select is(
  (select count(*)::int from public.scheduled_messages where booking_id = tests.id('held')),
  0, 'a pending hold gets no texts'
);
update public.bookings set status = 'confirmed' where id = tests.id('held');
select results_eq(
  $$select type, send_at from public.scheduled_messages where booking_id = tests.id('held') order by type$$,
  $$values ('confirmation', now()), ('reminder', '2030-02-03 15:00Z'::timestamptz)$$,
  'pending -> confirmed queues the confirmation and a reminder using the shop''s lead time'
);

-- Reschedule ---------------------------------------------------------------------------

update public.bookings set
  starts_at = '2030-01-09 15:00Z', ends_at = '2030-01-09 15:30Z', blocked_until = '2030-01-09 15:40Z'
where id = tests.id('booking_a');

select results_eq(
  $$select type, status, send_at from public.scheduled_messages
    where booking_id = tests.id('booking_a') order by type, status$$,
  $$values
    ('confirmation', 'queued', now()),
    ('reminder', 'cancelled', '2030-01-07 15:00Z'::timestamptz),
    ('reminder', 'queued', '2030-01-07 15:00Z'::timestamptz),
    ('rescheduled', 'queued', now())$$,
  'reschedule cancels the old reminder, queues a new one and a rescheduled notice'
);

update public.bookings set
  starts_at = '2030-01-08 15:00Z', ends_at = '2030-01-08 15:30Z', blocked_until = '2030-01-08 15:40Z'
where id = tests.id('booking_a');

select results_eq(
  $$select status, count(*)::int from public.scheduled_messages
    where booking_id = tests.id('booking_a') and type = 'reminder' group by status order by status$$,
  $$values ('cancelled', 1), ('queued', 1)$$,
  'moving back revives the original reminder instead of adding a third'
);

update public.bookings set client_notes = 'Prefers scissors' where id = tests.id('booking_a');
select is(
  (select count(*)::int from public.scheduled_messages where booking_id = tests.id('booking_a')),
  5, 'unrelated booking edits queue nothing'
);

select throws_ok(
  $$insert into public.scheduled_messages (shop_id, booking_id, client_id, type, dedupe_key, send_at)
    values (tests.id('shop_a'), tests.id('booking_a'), tests.id('client_a'), 'confirmation', 'confirmation', now())$$,
  '23505', null, 'a duplicate message for the same booking is impossible'
);

-- Cancel and outcome -------------------------------------------------------------------

update public.bookings set status = 'cancelled', cancelled_by = 'shop' where id = tests.id('booking_a');
select is(
  (select count(*)::int from public.scheduled_messages where booking_id = tests.id('booking_a') and status = 'queued' and type <> 'cancelled'),
  0, 'cancelling cancels every queued message'
);
select is(
  (select status from public.scheduled_messages where booking_id = tests.id('booking_a') and type = 'cancelled'),
  'queued', 'a shop cancellation queues a cancelled notice'
);

update public.bookings set status = 'cancelled', cancelled_by = 'client' where id = tests.id('held');
select is(
  (select count(*)::int from public.scheduled_messages where booking_id = tests.id('held') and type = 'cancelled'),
  0, 'a client cancellation sends no notice'
);

update public.bookings set status = 'completed' where id = tests.id('soon');
select is(
  (select status from public.scheduled_messages where booking_id = tests.id('soon')),
  'cancelled', 'marking an outcome cancels queued messages'
);

-- Demo shop ----------------------------------------------------------------------------

-- The local database may already have a demo configured; this transaction is rolled back.
delete from private.demo_config;
insert into private.demo_config (shop_id, owner_user_id, slug) values (tests.id('shop_b'), tests.id('user_b'), 'test-shop-b');
select tests.insert_booking(tests.id('staff_b'), '2030-03-05 15:00Z', 30, 0, 'confirmed', tests.id('demo_booking'));
select is(
  (select count(*)::int from public.scheduled_messages where booking_id = tests.id('demo_booking')),
  0, 'the demo shop never queues texts'
);
delete from private.demo_config;

-- Worker claim -------------------------------------------------------------------------

-- Claim takes the oldest due rows first, so park everything outside the test shops (e.g. seed data).
update public.scheduled_messages set status = 'cancelled'
where status = 'queued' and shop_id not in (tests.id('shop_a'), tests.id('shop_b'));

select tests.insert_booking(tests.id('staff_a2'), '2030-04-02 15:00Z', 30, 0, 'confirmed', tests.id('claim_me'));

select is(
  (select count(*)::int from public.claim_due_messages(100) where shop_id = tests.id('shop_a')),
  2, 'claim returns the due rows (cancelled notice, new confirmation)'
);
select is(
  (select count(*)::int from public.claim_due_messages(100) where shop_id = tests.id('shop_a')),
  0, 'claimed rows are not claimed again'
);
select results_eq(
  $$select status, attempts from public.scheduled_messages where booking_id = tests.id('claim_me') and type = 'confirmation'$$,
  $$values ('sending', 1)$$,
  'claim marks rows sending and counts the attempt'
);
select is(
  (select count(*)::int from public.scheduled_messages where status = 'queued' and send_at > now() and type = 'reminder' and booking_id = tests.id('booking_b')),
  1, 'future rows are left queued'
);

update public.scheduled_messages set locked_at = now() - interval '11 minutes'
where booking_id = tests.id('claim_me') and type = 'confirmation';
select is(
  (select count(*)::int from public.claim_due_messages(100) where booking_id = tests.id('claim_me')),
  0, 'a stuck row is never re-claimed'
);
select results_eq(
  $$select status, last_error from public.scheduled_messages where booking_id = tests.id('claim_me') and type = 'confirmation'$$,
  $$values ('failed', 'unknown_outcome')$$,
  'a row stuck in sending is failed, not resent'
);

-- Job tick -----------------------------------------------------------------------------

select is(
  (select count(*)::int from cron.job where jobname = 'fullcut-jobs-tick' and schedule = '* * * * *'),
  1, 'the job tick runs every minute'
);
select lives_ok($$select private.trigger_jobs_tick()$$, 'the tick does nothing without Vault secrets');

-- Inbound fixtures ---------------------------------------------------------------------

insert into public.inbound_messages (id, shop_id, client_id, twilio_sid, from_phone, body, kind) values
  (tests.id('in_a'), tests.id('shop_a'), tests.id('client_a'), 'SM_in_a', '+15559990001', 'Running late', 'other'),
  (tests.id('in_b'), tests.id('shop_b'), tests.id('client_b'), 'SM_in_b', '+15559990002', 'Hi', 'other');

select throws_ok(
  $$insert into public.inbound_messages (shop_id, twilio_sid, kind) values (tests.id('shop_a'), 'SM_in_a', 'other')$$,
  '23505', null, 'an inbound message is stored once per shop'
);
select throws_ok(
  $$insert into public.inbound_messages (shop_id, twilio_sid, kind) values (tests.id('shop_a'), 'SM_x', 'shouting')$$,
  '23514', null, 'inbound kind is checked'
);

-- Isolation and grants -----------------------------------------------------------------

select tests.authenticate_as(tests.id('user_a'));

select is((select count(*)::int from public.scheduled_messages where shop_id <> tests.id('shop_a')), 0,
  'scheduled_messages: sees no other shop''s rows');
select ok((select count(*) from public.scheduled_messages where shop_id = tests.id('shop_a')) > 0,
  'scheduled_messages: sees own shop''s rows');
select throws_ok(
  $$insert into public.scheduled_messages (shop_id, booking_id, client_id, type, dedupe_key, send_at)
    values (tests.id('shop_a'), tests.id('booking_a'), tests.id('client_a'), 'reminder', 'x', now())$$,
  '42501', null, 'scheduled_messages: members cannot insert'
);
select throws_ok(
  $$update public.scheduled_messages set status = 'sent'$$,
  '42501', null, 'scheduled_messages: members cannot update'
);
select throws_ok(
  $$delete from public.scheduled_messages$$,
  '42501', null, 'scheduled_messages: members cannot delete'
);
select throws_ok(
  $$select public.claim_due_messages(1)$$,
  '42501', null, 'members cannot claim messages'
);

select is((select count(*)::int from public.inbound_messages where shop_id <> tests.id('shop_a')), 0,
  'inbound_messages: sees no other shop''s rows');
select is((select count(*)::int from public.inbound_messages), 1, 'inbound_messages: sees own shop''s rows');
select throws_ok(
  $$insert into public.inbound_messages (shop_id, twilio_sid, kind) values (tests.id('shop_a'), 'SM_new', 'other')$$,
  '42501', null, 'inbound_messages: members cannot insert'
);
select throws_ok(
  $$update public.inbound_messages set body = 'edited' where id = tests.id('in_a')$$,
  '42501', null, 'inbound_messages: members cannot edit the text'
);
select is(
  tests.affected($$update public.inbound_messages set handled_at = now() where id = tests.id('in_b')$$),
  0, 'inbound_messages: cannot mark another shop''s reply handled'
);
select is(
  tests.affected($$update public.inbound_messages set handled_at = now() where id = tests.id('in_a')$$),
  1, 'inbound_messages: can mark own reply handled'
);
select throws_ok(
  $$delete from public.inbound_messages$$,
  '42501', null, 'inbound_messages: members cannot delete'
);

select tests.authenticate_as(tests.id('user_a_staff'));
select is(
  tests.affected($$update public.inbound_messages set handled_at = null where id = tests.id('in_a')$$),
  1, 'staff can reopen a reply'
);
select tests.authenticate_as(tests.id('user_a'));
update public.inbound_messages set handled_at = now() where id = tests.id('in_a');
select tests.clear_authentication();

select results_eq(
  $$select handled_by from public.inbound_messages where id = tests.id('in_a')$$,
  $$values (tests.id('user_a'))$$,
  'handled_by is stamped from the session'
);

set local role anon;
select throws_ok('select * from public.scheduled_messages', '42501', null, 'anon cannot read scheduled_messages');
select throws_ok('select * from public.inbound_messages', '42501', null, 'anon cannot read inbound_messages');
reset role;

-- Merge and anonymise ------------------------------------------------------------------

insert into public.clients (id, shop_id, name) values (tests.id('client_a_dup'), tests.id('shop_a'), 'Dup');
update public.scheduled_messages set client_id = tests.id('client_a_dup') where booking_id = tests.id('booking_a') and type = 'confirmation';
update public.inbound_messages set client_id = tests.id('client_a_dup') where id = tests.id('in_a');

select tests.authenticate_as(tests.id('user_a'));
select lives_ok(
  $$select public.merge_clients(tests.id('client_a'), tests.id('client_a_dup'))$$,
  'merge works with messages on the merged client'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.scheduled_messages where client_id = tests.id('client_a_dup'))
    + (select count(*)::int from public.inbound_messages where client_id = tests.id('client_a_dup')),
  0, 'merge moves messages to the kept client'
);

insert into public.clients (id, shop_id, name, phone_e164) values (tests.id('client_gone'), tests.id('shop_a'), 'Gone', '+15559990009');
select tests.insert_booking(tests.id('staff_a2'), '2025-04-01 15:00Z', 30, 0, 'completed', tests.id('gone_booking'));
update public.bookings set client_id = tests.id('client_gone') where id = tests.id('gone_booking');
insert into public.scheduled_messages (shop_id, booking_id, client_id, type, dedupe_key, send_at, status, body)
values (tests.id('shop_a'), tests.id('gone_booking'), tests.id('client_gone'), 'confirmation', 'confirmation', '2025-03-30 15:00Z', 'sent', 'Hi Gone');
insert into public.inbound_messages (shop_id, client_id, twilio_sid, from_phone, body, kind)
values (tests.id('shop_a'), tests.id('client_gone'), 'SM_gone', '+15559990009', 'My address is...', 'other');

select tests.authenticate_as(tests.id('user_a'));
select lives_ok($$select public.anonymise_client(tests.id('client_gone'))$$, 'anonymise works with messages');
select tests.clear_authentication();
select results_eq(
  $$select body from public.scheduled_messages where client_id = tests.id('client_gone')$$,
  $$values (null::text)$$,
  'anonymise clears sent message text'
);
select results_eq(
  $$select body, from_phone from public.inbound_messages where client_id = tests.id('client_gone')$$,
  $$values (null::text, null::text)$$,
  'anonymise clears inbound text and phone'
);

-- Booking columns ----------------------------------------------------------------------

select has_column('public', 'bookings', 'client_confirmed_at', 'bookings record when the client confirmed by text');

select * from finish();
rollback;
