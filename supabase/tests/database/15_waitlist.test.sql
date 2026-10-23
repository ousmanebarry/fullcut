begin;
select plan(42);

select tests.seed_two_shops();

update public.shops set waitlist_enabled = true where id = tests.id('shop_a');

-- Settings -------------------------------------------------------------------------------

select results_eq(
  $$select waitlist_enabled, waitlist_wave_size, waitlist_offer_minutes, waitlist_min_notice_minutes
    from public.shops where id = tests.id('shop_b')$$,
  $$values (false, 3, 15, 60)$$,
  'the waitlist is off by default with wave 3, 15 minute offers and 60 minutes notice'
);
select throws_ok(
  $$update public.shops set waitlist_wave_size = 0 where id = tests.id('shop_a')$$,
  '23514', null, 'wave size is at least 1'
);
select throws_ok(
  $$update public.shops set waitlist_offer_minutes = 4 where id = tests.id('shop_a')$$,
  '23514', null, 'offers last at least 5 minutes'
);
select throws_ok(
  $$update public.shops set waitlist_min_notice_minutes = 14 where id = tests.id('shop_a')$$,
  '23514', null, 'minimum notice is at least 15 minutes'
);

-- Joining --------------------------------------------------------------------------------

create temporary table joined (id uuid) on commit drop;

select lives_ok(
  $$insert into joined select public.join_waitlist(
      tests.id('shop_a'), tests.id('service_a'), '2030-01-01', '2030-01-10', '[]',
      'New Person', '+14165550101')$$,
  'a client can join the waitlist'
);

select results_eq(
  $$select status, request_method, staff_id is null, earliest_date, latest_date
    from public.waitlist_entries where id = (select id from joined)$$,
  $$values ('active', 'booking_page', true, '2030-01-01'::date, '2030-01-10'::date)$$,
  'the entry is active, from the booking page, with any staff'
);

select results_eq(
  $$select name, first_source, sms_opted_out from public.clients
    where shop_id = tests.id('shop_a') and phone_e164 = '+14165550101'$$,
  $$values ('New Person', 'direct', false)$$,
  'joining creates the client'
);

select results_eq(
  $$select type, dedupe_key, status, booking_id is null from public.scheduled_messages
    where waitlist_entry_id = (select id from joined)$$,
  $$values ('waitlist_joined', 'waitlist_joined', 'queued', true)$$,
  'joining queues the confirmation text'
);

select throws_ok(
  $$select public.join_waitlist(
      tests.id('shop_b'), tests.id('service_b'), '2030-01-01', '2030-01-10', '[]',
      'Someone', '+14165550105')$$,
  'FC003', null, 'joining is refused while the shop has the waitlist off'
);

select throws_ok(
  $$select public.join_waitlist(
      tests.id('shop_a'), tests.id('service_a'), '2030-01-01', '2030-01-10',
      '[{"weekday": 9, "start": "09:00", "end": "10:00"}]', 'Someone', '+14165550105')$$,
  '22023', 'invalid_time_windows', 'a window needs a weekday from 0 to 6'
);

select throws_ok(
  $$select public.join_waitlist(
      tests.id('shop_a'), tests.id('service_a'), '2030-01-01', '2030-01-10',
      '[{"weekday": 1, "start": "12:00", "end": "09:00"}]', 'Someone', '+14165550105')$$,
  '22023', 'invalid_time_windows', 'a window must end after it starts'
);

select lives_ok(
  $$select public.join_waitlist(
      tests.id('shop_a'), tests.id('service_a'), '2030-01-02', '2030-01-09',
      '[{"weekday": 2, "start": "09:00", "end": "12:00"}]', 'New Person', '+14165550101',
      p_staff_id => tests.id('staff_a'))$$,
  'a second entry can name a staff member and time windows'
);
select lives_ok(
  $$select public.join_waitlist(
      tests.id('shop_a'), tests.id('service_a'), '2030-01-03', '2030-01-08', '[]', 'New Person', '+14165550101')$$,
  'a third entry is allowed'
);
select throws_ok(
  $$select public.join_waitlist(
      tests.id('shop_a'), tests.id('service_a'), '2030-01-04', '2030-01-07', '[]', 'New Person', '+14165550101')$$,
  'FC002', null, 'a fourth active entry for the same phone is refused'
);

