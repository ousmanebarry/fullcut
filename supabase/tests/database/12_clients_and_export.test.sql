begin;
select plan(50);

select tests.seed_two_shops();

-- Fixtures (as postgres) -----------------------------------------------------------

insert into public.clients (id, shop_id, name) values
  (tests.id('client_a_spare'), tests.id('shop_a'), 'Spare');

insert into public.clients (
  id, shop_id, name, email, marketing_opt_in, marketing_opt_in_at, marketing_opt_in_method,
  sms_opted_out, first_source, created_at
) values (
  tests.id('client_a_dup'), tests.id('shop_a'), 'Dup', 'dup@example.com', true, '2025-06-01 12:00Z',
  'booking_form_checkbox', true, 'instagram', '2024-01-01 12:00Z'
);

insert into public.clients (id, shop_id, name, phone_e164, email, marketing_opt_in, marketing_opt_in_at)
values (tests.id('client_a_gone'), tests.id('shop_a'), 'Gone Soon', '+15559990003', 'gone@example.com', true, '2025-01-01 12:00Z');

-- client_a: booking_a (confirmed, 2030) plus two completed, one no-show and one cancelled visit.
insert into public.bookings (id, shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents, client_notes, cancel_reason)
select tests.id(b.name), tests.id('shop_a'), tests.id('staff_a2'), tests.id(b.client), tests.id('service_a'),
  b.starts_at, b.starts_at + interval '30 minutes', b.starts_at + interval '40 minutes', b.status, b.price, b.notes, b.reason
from (values
  ('past_1', 'client_a', '2025-01-07 15:00Z'::timestamptz, 'completed', 3000, null, null),
  ('past_2', 'client_a', '2025-02-04 15:00Z'::timestamptz, 'completed', 4000, null, null),
  ('past_3', 'client_a', '2025-03-04 15:00Z'::timestamptz, 'no_show',   3000, null, null),
  ('past_4', 'client_a', '2025-03-11 15:00Z'::timestamptz, 'cancelled', 3000, null, 'Sick'),
  ('dup_1',  'client_a_dup', '2025-04-01 15:00Z'::timestamptz, 'completed', 3000, null, null),
  ('dup_2',  'client_a_dup', '2025-04-08 15:00Z'::timestamptz, 'cancelled', 3000, null, null),
  ('gone_1', 'client_a_gone', '2025-05-06 15:00Z'::timestamptz, 'completed', 3000, 'Call me on my cell', null),
  ('gone_2', 'client_a_gone', '2025-05-13 15:00Z'::timestamptz, 'cancelled', 3000, null, 'Moving away')
) as b (name, client, starts_at, status, price, notes, reason);

insert into public.booking_links (shop_id, booking_id, token_hash, expires_at) values
  (tests.id('shop_a'), tests.id('gone_1'), repeat('a', 64), '2030-01-01 00:00Z');

insert into public.client_notes (shop_id, client_id, author_user_id, body) values
  (tests.id('shop_a'), tests.id('client_a'), tests.id('user_a'), 'Owner note'),
  (tests.id('shop_a'), tests.id('client_a_dup'), tests.id('user_a'), 'Dup note'),
  (tests.id('shop_a'), tests.id('client_a_gone'), tests.id('user_a'), 'Gone note'),
  (tests.id('shop_b'), tests.id('client_b'), tests.id('user_b'), 'Shop B note');

insert into public.audit_events (shop_id, action) values
  (tests.id('shop_a'), 'export'),
  (tests.id('shop_b'), 'export');

-- Schema -------------------------------------------------------------------------------

select throws_ok(
  $$update public.clients set anonymised_at = now() where id = tests.id('client_a')$$,
  '23514', null, 'an anonymised client keeps no contact details'
);
select throws_ok(
  $$insert into public.client_notes (shop_id, client_id, body) values (tests.id('shop_a'), tests.id('client_a'), '   ')$$,
  '23514', null, 'a note cannot be blank'
);

-- Notes isolation (9) --------------------------------------------------------------------

select tests.authenticate_as(tests.id('user_a'));

