begin;
select plan(58);

select tests.seed_two_shops();

select is(
  (select array_agg(c.relname::text order by c.relname)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null,
  'every public table has row-level security enabled'
);

-- Owner of shop A against every tenant table (9 tests each).
select tests.authenticate_as(tests.id('user_a'));

select * from tests.rls_isolation(
  'staff', 'shop_id, display_name',
  $$tests.id('shop_a'), 'New A'$$,
  $$tests.id('shop_b'), 'New B'$$
);

select * from tests.rls_isolation(
  'services', 'shop_id, name, duration_minutes, price_cents',
  $$tests.id('shop_a'), 'New A', 30, 1000$$,
  $$tests.id('shop_b'), 'New B', 30, 1000$$
);

select * from tests.rls_isolation(
  'clients', 'shop_id, name',
  $$tests.id('shop_a'), 'New A'$$,
  $$tests.id('shop_b'), 'New B'$$
);

select * from tests.rls_isolation(
  'bookings', 'shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents',
  $$tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_a'),
    '2030-02-01 15:00Z', '2030-02-01 15:30Z', '2030-02-01 15:40Z', 'confirmed', 3000$$,
  $$tests.id('shop_b'), tests.id('staff_b'), tests.id('client_b'), tests.id('service_b'),
    '2030-02-01 15:00Z', '2030-02-01 15:30Z', '2030-02-01 15:40Z', 'confirmed', 3000$$
);

select * from tests.rls_isolation(
  'availability_rules', 'shop_id, staff_id, weekday, start_time, end_time',
  $$tests.id('shop_a'), tests.id('staff_a'), 3, '09:00', '17:00'$$,
  $$tests.id('shop_b'), tests.id('staff_b'), 3, '09:00', '17:00'$$
);

select * from tests.rls_isolation(
  'time_off', 'shop_id, staff_id, starts_at, ends_at',
  $$tests.id('shop_a'), tests.id('staff_a'), '2030-02-02 14:00Z', '2030-02-02 22:00Z'$$,
  $$tests.id('shop_b'), tests.id('staff_b'), '2030-02-02 14:00Z', '2030-02-02 22:00Z'$$
);

-- Staff-role members get the same tenant access as owners.
select tests.authenticate_as(tests.id('user_a_staff'));
select results_eq(
  'select id from public.bookings',
  array[tests.id('booking_a')],
  'staff member sees their shop''s bookings only'
);

-- Signed in, but not a member of any shop.
select tests.authenticate_as(tests.id('user_c'));
select is(
  (select (select count(*) from public.staff) + (select count(*) from public.services) + (select count(*) from public.clients)
        + (select count(*) from public.bookings) + (select count(*) from public.availability_rules)
        + (select count(*) from public.time_off))::int,
  0,
  'outsider sees no tenant rows'
);

select tests.clear_authentication();
select is(
  array[
    (select count(*) from public.staff where shop_id = tests.id('shop_b')),
    (select count(*) from public.services where shop_id = tests.id('shop_b')),
    (select count(*) from public.clients where shop_id = tests.id('shop_b')),
    (select count(*) from public.bookings where shop_id = tests.id('shop_b')),
    (select count(*) from public.availability_rules where shop_id = tests.id('shop_b')),
    (select count(*) from public.time_off where shop_id = tests.id('shop_b'))
  ]::int[],
  array[1, 1, 1, 1, 1, 1],
  'shop B rows are untouched'
);

select * from finish();
rollback;