-- STOP -----------------------------------------------------------------------------------

update public.clients set sms_opted_out = true
where shop_id = tests.id('shop_a') and phone_e164 = '+14165550101';

select is(
  (select count(*)::int from public.waitlist_entries e
   join public.clients c on c.shop_id = e.shop_id and c.id = e.client_id
   where c.phone_e164 = '+14165550101' and e.shop_id = tests.id('shop_a') and e.status = 'active'),
  0,
  'STOP cancels the client''s active entries'
);

select throws_ok(
  $$select public.join_waitlist(
      tests.id('shop_a'), tests.id('service_a'), '2030-01-01', '2030-01-10', '[]', 'New Person', '+14165550101')$$,
  'FC004', null, 'a client who replied STOP cannot join'
);

update public.clients set sms_opted_out = false
where shop_id = tests.id('shop_a') and phone_e164 = '+14165550101';

select lives_ok(
  $$select public.join_waitlist(
      tests.id('shop_a'), tests.id('service_a'), '2030-01-01', '2030-01-10', '[]', 'New Person', '+14165550101')$$,
  'cancelled entries no longer count towards the cap'
);

-- Anonymising and merging ------------------------------------------------------------------

create temporary table person_two (client_id uuid, entry_id uuid) on commit drop;
grant select on person_two to authenticated;

insert into person_two (entry_id)
select public.join_waitlist(
  tests.id('shop_a'), tests.id('service_a'), '2030-01-01', '2030-01-10', '[]', 'Person Two', '+14165550102');
update person_two set client_id = (
  select id from public.clients where shop_id = tests.id('shop_a') and phone_e164 = '+14165550102');
insert into public.waitlist_links (shop_id, waitlist_entry_id, token_hash, expires_at)
select tests.id('shop_a'), entry_id, repeat('a', 64), '2030-02-01' from person_two;

select tests.authenticate_as(tests.id('user_a'));
select lives_ok(
  $$select public.anonymise_client((select client_id from person_two))$$,
  'an owner can anonymise a client on the waitlist'
);
select tests.clear_authentication();

select is(
  (select status from public.waitlist_entries where id = (select entry_id from person_two)),
  'cancelled',
  'anonymising cancels the client''s entries'
);
select ok(
  (select revoked_at is not null from public.waitlist_links where token_hash = repeat('a', 64)),
  'anonymising revokes the waitlist links'
);

create temporary table merge_pair (keep_id uuid, merge_id uuid) on commit drop;
grant select on merge_pair to authenticated;

select public.join_waitlist(
  tests.id('shop_a'), tests.id('service_a'), '2030-01-01', '2030-01-10', '[]', 'Keep Me', '+14165550103');
select public.join_waitlist(
  tests.id('shop_a'), tests.id('service_a'), '2030-01-01', '2030-01-10', '[]', 'Merge Me', '+14165550104');
insert into merge_pair
select
  (select id from public.clients where shop_id = tests.id('shop_a') and phone_e164 = '+14165550103'),
  (select id from public.clients where shop_id = tests.id('shop_a') and phone_e164 = '+14165550104');

select tests.authenticate_as(tests.id('user_a'));
select lives_ok(
  $$select public.merge_clients((select keep_id from merge_pair), (select merge_id from merge_pair))$$,
  'an owner can merge clients who are both on the waitlist'
);
select tests.clear_authentication();

select is(
  (select count(*)::int from public.waitlist_entries
   where shop_id = tests.id('shop_a') and client_id = (select keep_id from merge_pair)),
  2,
  'merging keeps the merged client''s waitlist entries'
);

