begin;
select plan(27);

select tests.seed_two_shops();

-- Staff-role member of shop A, linked to staff_a2.
select tests.authenticate_as(tests.id('user_a_staff'));

select is((select count(*)::int from public.staff), 2, 'staff member can read their shop''s staff');
select is((select count(*)::int from public.services), 1, 'staff member can read their shop''s services');

select throws_ok(
  $$insert into public.staff (shop_id, display_name) values (tests.id('shop_a'), 'Sneaky')$$,
  '42501',
  'new row violates row-level security policy for table "staff"',
  'staff member cannot add staff'
);
select is(tests.affected($$update public.staff set display_name = 'Renamed' where shop_id = tests.id('shop_a')$$), 0, 'staff member cannot edit staff');
select is(tests.affected($$delete from public.staff where id = tests.id('staff_a2')$$), 0, 'staff member cannot delete staff');

select throws_ok(
  $$insert into public.services (shop_id, name, duration_minutes, price_cents) values (tests.id('shop_a'), 'Free cut', 30, 0)$$,
  '42501',
  'new row violates row-level security policy for table "services"',
  'staff member cannot add services'
);
select is(tests.affected($$update public.services set price_cents = 1 where shop_id = tests.id('shop_a')$$), 0, 'staff member cannot edit services');
select is(tests.affected($$delete from public.services where shop_id = tests.id('shop_a')$$), 0, 'staff member cannot delete services');

select lives_ok(
  $$insert into public.availability_rules (id, shop_id, staff_id, weekday, start_time, end_time)
    values (tests.id('rule_a2'), tests.id('shop_a'), tests.id('staff_a2'), 1, '10:00', '18:00')$$,
  'staff member can add their own hours'
);
select is(tests.affected($$update public.availability_rules set end_time = '19:00' where id = tests.id('rule_a2')$$), 1, 'staff member can edit their own hours');
select throws_ok(
  $$insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
    values (tests.id('shop_a'), tests.id('staff_a'), 1, '10:00', '18:00')$$,
  '42501',
  'new row violates row-level security policy for table "availability_rules"',
  'staff member cannot add a colleague''s hours'
);
select is(tests.affected($$update public.availability_rules set end_time = '12:00' where id = tests.id('rule_a')$$), 0, 'staff member cannot edit a colleague''s hours');
select is(tests.affected($$delete from public.availability_rules where id = tests.id('rule_a')$$), 0, 'staff member cannot delete a colleague''s hours');

select lives_ok(
  $$insert into public.time_off (shop_id, staff_id, starts_at, ends_at)
    values (tests.id('shop_a'), tests.id('staff_a2'), '2030-05-01 14:00Z', '2030-05-01 22:00Z')$$,
  'staff member can add their own time off'
);
select throws_ok(
  $$insert into public.time_off (shop_id, staff_id, starts_at, ends_at)
    values (tests.id('shop_a'), tests.id('staff_a'), '2030-05-01 14:00Z', '2030-05-01 22:00Z')$$,
  '42501',
  'new row violates row-level security policy for table "time_off"',
  'staff member cannot add a colleague''s time off'
);
select is(tests.affected($$delete from public.time_off where id = tests.id('time_off_a')$$), 0, 'staff member cannot delete a colleague''s time off');

select lives_ok(
  $$select public.replace_availability_rules(tests.id('staff_a2'), '[{"weekday": 3, "start_time": "09:00", "end_time": "13:00"}]')$$,
  'staff member can replace their own weekly hours'
);
select throws_ok(
  $$select public.replace_availability_rules(tests.id('staff_a'), '[]')$$,
  '42501',
  'availability_rules_forbidden',
  'staff member cannot replace a colleague''s weekly hours'
);
select lives_ok(
  $$select public.reorder_services(tests.id('shop_a'), array[tests.id('service_a')])$$,
  'reorder_services runs for a staff member'
);

-- Owner of shop A.
select tests.authenticate_as(tests.id('user_a'));

select is(tests.affected($$update public.staff set display_name = 'Renamed A2' where id = tests.id('staff_a2')$$), 1, 'owner can edit staff');
select lives_ok(
  $$insert into public.services (id, shop_id, name, duration_minutes, price_cents, sort_order)
    values (tests.id('service_a2'), tests.id('shop_a'), 'Beard', 20, 2000, 1)$$,
  'owner can add services'
);
select lives_ok(
  $$select public.reorder_services(tests.id('shop_a'), array[tests.id('service_a2'), tests.id('service_a')])$$,
  'owner can reorder services'
);
select results_eq(
  $$select id from public.services where shop_id = tests.id('shop_a') order by sort_order$$,
  array[tests.id('service_a2'), tests.id('service_a')],
  'services follow the new order'
);
select lives_ok(
  $$select public.replace_availability_rules(tests.id('staff_a2'),
    '[{"weekday": 1, "start_time": "09:00", "end_time": "12:00"}, {"weekday": 1, "start_time": "13:00", "end_time": "17:00"}]')$$,
  'owner can replace a staff member''s weekly hours'
);
select is(
  (select count(*)::int from public.availability_rules where staff_id = tests.id('staff_a2')),
  2,
  'replaced hours contain exactly the new windows'
);
select throws_ok(
  $$select public.replace_availability_rules(tests.id('staff_b'), '[]')$$,
  'P0002',
  'staff_not_found',
  'owner cannot touch another shop''s staff hours'
);

select tests.clear_authentication();
select is(
  (select count(*)::int from public.availability_rules where id = tests.id('rule_a')),
  1,
  'colleague''s hours are untouched'
);

select * from finish();
rollback;
