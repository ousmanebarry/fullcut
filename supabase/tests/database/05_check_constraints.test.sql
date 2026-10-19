begin;
select plan(17);

select tests.seed_two_shops();

-- services
select throws_ok(
  $$insert into public.services (shop_id, name, duration_minutes, price_cents) values (tests.id('shop_a'), 'X', 30, -1)$$,
  '23514',
  'new row for relation "services" violates check constraint "services_price_nonnegative"',
  'service with a negative price is rejected'
);
select throws_ok(
  $$insert into public.services (shop_id, name, duration_minutes, price_cents, deposit_cents) values (tests.id('shop_a'), 'X', 30, 1000, -1)$$,
  '23514',
  'new row for relation "services" violates check constraint "services_deposit_nonnegative"',
  'service with a negative deposit is rejected'
);
select throws_ok(
  $$insert into public.services (shop_id, name, duration_minutes, price_cents) values (tests.id('shop_a'), 'X', 0, 1000)$$,
  '23514',
  'new row for relation "services" violates check constraint "services_duration_positive"',
  'service with zero duration is rejected'
);
select throws_ok(
  $$insert into public.services (shop_id, name, duration_minutes, buffer_minutes, price_cents) values (tests.id('shop_a'), 'X', 30, -5, 1000)$$,
  '23514',
  'new row for relation "services" violates check constraint "services_buffer_nonnegative"',
  'service with a negative buffer is rejected'
);

-- bookings
select throws_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
    values (tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_a'),
      '2030-04-01 15:00Z', '2030-04-01 15:30Z', '2030-04-01 15:40Z', 'confirmed', -1)$$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_price_nonnegative"',
  'booking with a negative price is rejected'
);
select throws_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
    values (tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_a'),
      '2030-04-01 15:00Z', '2030-04-01 15:00Z', '2030-04-01 15:10Z', 'confirmed', 3000)$$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_time_order"',
  'booking with starts_at = ends_at is rejected'
);
select throws_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
    values (tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_a'),
      '2030-04-01 15:30Z', '2030-04-01 15:00Z', '2030-04-01 15:40Z', 'confirmed', 3000)$$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_time_order"',
  'booking with starts_at after ends_at is rejected'
);
select throws_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
    values (tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_a'),
      '2030-04-01 15:00Z', '2030-04-01 15:30Z', '2030-04-01 15:20Z', 'confirmed', 3000)$$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_time_order"',
  'booking whose blocked_until is before ends_at is rejected'
);
select throws_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
    values (tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_a'),
      '2030-04-01 15:00Z', '2030-04-01 15:30Z', '2030-04-01 15:40Z', 'maybe', 3000)$$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_status_valid"',
  'booking with an invalid status is rejected'
);
select throws_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents, risk_score)
    values (tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_a'),
      '2030-04-01 15:00Z', '2030-04-01 15:30Z', '2030-04-01 15:40Z', 'confirmed', 3000, 1.5)$$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_risk_score_range"',
  'booking with a risk score above 1 is rejected'
);

-- availability_rules and time_off
select throws_ok(
  $$insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time) values (tests.id('shop_a'), tests.id('staff_a'), 7, '09:00', '17:00')$$,
  '23514',
  'new row for relation "availability_rules" violates check constraint "availability_rules_weekday_valid"',
  'availability rule with weekday 7 is rejected'
);
select throws_ok(
  $$insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time) values (tests.id('shop_a'), tests.id('staff_a'), 1, '17:00', '09:00')$$,
  '23514',
  'new row for relation "availability_rules" violates check constraint "availability_rules_time_order"',
  'availability rule ending before it starts is rejected'
);
select throws_ok(
  $$insert into public.time_off (shop_id, staff_id, starts_at, ends_at) values (tests.id('shop_a'), tests.id('staff_a'), '2030-04-01 15:00Z', '2030-04-01 15:00Z')$$,
  '23514',
  'new row for relation "time_off" violates check constraint "time_off_time_order"',
  'empty time off range is rejected'
);

-- clients and members
select throws_ok(
  $$insert into public.clients (shop_id, name, phone_e164) values (tests.id('shop_a'), 'X', '555-0100')$$,
  '23514',
  'new row for relation "clients" violates check constraint "clients_phone_e164_format"',
  'client phone not in E.164 is rejected'
);
select throws_ok(
  $$insert into public.clients (shop_id, name, email) values (tests.id('shop_a'), 'X', ' Someone@Example.com')$$,
  '23514',
  'new row for relation "clients" violates check constraint "clients_email_normalized"',
  'client email that is not trimmed and lowercased is rejected'
);
select throws_ok(
  $$insert into public.clients (shop_id, name, phone_e164) values (tests.id('shop_a'), 'Duplicate', '+15559990001')$$,
  '23505',
  'duplicate key value violates unique constraint "clients_shop_phone_unique"',
  'duplicate phone within a shop is rejected'
);
select throws_ok(
  $$insert into public.shop_members (shop_id, user_id, role) values (tests.id('shop_a'), tests.id('user_c'), 'admin')$$,
  '23514',
  'new row for relation "shop_members" violates check constraint "shop_members_role_valid"',
  'member with an unknown role is rejected'
);

select * from finish();
rollback;
