begin;
select plan(30);

select tests.seed_two_shops();

-- tests.insert_booking may pick any shop A client, so lift the per-phone cap out of the way.
update public.shops set waitlist_enabled = true, max_active_bookings_per_phone = 20 where id = tests.id('shop_a');

insert into public.clients (id, shop_id, name, phone_e164, first_source) values
  (tests.id('client_a2'), tests.id('shop_a'), 'Client A2', '+14165550111', 'instagram'),
  (tests.id('client_a3'), tests.id('shop_a'), 'Client A3', '+14165550112', 'referral');

-- Freed-slot detection ----------------------------------------------------------------------

update public.bookings set status = 'cancelled', cancelled_by = 'client' where id = tests.id('booking_a');

select results_eq(
  $$select staff_id, starts_at, ends_at, status, wave from public.freed_slots where freed_booking_id = tests.id('booking_a')$$,
  $$values (tests.id('staff_a'), '2030-01-08 15:00Z'::timestamptz, '2030-01-08 15:40Z'::timestamptz, 'pending', 0)$$,
  'cancelling a confirmed booking queues its freed time, buffer included'
);

select is(
  (select count(*)::int from public.freed_slots where freed_booking_id = tests.id('booking_b')),
  0, 'nothing is queued while nothing is freed'
);

update public.bookings set status = 'cancelled' where id = tests.id('booking_b');
select is(
  (select count(*)::int from public.freed_slots where shop_id = tests.id('shop_b')),
  0, 'a shop with the waitlist off queues nothing'
);

select tests.insert_booking(tests.id('staff_a'), '2030-01-09 15:00Z', 30, 10, 'confirmed', tests.id('moving'));
update public.bookings set
  starts_at = '2030-01-10 15:00Z', ends_at = '2030-01-10 15:30Z', blocked_until = '2030-01-10 15:40Z'
where id = tests.id('moving');
select results_eq(
  $$select starts_at, ends_at from public.freed_slots where freed_booking_id = tests.id('moving')$$,
  $$values ('2030-01-09 15:00Z'::timestamptz, '2030-01-09 15:40Z'::timestamptz)$$,
  'rescheduling frees the old time'
);

update public.bookings set staff_id = tests.id('staff_a2') where id = tests.id('moving');
select is(
  (select count(*)::int from public.freed_slots where freed_booking_id = tests.id('moving')),
  2, 'moving to another staff member frees the time too'
);

select tests.insert_booking(tests.id('staff_a'), now() + interval '30 minutes', 30, 0, 'confirmed', tests.id('soon'));
update public.bookings set status = 'cancelled' where id = tests.id('soon');
select is(
  (select count(*)::int from public.freed_slots where freed_booking_id = tests.id('soon')),
  0, 'a slot inside the minimum notice is not queued'
);

select tests.insert_booking(tests.id('staff_a'), '2025-03-03 15:00Z', 30, 0, 'confirmed', tests.id('past'));
update public.bookings set status = 'completed' where id = tests.id('past');
select is(
  (select count(*)::int from public.freed_slots where freed_booking_id = tests.id('past')),
  0, 'completing a booking frees nothing'
);

-- Waves ---------------------------------------------------------------------------------------

insert into public.waitlist_entries (id, shop_id, client_id, service_id, earliest_date, latest_date, request_method) values
  (tests.id('entry_1'), tests.id('shop_a'), tests.id('client_a2'), tests.id('service_a'), '2030-01-01', '2030-01-31', 'booking_page'),
  (tests.id('entry_2'), tests.id('shop_a'), tests.id('client_a3'), tests.id('service_a'), '2030-01-01', '2030-01-31', 'booking_page');

create temporary table slot on commit drop as
select id from public.freed_slots where freed_booking_id = tests.id('booking_a');

select is(
  public.create_slot_offers(
    (select id from slot),
    jsonb_build_array(
      jsonb_build_object('entry_id', tests.id('entry_1'), 'service_id', tests.id('service_a'),
        'starts_at', '2030-01-08 15:00Z', 'ends_at', '2030-01-08 15:30Z', 'blocked_until', '2030-01-08 15:40Z'),
      jsonb_build_object('entry_id', tests.id('entry_2'), 'service_id', tests.id('service_a'),
        'starts_at', '2030-01-08 15:00Z', 'ends_at', '2030-01-08 15:30Z', 'blocked_until', '2030-01-08 15:40Z')
    ),
    '2030-01-08 14:00Z', '2030-01-08 14:00Z'
  ),
  2, 'a wave creates one offer per candidate'
);