-- Fixtures for access control and offers ---------------------------------------------------

insert into public.waitlist_entries (id, shop_id, client_id, service_id, earliest_date, latest_date, request_method) values
  (tests.id('entry_a'), tests.id('shop_a'), tests.id('client_a'), tests.id('service_a'), '2030-01-01', '2030-01-10', 'staff'),
  (tests.id('entry_b'), tests.id('shop_b'), tests.id('client_b'), tests.id('service_b'), '2030-01-01', '2030-01-10', 'staff');

insert into public.freed_slots (id, shop_id, staff_id, starts_at, ends_at) values
  (tests.id('freed_a'), tests.id('shop_a'), tests.id('staff_a'), '2030-01-08 16:00Z', '2030-01-08 16:40Z'),
  (tests.id('freed_b'), tests.id('shop_b'), tests.id('staff_b'), '2030-01-08 16:00Z', '2030-01-08 16:40Z');

insert into public.slot_offers
  (id, shop_id, waitlist_entry_id, freed_slot_id, staff_id, service_id, starts_at, ends_at, blocked_until, expires_at) values
  (tests.id('offer_a'), tests.id('shop_a'), tests.id('entry_a'), tests.id('freed_a'), tests.id('staff_a'), tests.id('service_a'),
    '2030-01-08 16:00Z', '2030-01-08 16:30Z', '2030-01-08 16:40Z', '2030-01-08 15:45Z'),
  (tests.id('offer_b'), tests.id('shop_b'), tests.id('entry_b'), tests.id('freed_b'), tests.id('staff_b'), tests.id('service_b'),
    '2030-01-08 16:00Z', '2030-01-08 16:30Z', '2030-01-08 16:40Z', '2030-01-08 15:45Z');

insert into public.scheduled_messages (shop_id, slot_offer_id, client_id, type, dedupe_key, send_at)
values (tests.id('shop_a'), tests.id('offer_a'), tests.id('client_a'), 'waitlist_offer', 'waitlist_offer', now());

-- Constraints ----------------------------------------------------------------------------------

select throws_ok(
  $$insert into public.waitlist_entries (shop_id, client_id, service_id, earliest_date, latest_date, request_method)
    values (tests.id('shop_a'), tests.id('client_a'), tests.id('service_a'), '2030-01-10', '2030-01-01', 'staff')$$,
  '23514',
  'new row for relation "waitlist_entries" violates check constraint "waitlist_entries_dates_order"',
  'the first date cannot be after the last date'
);
select throws_ok(
  $$insert into public.waitlist_entries (shop_id, client_id, service_id, earliest_date, latest_date, request_method)
    values (tests.id('shop_a'), tests.id('client_b'), tests.id('service_a'), '2030-01-01', '2030-01-10', 'staff')$$,
  '23503', null, 'an entry cannot point at another shop''s client'
);
select throws_ok(
  $$insert into public.slot_offers
      (shop_id, waitlist_entry_id, staff_id, service_id, starts_at, ends_at, blocked_until, expires_at)
    values (tests.id('shop_a'), tests.id('entry_a'), tests.id('staff_a'), tests.id('service_a'),
      '2030-01-08 16:00Z', '2030-01-08 16:30Z', '2030-01-08 16:40Z', '2030-01-08 15:45Z')$$,
  '23505', null, 'a client is never offered the same slot twice'
);
select throws_ok(
  $$insert into public.scheduled_messages (shop_id, booking_id, client_id, type, dedupe_key, send_at)
    values (tests.id('shop_a'), tests.id('booking_a'), tests.id('client_a'), 'waitlist_offer', 'x', now())$$,
  '23514',
  'new row for relation "scheduled_messages" violates check constraint "scheduled_messages_subject_valid"',
  'an offer text must point at an offer, not a booking'
);
select throws_ok(
  $$update public.bookings set slot_offer_id = tests.id('offer_a') where id = tests.id('booking_b')$$,
  '23503', null, 'a booking cannot point at another shop''s offer'
);