select * from tests.rls_isolation(
  'client_notes', 'shop_id, client_id, body',
  $$tests.id('shop_a'), tests.id('client_a'), 'New A'$$,
  $$tests.id('shop_b'), tests.id('client_b'), 'New B'$$
);

-- Audit log ------------------------------------------------------------------------------

select is(
  (select count(*)::int from public.audit_events where shop_id <> tests.id('shop_a')),
  0, 'audit_events: owner sees no other shop''s events'
);
select ok(
  (select count(*) from public.audit_events where shop_id = tests.id('shop_a')) > 0,
  'audit_events: owner sees own shop''s events'
);
select throws_ok(
  $$insert into public.audit_events (shop_id, action) values (tests.id('shop_b'), 'export')$$,
  '42501', null, 'audit_events: cannot log into another shop'
);
select lives_ok(
  $$insert into public.audit_events (shop_id, action, actor_user_id, actor_email)
    values (tests.id('shop_a'), 'export', tests.id('user_b'), 'spoof@example.com')$$,
  'audit_events: owner can log an export'
);
select is(
  (select count(*)::int from public.audit_events where actor_user_id = tests.id('user_b') or actor_email = 'spoof@example.com'),
  0, 'audit_events: the actor always comes from the session'
);
select throws_ok(
  $$update public.audit_events set action = 'export'$$,
  '42501', null, 'audit_events: rows cannot be edited'
);
select throws_ok(
  $$delete from public.audit_events$$,
  '42501', null, 'audit_events: rows cannot be deleted'
);

select tests.authenticate_as(tests.id('user_a_staff'));
select is((select count(*)::int from public.audit_events), 0, 'audit_events: staff cannot read the log');
select throws_ok(
  $$insert into public.audit_events (shop_id, action) values (tests.id('shop_a'), 'export')$$,
  '42501', null, 'audit_events: staff cannot write the log'
);

-- Client and note permissions for staff --------------------------------------------------

select is(
  tests.affected($$delete from public.clients where id = tests.id('client_a_spare')$$),
  0, 'staff cannot delete clients'
);
select is(
  tests.affected($$update public.clients set name = 'Client A' where id = tests.id('client_a')$$),
  1, 'staff can edit client details'
);
select lives_ok(
  $$insert into public.client_notes (shop_id, client_id, body) values (tests.id('shop_a'), tests.id('client_a'), 'Staff note')$$,
  'staff can add notes'
);
select is(
  tests.affected($$delete from public.client_notes where body = 'Owner note'$$),
  0, 'staff cannot delete someone else''s note'
);
select is(
  tests.affected($$delete from public.client_notes where body = 'Staff note'$$),
  1, 'staff can delete their own note'
);
select throws_ok(
  $$select public.merge_clients(tests.id('client_a'), tests.id('client_a_dup'))$$,
  '42501', 'merge_forbidden', 'staff cannot merge clients'
);
select throws_ok(
  $$select public.anonymise_client(tests.id('client_a_gone'))$$,
  '42501', 'anonymise_forbidden', 'staff cannot delete client data'
);

select tests.authenticate_as(tests.id('user_a'));
select is(
  tests.affected($$delete from public.clients where id = tests.id('client_a_spare')$$),
  1, 'owner can delete a client without bookings'
);

-- Visit stats ------------------------------------------------------------------------------

select results_eq(
  $$select visits, no_shows, cancellations, total_bookings, last_visit_at, next_booking_at, avg_spend_cents
    from public.client_stats where id = tests.id('client_a')$$,
  $$values (2, 1, 1, 5, '2025-02-04 15:00Z'::timestamptz, '2030-01-08 15:00Z'::timestamptz, 3500)$$,
  'client_stats counts completed, no-show and cancelled bookings separately'
);
select is(
  (select count(*)::int from public.client_stats where shop_id <> tests.id('shop_a')),
  0, 'client_stats: owner sees no other shop''s clients'
);
select tests.authenticate_as(tests.id('user_c'));
select is((select count(*)::int from public.client_stats), 0, 'client_stats: outsider sees nothing');

-- Merge ----------------------------------------------------------------------------------

select tests.authenticate_as(tests.id('user_b'));
select throws_ok(
  $$select public.merge_clients(tests.id('client_a'), tests.id('client_a_dup'))$$,
  'P0002', 'client_not_found', 'another shop''s owner cannot merge'
);

