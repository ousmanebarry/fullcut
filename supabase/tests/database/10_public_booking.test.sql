begin;
select plan(29);

select tests.seed_two_shops();

grant usage on schema tests to service_role;

-- Books a 30-minute (+10 buffer) slot via the public write path as the current role.
create function tests.book(
  p_staff text,
  p_service text,
  p_starts_at timestamptz,
  p_phone text,
  p_name text default 'Pat Public',
  p_email text default null,
  p_opt_in boolean default false
)
returns table (booking_id uuid, client_id uuid)
language sql
as $$
  select * from public.create_public_booking(
    tests.id('shop_a'),
    tests.id(p_staff),
    tests.id(p_service),
    p_starts_at,
    p_starts_at + interval '30 minutes',
    p_starts_at + interval '40 minutes',
    3000,
    'instagram',
    p_name,
    p_phone,
    p_email,
    'Please use the side door',
    p_opt_in,
    encode(sha256(convert_to(gen_random_uuid()::text, 'utf8')), 'hex'),
    '2030-12-31 00:00Z'
  );
$$;
grant execute on function tests.book(text, text, timestamptz, text, text, text, boolean) to anon, authenticated, service_role;

-- Constraints ----------------------------------------------------------------

select throws_ok(
  $$update public.shops set cancel_cutoff_hours = 169 where id = tests.id('shop_a')$$,
  '23514', null, 'cancel cutoff is at most 7 days'
);
select throws_ok(
  $$update public.shops set max_active_bookings_per_phone = 0 where id = tests.id('shop_a')$$,
  '23514', null, 'per-phone cap is at least 1'
);
select throws_ok(
  $$update public.bookings set client_notes = repeat('x', 501) where id = tests.id('booking_a')$$,
  '23514', null, 'client notes are at most 500 characters'
);
select throws_ok(
  $$insert into public.booking_links (shop_id, booking_id, token_hash, expires_at)
    values (tests.id('shop_a'), tests.id('booking_b'), repeat('a', 64), '2030-02-01Z')$$,
  '23503', null, 'a link cannot point at another shop''s booking'
);

-- Client roles ---------------------------------------------------------------

set local role anon;
select throws_ok('select * from public.booking_links', '42501', null, 'anon cannot read booking_links');
select throws_ok('select * from public.public_rate_limits', '42501', null, 'anon cannot read public_rate_limits');
select throws_ok($$select * from public.hit_rate_limit('k', 60, 5)$$, '42501', null, 'anon cannot call hit_rate_limit');
select throws_ok(
  $$select * from tests.book('staff_a', 'service_a', '2030-01-08 16:00Z', '+15550001111')$$,
  '42501', null, 'anon cannot call create_public_booking'
);
reset role;

select tests.authenticate_as(tests.id('user_a'));
select throws_ok('select * from public.booking_links', '42501', null, 'authenticated cannot read booking_links');
select throws_ok(
  $$select * from public.hit_rate_limit('k', 60, 5)$$, '42501', null, 'authenticated cannot call hit_rate_limit'
);
select throws_ok(
  $$select * from tests.book('staff_a', 'service_a', '2030-01-08 16:00Z', '+15550001111')$$,
  '42501', null, 'authenticated cannot call create_public_booking'
);
select tests.clear_authentication();

-- Booking write --------------------------------------------------------------

set local role service_role;

select lives_ok(
  $$select * from tests.book('staff_a', 'service_a', '2030-01-08 16:00Z', '+15550001111', p_opt_in => true)$$,
  'service role can create a public booking'
);
select results_eq(
  $$select name, first_source, marketing_opt_in, marketing_opt_in_method, marketing_opt_in_at is not null
    from public.clients where phone_e164 = '+15550001111'$$,
  $$values ('Pat Public'::text, 'instagram'::text, true, 'booking_form_checkbox'::text, true)$$,
  'a new client is created with source and recorded consent'
);
select results_eq(
  $$select b.status, b.source, b.client_notes, b.price_cents
    from public.bookings b join public.clients c on c.id = b.client_id
    where c.phone_e164 = '+15550001111'$$,
  $$values ('confirmed'::text, 'instagram'::text, 'Please use the side door'::text, 3000)$$,
  'the booking is confirmed with source and notes'
);
select is(
  (select count(*)::int from public.booking_links l
    join public.bookings b on b.id = l.booking_id
    join public.clients c on c.id = b.client_id
    where c.phone_e164 = '+15550001111'),
  1,
  'the booking gets a manage link'
);

select lives_ok(
  $$select * from tests.book('staff_a', 'service_a', '2030-01-08 17:00Z', '+15550001111', 'Other Name', 'pat@example.com')$$,
  'the same phone can book again'
);
select results_eq(
  $$select count(*)::int, min(name), min(email), bool_and(marketing_opt_in)
    from public.clients where shop_id = tests.id('shop_a') and phone_e164 = '+15550001111'$$,
  $$values (1, 'Pat Public'::text, 'pat@example.com'::text, true)$$,
  'the client is reused: name kept, empty email filled, consent not withdrawn'
);
select lives_ok(
  $$select * from tests.book('staff_a', 'service_a', '2030-01-08 18:00Z', '+15550001111', p_email => 'new@example.com')$$,
  'a third booking for the same phone is allowed'
);
select is(
  (select email from public.clients where shop_id = tests.id('shop_a') and phone_e164 = '+15550001111'),
  'pat@example.com',
  'an existing email is not overwritten'
);
select throws_ok(
  $$select * from tests.book('staff_a', 'service_a', '2030-01-08 19:00Z', '+15550001111')$$,
  'FC001', 'max_active_bookings', 'the per-phone cap of active future bookings is enforced'
);

select throws_ok(
  $$select * from tests.book('staff_a', 'service_a', '2030-01-08 15:10Z', '+15550002222')$$,
  '23P01', null, 'an overlapping booking is rejected by the exclusion constraint'
);
select is(
  (select count(*)::int from public.clients where phone_e164 = '+15550002222'),
  0,
  'a failed booking leaves no client behind'
);

select tests.insert_booking(tests.id('staff_a2'), '2030-01-08 15:00Z', 30, 10, 'pending', tests.id('hold'));
update public.bookings set pending_expires_at = now() - interval '1 minute' where id = tests.id('hold');
select lives_ok(
  $$select * from tests.book('staff_a2', 'service_a', '2030-01-08 15:00Z', '+15550003333')$$,
  'an expired hold does not block a new booking'
);
select is(
  (select status from public.bookings where id = tests.id('hold')),
  'cancelled',
  'the expired hold is cancelled'
);

select throws_ok(
  $$select * from tests.book('staff_a', 'service_b', '2030-01-08 20:00Z', '+15550004444')$$,
  '23503', null, 'a service from another shop is rejected'
);

-- Rate limiter ---------------------------------------------------------------

select is((select allowed from public.hit_rate_limit('test:key', 3600, 2)), true, 'first hit is allowed');
select is((select allowed from public.hit_rate_limit('test:key', 3600, 2)), true, 'hit up to the limit is allowed');
select results_eq(
  $$select allowed, retry_after_seconds > 0 from public.hit_rate_limit('test:key', 3600, 2)$$,
  $$values (false, true)$$,
  'hit over the limit is blocked with a retry delay'
);
select is((select allowed from public.hit_rate_limit('test:other', 3600, 2)), true, 'limits are per key');

reset role;

select * from finish();
rollback;