-- Access ---------------------------------------------------------------------------------------

select tests.authenticate_as(tests.id('user_a'));

select results_eq(
  $$select
      (select count(*) from public.waitlist_entries where shop_id <> tests.id('shop_a')),
      (select count(*) from public.slot_offers where shop_id <> tests.id('shop_a')),
      (select count(*) from public.freed_slots where shop_id <> tests.id('shop_a'))$$,
  $$values (0::bigint, 0::bigint, 0::bigint)$$,
  'a member sees no entries, offers or freed slots of another shop'
);
select ok(
  (select count(*) from public.waitlist_entries where shop_id = tests.id('shop_a')) > 0
    and (select count(*) from public.slot_offers where shop_id = tests.id('shop_a')) > 0
    and (select count(*) from public.freed_slots where shop_id = tests.id('shop_a')) > 0,
  'a member sees their own shop''s entries, offers and freed slots'
);
select throws_ok(
  $$insert into public.waitlist_entries (shop_id, client_id, service_id, earliest_date, latest_date, request_method)
    values (tests.id('shop_a'), tests.id('client_a'), tests.id('service_a'), '2030-01-01', '2030-01-10', 'staff')$$,
  '42501', null, 'members cannot insert entries directly'
);
select throws_ok(
  $$delete from public.slot_offers where shop_id = tests.id('shop_a')$$,
  '42501', null, 'members cannot delete offers'
);
select throws_ok(
  $$select 1 from public.waitlist_links$$,
  '42501', null, 'waitlist links are not readable by members'
);
select is(
  tests.affected($$update public.waitlist_entries set status = 'cancelled' where shop_id = tests.id('shop_b')$$),
  0,
  'members cannot cancel another shop''s entries'
);
select throws_ok(
  $$update public.waitlist_entries set status = 'booked' where id = tests.id('entry_a')$$,
  '42501', null, 'members can only cancel an entry, not mark it booked'
);
select is(
  tests.affected($$update public.waitlist_entries set status = 'cancelled' where id = tests.id('entry_a')$$),
  1,
  'a member can cancel an active entry'
);

select tests.clear_authentication();

select is(
  (select status from public.slot_offers where id = tests.id('offer_a')),
  'withdrawn',
  'cancelling an entry withdraws its open offers'
);
select is(
  (select status from public.scheduled_messages where slot_offer_id = tests.id('offer_a')),
  'cancelled',
  'and cancels the offer text that had not gone out'
);

select tests.authenticate_as(tests.id('user_c'));
select is(
  (select count(*)::int from public.waitlist_entries),
  0,
  'an outsider sees no entries'
);
select tests.clear_authentication();

set local role anon;
select throws_ok(
  $$select 1 from public.waitlist_entries$$,
  '42501', null, 'anonymous visitors cannot read entries'
);
reset role;

-- Demo shop -------------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', tests.id('user_demo_waitlist'), 'authenticated', 'authenticated', 'demo-waitlist@test.example.com');

create temporary table demo (shop_id uuid) on commit drop;
insert into demo select private.configure_demo_shop(tests.id('user_demo_waitlist'), 'test-demo-waitlist');

select ok(
  (select waitlist_enabled from public.shops where id = (select shop_id from demo)),
  'the demo shop has the waitlist on'
);
select is(
  (select count(*)::int from public.waitlist_entries where shop_id = (select shop_id from demo) and status = 'active'),
  5,
  'the demo shop starts with sample waitlist entries'
);

select private.reset_demo_shop();
select is(
  (select count(*)::int from public.waitlist_entries where shop_id = (select shop_id from demo)),
  7,
  'the nightly reset rebuilds the sample entries without duplicating them'
);

select * from finish();
rollback;