select tests.authenticate_as(tests.id('user_a'));
select throws_ok(
  $$select public.merge_clients(tests.id('client_a'), tests.id('client_b'))$$,
  'P0002', 'client_not_found', 'cannot merge in a client from another shop'
);
select throws_ok(
  $$select public.merge_clients(tests.id('client_a'), tests.id('client_a'))$$,
  '22023', 'merge_same_client', 'cannot merge a client into itself'
);
select lives_ok(
  $$select public.merge_clients(
    tests.id('client_a'), tests.id('client_a_dup'),
    '{"name": "Client A Merged", "phone_e164": "+15559990001"}'
  )$$,
  'owner can merge two clients'
);
select is(
  (select count(*)::int from public.bookings where client_id = tests.id('client_a_dup')),
  0, 'merge leaves no bookings on the merged client'
);
select is(
  (select count(*)::int from public.bookings where client_id = tests.id('client_a')),
  7, 'merge moves every booking to the kept client'
);
select ok(
  not exists (select 1 from public.clients where id = tests.id('client_a_dup')),
  'the merged client is removed'
);
select results_eq(
  $$select name, phone_e164, email, marketing_opt_in, marketing_opt_in_method, sms_opted_out, first_source, created_at
    from public.clients where id = tests.id('client_a')$$,
  $$values ('Client A Merged'::text, '+15559990001'::text, 'dup@example.com'::text, true, 'booking_form_checkbox'::text,
            true, 'instagram'::text, '2024-01-01 12:00Z'::timestamptz)$$,
  'merge keeps the richer details, the latest consent and any opt-out'
);
select results_eq(
  $$select client_id from public.client_notes where body = 'Dup note'$$,
  $$values (tests.id('client_a'))$$,
  'merge moves notes'
);
select results_eq(
  $$select actor_user_id, subject_id, details from public.audit_events where action = 'client_merge'$$,
  $$values (tests.id('user_a'), tests.id('client_a'),
            jsonb_build_object('merged_client_id', tests.id('client_a_dup'), 'bookings_moved', 2, 'notes_moved', 1))$$,
  'merge is logged without personal data'
);

-- Anonymise ------------------------------------------------------------------------------

select throws_ok(
  $$select public.anonymise_client(tests.id('client_a'))$$,
  'P0001', 'client_has_upcoming_bookings', 'a client with upcoming bookings cannot be deleted'
);
select lives_ok(
  $$select public.anonymise_client(tests.id('client_a_gone'))$$,
  'owner can delete a client''s data'
);
select results_eq(
  $$select name, phone_e164, email, marketing_opt_in, anonymised_at is not null
    from public.clients where id = tests.id('client_a_gone')$$,
  $$values ('Deleted client'::text, null::text, null::text, false, true)$$,
  'contact details are removed'
);
select results_eq(
  $$select count(*)::int, count(*) filter (where client_notes is not null or cancel_reason is not null)::int
    from public.bookings where client_id = tests.id('client_a_gone')$$,
  $$values (2, 0)$$,
  'bookings are kept without free-text notes'
);
select is(
  (select count(*)::int from public.client_notes where client_id = tests.id('client_a_gone')),
  0, 'private notes are deleted'
);
select lives_ok(
  $$select public.anonymise_client(tests.id('client_a_gone'))$$,
  'deleting twice is harmless'
);
select results_eq(
  $$select details from public.audit_events where action = 'client_anonymise' and subject_id = tests.id('client_a_gone')$$,
  $$values (jsonb_build_object('bookings_kept', 2, 'notes_deleted', 1))$$,
  'deletion is logged once'
);

select tests.clear_authentication();
select is(
  (select count(*)::int from public.booking_links where booking_id = tests.id('gone_1') and revoked_at is null),
  0, 'manage links of a deleted client are revoked'
);

set local role anon;
select throws_ok(
  $$select public.merge_clients(tests.id('client_a'), tests.id('client_a_dup'))$$,
  '42501', null, 'anon cannot call merge_clients'
);
reset role;

select * from finish();
rollback;
