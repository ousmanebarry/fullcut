begin;
select plan(21);

select tests.seed_two_shops();

-- Books a 30-minute (+10 buffer) slot via the staff write path as the current role.
create function tests.staff_book(
  p_staff text,
  p_starts_at timestamptz,
  p_source text default 'walk_in',
  p_client_id uuid default null,
  p_name text default 'Walk In',
  p_phone text default null,
  p_shop text default 'shop_a',
  p_service text default 'service_a'
)
returns table (booking_id uuid, client_id uuid)
language sql
as $$
  select * from public.create_staff_booking(
    tests.id(p_shop),
    tests.id(p_staff),
    tests.id(p_service),
    p_starts_at,
    p_starts_at + interval '30 minutes',
    p_starts_at + interval '40 minutes',
    3000,
    p_source,
    p_name,
    'Called ahead',
    p_client_id,
    p_phone
  );
$$;
grant execute on function tests.staff_book(text, timestamptz, text, uuid, text, text, text, text)
  to anon, authenticated, service_role;

-- Schema ---------------------------------------------------------------------

select throws_ok(
  $$update public.bookings set cancel_reason = repeat('x', 201) where id = tests.id('booking_a')$$,
  '23514', null, 'cancel reason is at most 200 characters'
);
select has_index('public', 'bookings', 'bookings_unmarked_idx', 'unmarked-outcomes index exists');
select ok(
  not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
  or exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings'
  ),
  'bookings are published to realtime when realtime is installed'
);

-- Status tracking ------------------------------------------------------------

update public.bookings set status = 'completed' where id = tests.id('booking_a');
select results_eq(
  $$select outcome_marked_at is not null, cancelled_at is null from public.bookings where id = tests.id('booking_a')$$,
  $$values (true, true)$$,
  'marking an outcome records when'
);
update public.bookings set status = 'confirmed' where id = tests.id('booking_a');
select is(
  (select outcome_marked_at from public.bookings where id = tests.id('booking_a')),
  null,
  'undoing an outcome clears its timestamp'
);
update public.bookings set price_cents = 2500 where id = tests.id('booking_a');
select is(
  (select outcome_marked_at from public.bookings where id = tests.id('booking_a')),
  null,
  'other updates leave the timestamps alone'
);
update public.bookings set status = 'cancelled', cancel_reason = 'Sick' where id = tests.id('booking_a');
select results_eq(
  $$select cancelled_at is not null, cancel_reason from public.bookings where id = tests.id('booking_a')$$,
  $$values (true, 'Sick'::text)$$,
  'cancelling records when and why'
);

-- Access ---------------------------------------------------------------------

set local role anon;
select throws_ok(
  $$select * from tests.staff_book('staff_a', '2030-01-08 18:00Z')$$,
  '42501', null, 'anon cannot call create_staff_booking'
);
reset role;

select tests.authenticate_as(tests.id('user_c'));
select throws_ok(
  $$select * from tests.staff_book('staff_a', '2030-01-08 18:00Z')$$,
  '42501', 'not_shop_member', 'an outsider cannot create staff bookings'
);
select tests.clear_authentication();

select tests.authenticate_as(tests.id('user_a'));
select throws_ok(
  $$select * from tests.staff_book('staff_b', '2030-01-08 18:00Z', p_shop => 'shop_b', p_service => 'service_b')$$,
  '42501', 'not_shop_member', 'an owner cannot create bookings in another shop'
);
select throws_ok(
  $$select * from tests.staff_book('staff_a', '2030-01-08 18:00Z', p_client_id => tests.id('client_b'))$$,
  '23503', null, 'a client from another shop is rejected'
);
select throws_ok(
  $$select * from tests.staff_book('staff_a', '2030-01-08 18:00Z', p_source => 'direct')$$,
  '22023', 'invalid_source', 'only phone and walk-in sources are accepted'
);
select tests.clear_authentication();

-- Booking write --------------------------------------------------------------

select tests.authenticate_as(tests.id('user_a_staff'));

select lives_ok(
  $$select * from tests.staff_book('staff_a', '2030-01-08 18:00Z')$$,
  'a staff member can record a walk-in without a phone'
);
select results_eq(
  $$select c.name, c.phone_e164, c.first_source, b.status, b.source, b.client_notes
    from public.bookings b join public.clients c on c.id = b.client_id
    where b.staff_id = tests.id('staff_a') and b.starts_at = '2030-01-08 18:00Z'$$,
  $$values ('Walk In'::text, null::text, 'walk_in'::text, 'confirmed'::text, 'walk_in'::text, 'Called ahead'::text)$$,
  'the walk-in creates a name-only client and a confirmed booking'
);

select lives_ok(
  $$select * from tests.staff_book('staff_a', '2030-01-08 19:00Z', 'phone', p_name => 'Other', p_phone => '+15559990001')$$,
  'a phone booking for a known number succeeds'
);
select results_eq(
  $$select count(*)::int, min(name) from public.clients where shop_id = tests.id('shop_a') and phone_e164 = '+15559990001'$$,
  $$values (1, 'Client A'::text)$$,
  'the existing client is reused and keeps their name'
);

select lives_ok(
  $$select * from tests.staff_book('staff_a', '2030-01-08 20:00Z', 'phone', p_client_id => tests.id('client_a'))$$,
  'a booking can be made for a picked client'
);

select throws_ok(
  $$select * from tests.staff_book('staff_a', '2030-01-08 18:10Z')$$,
  '23P01', null, 'an overlapping staff booking is rejected'
);

select tests.clear_authentication();
select tests.insert_booking(tests.id('staff_a2'), '2030-01-08 15:00Z', 30, 10, 'pending', tests.id('hold'));
update public.bookings set pending_expires_at = now() - interval '1 minute' where id = tests.id('hold');

select tests.authenticate_as(tests.id('user_a_staff'));
select lives_ok(
  $$select * from tests.staff_book('staff_a2', '2030-01-08 15:00Z')$$,
  'an expired hold does not block a staff booking'
);
select tests.clear_authentication();
select results_eq(
  $$select status, cancelled_at is not null from public.bookings where id = tests.id('hold')$$,
  $$values ('cancelled'::text, true)$$,
  'the expired hold is cancelled'
);

select tests.authenticate_as(tests.id('user_a_staff'));
select is(
  (select count(*)::int from public.bookings where shop_id = tests.id('shop_b')),
  0,
  'staff never see another shop''s bookings'
);
select tests.clear_authentication();

select * from finish();
rollback;