select results_eq(
  $$select status, wave, next_run_at, locked_at is null from public.freed_slots where id = (select id from slot)$$,
  $$values ('offering', 1, '2030-01-08 14:00Z'::timestamptz, true)$$,
  'the refill moves to wave 1 and waits for the offers to expire'
);

select results_eq(
  $$select count(*)::int, count(*) filter (where m.status = 'queued')::int
    from public.scheduled_messages m join public.slot_offers o on o.id = m.slot_offer_id
    where o.freed_slot_id = (select id from slot) and m.type = 'waitlist_offer'$$,
  $$values (2, 2)$$,
  'each offer queues its text'
);

select is(
  public.create_slot_offers(
    (select id from slot),
    jsonb_build_array(jsonb_build_object('entry_id', tests.id('entry_1'), 'service_id', tests.id('service_a'),
      'starts_at', '2030-01-08 15:00Z', 'ends_at', '2030-01-08 15:30Z', 'blocked_until', '2030-01-08 15:40Z')),
    '2030-01-08 14:00Z', '2030-01-08 14:00Z'
  ),
  0, 'a client is never offered the same slot twice'
);

-- Claims --------------------------------------------------------------------------------------

update public.slot_offers set token_hash = repeat('1', 64) where waitlist_entry_id = tests.id('entry_1');
update public.slot_offers set token_hash = repeat('2', 64) where waitlist_entry_id = tests.id('entry_2');

select results_eq(
  $$select outcome, booking_id from public.claim_slot_offer(repeat('9', 64), repeat('8', 64))$$,
  $$values ('invalid', null::uuid)$$,
  'an unknown token is rejected'
);

create temporary table claimed on commit drop as
select * from public.claim_slot_offer(repeat('1', 64), repeat('a', 64));

select is((select outcome from claimed), 'booked', 'the first claim books the slot');

select results_eq(
  $$select status, source, slot_offer_id, client_id, staff_id, starts_at, price_cents
    from public.bookings where id = (select booking_id from claimed)$$,
  $$select 'confirmed', 'waitlist', o.id, tests.id('client_a2'), tests.id('staff_a'), '2030-01-08 15:00Z'::timestamptz, 3000
    from public.slot_offers o where o.waitlist_entry_id = tests.id('entry_1')$$,
  'the booking comes from the waitlist and points at its offer'
);

select is(
  (select first_source from public.clients where id = tests.id('client_a2')),
  'instagram', 'claiming leaves the client''s first source alone'
);

select ok(
  exists (select 1 from public.booking_links where booking_id = (select booking_id from claimed) and token_hash = repeat('a', 64)),
  'the claim issues a manage link'
);

select results_eq(
  $$select waitlist_entry_id, status from public.slot_offers where freed_slot_id = (select id from slot) order by waitlist_entry_id = tests.id('entry_2')$$,
  $$values (tests.id('entry_1'), 'claimed'), (tests.id('entry_2'), 'taken')$$,
  'the winner''s offer is claimed and the rest of the wave is taken'
);

select is(
  (select status from public.scheduled_messages
   where slot_offer_id = (select id from public.slot_offers where waitlist_entry_id = tests.id('entry_2'))),
  'cancelled', 'a taken offer''s unsent text is cancelled'
);

select results_eq(
  $$select (select status from public.waitlist_entries where id = tests.id('entry_1')),
           (select status from public.waitlist_entries where id = tests.id('entry_2')),
           (select status from public.freed_slots where id = (select id from slot))$$,
  $$values ('booked', 'active', 'filled')$$,
  'the winner''s entry is booked, the loser stays on the waitlist, the refill is filled'
);

select is(
  (select type from public.scheduled_messages where booking_id = (select booking_id from claimed) and type = 'confirmation'),
  'confirmation', 'the claimed booking gets the normal confirmation text'
);

select results_eq(
  $$select outcome from public.claim_slot_offer(repeat('2', 64), repeat('b', 64))$$,
  $$values ('taken')$$,
  'the second claimant is told the slot is taken'
);

select results_eq(
  $$select outcome, booking_id from public.claim_slot_offer(repeat('1', 64), repeat('c', 64))$$,
  $$select 'claimed', booking_id from claimed$$,
  'reusing a claimed link books nothing new'
);

