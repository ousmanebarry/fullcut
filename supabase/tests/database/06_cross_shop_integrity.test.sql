begin;
select plan(10);

select tests.seed_two_shops();

-- Run as the table owner so these prove the foreign keys, not RLS.
select throws_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
    values (tests.id('shop_a'), tests.id('staff_b'), tests.id('client_a'), tests.id('service_a'),
      '2030-05-01 15:00Z', '2030-05-01 15:30Z', '2030-05-01 15:40Z', 'confirmed', 3000)$$,
  '23503',
  'insert or update on table "bookings" violates foreign key constraint "bookings_staff_same_shop_fk"',
  'booking with another shop''s staff is rejected'
);
select throws_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
    values (tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_b'),
      '2030-05-01 15:00Z', '2030-05-01 15:30Z', '2030-05-01 15:40Z', 'confirmed', 3000)$$,
  '23503',
  'insert or update on table "bookings" violates foreign key constraint "bookings_service_same_shop_fk"',
  'booking with another shop''s service is rejected'
);
select throws_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
    values (tests.id('shop_a'), tests.id('staff_a'), tests.id('client_b'), tests.id('service_a'),
      '2030-05-01 15:00Z', '2030-05-01 15:30Z', '2030-05-01 15:40Z', 'confirmed', 3000)$$,
  '23503',
  'insert or update on table "bookings" violates foreign key constraint "bookings_client_same_shop_fk"',
  'booking with another shop''s client is rejected'
);
select throws_ok(
  $$update public.bookings
       set staff_id = tests.id('staff_b'),
           starts_at = '2030-06-01 15:00Z', ends_at = '2030-06-01 15:30Z', blocked_until = '2030-06-01 15:40Z'
     where id = tests.id('booking_a')$$,
  '23503',
  'insert or update on table "bookings" violates foreign key constraint "bookings_staff_same_shop_fk"',
  'moving a booking to another shop''s staff is rejected'
);
select lives_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
    values (tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_a'),
      '2030-05-01 15:00Z', '2030-05-01 15:30Z', '2030-05-01 15:40Z', 'confirmed', 3000)$$,
  'booking with same-shop staff, service and client is allowed'
);
select throws_ok(
  $$insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
    values (tests.id('shop_a'), tests.id('staff_b'), 1, '09:00', '17:00')$$,
  '23503',
  'insert or update on table "availability_rules" violates foreign key constraint "availability_rules_staff_same_shop_fk"',
  'availability rule for another shop''s staff is rejected'
);
select throws_ok(
  $$insert into public.time_off (shop_id, staff_id, starts_at, ends_at)
    values (tests.id('shop_a'), tests.id('staff_b'), '2030-05-01 14:00Z', '2030-05-01 22:00Z')$$,
  '23503',
  'insert or update on table "time_off" violates foreign key constraint "time_off_staff_same_shop_fk"',
  'time off for another shop''s staff is rejected'
);
select throws_ok(
  $$update public.shop_members set staff_id = tests.id('staff_b') where user_id = tests.id('user_a')$$,
  '23503',
  'insert or update on table "shop_members" violates foreign key constraint "shop_members_staff_same_shop_fk"',
  'linking a login to another shop''s staff profile is rejected'
);

-- Staff with bookings can't be hard-deleted; deleting a whole shop still cascades.
select throws_ok(
  $$delete from public.staff where id = tests.id('staff_a')$$,
  '23503',
  null,
  'staff with bookings cannot be deleted'
);
delete from public.shops where id = tests.id('shop_b');
select is(
  (select count(*)::int from public.bookings where shop_id = tests.id('shop_b'))
    + (select count(*)::int from public.staff where shop_id = tests.id('shop_b')),
  0,
  'deleting a shop removes its staff and bookings'
);

select * from finish();
rollback;