-- A slot booked directly withdraws open offers; claiming one then fails ----------------------

select tests.insert_booking(tests.id('staff_a'), '2030-01-15 15:00Z', 30, 10, 'confirmed', tests.id('freed_2'));
update public.bookings set status = 'cancelled' where id = tests.id('freed_2');
insert into public.waitlist_entries (id, shop_id, client_id, service_id, earliest_date, latest_date, request_method)
values (tests.id('entry_3'), tests.id('shop_a'), tests.id('client_a3'), tests.id('service_a'), '2030-01-01', '2030-01-31', 'staff');

select public.create_slot_offers(
  (select id from public.freed_slots where freed_booking_id = tests.id('freed_2')),
  jsonb_build_array(jsonb_build_object('entry_id', tests.id('entry_3'), 'service_id', tests.id('service_a'),
    'starts_at', '2030-01-15 15:00Z', 'ends_at', '2030-01-15 15:30Z', 'blocked_until', '2030-01-15 15:40Z')),
  '2030-01-15 14:00Z', '2030-01-15 14:00Z'
);
update public.slot_offers set token_hash = repeat('3', 64) where waitlist_entry_id = tests.id('entry_3');

select tests.insert_booking(tests.id('staff_a'), '2030-01-15 15:15Z', 30, 0, 'confirmed');

select is(
  (select status from public.slot_offers where waitlist_entry_id = tests.id('entry_3')),
  'withdrawn', 'booking the time directly withdraws the open offer'
);
select is(
  (select status from public.scheduled_messages
   where slot_offer_id = (select id from public.slot_offers where waitlist_entry_id = tests.id('entry_3'))),
  'cancelled', 'and its unsent text'
);
select results_eq(
  $$select outcome from public.claim_slot_offer(repeat('3', 64), repeat('d', 64))$$,
  $$values ('taken')$$,
  'opening a withdrawn offer shows it as taken'
);

-- Overlap is still settled by bookings_no_overlap -----------------------------------------------

select tests.insert_booking(tests.id('staff_a'), '2030-01-22 15:00Z', 30, 10, 'confirmed', tests.id('freed_3'));
update public.bookings set status = 'cancelled' where id = tests.id('freed_3');
select public.create_slot_offers(
  (select id from public.freed_slots where freed_booking_id = tests.id('freed_3')),
  jsonb_build_array(jsonb_build_object('entry_id', tests.id('entry_3'), 'service_id', tests.id('service_a'),
    'starts_at', '2030-01-22 15:00Z', 'ends_at', '2030-01-22 15:30Z', 'blocked_until', '2030-01-22 15:40Z')),
  '2030-01-22 14:00Z', '2030-01-22 14:00Z'
);
update public.slot_offers set token_hash = repeat('4', 64)
where waitlist_entry_id = tests.id('entry_3') and starts_at = '2030-01-22 15:00Z';

-- Skip the withdraw trigger to simulate a booking that slipped in without touching the offer.
set local session_replication_role = replica;
select tests.insert_booking(tests.id('staff_a'), '2030-01-22 15:00Z', 30, 0, 'confirmed');
set local session_replication_role = origin;

select results_eq(
  $$select outcome from public.claim_slot_offer(repeat('4', 64), repeat('e', 64))$$,
  $$values ('taken')$$,
  'a claim that would overlap another booking is refused'
);
select is(
  (select status from public.waitlist_entries where id = tests.id('entry_3')),
  'active', 'and the client stays on the waitlist'
);

-- Expiry --------------------------------------------------------------------------------------------

update public.slot_offers set expires_at = now() - interval '1 minute', status = 'sent', token_hash = repeat('5', 64)
where waitlist_entry_id = tests.id('entry_3') and starts_at = '2030-01-22 15:00Z';
select results_eq(
  $$select outcome from public.claim_slot_offer(repeat('5', 64), repeat('f', 64))$$,
  $$values ('expired')$$,
  'an expired offer cannot be claimed'
);

update public.waitlist_entries set latest_date = '2025-01-01', earliest_date = '2025-01-01' where id = tests.id('entry_2');
select results_eq(
  $$select offers_expired >= 1, entries_expired >= 1 from public.expire_waitlist()$$,
  $$values (true, true)$$,
  'the expiry job closes overdue offers and entries'
);
select is(
  (select status from public.waitlist_entries where id = tests.id('entry_2')),
  'expired', 'an entry past its last date expires'
);

select * from finish();
rollback;
