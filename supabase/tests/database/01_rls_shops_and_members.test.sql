begin;
select plan(22);

select tests.seed_two_shops();

-- A signed-in user with no membership sees nothing.
select tests.authenticate_as(tests.id('user_c'));
select is((select count(*)::int from public.shops), 0, 'outsider sees no shops');
select is((select count(*)::int from public.shop_members), 0, 'outsider sees no memberships');

-- Owner of shop A.
select tests.authenticate_as(tests.id('user_a'));
select results_eq('select id from public.shops', array[tests.id('shop_a')], 'owner sees only their shop');
select results_eq(
  'select distinct shop_id from public.shop_members',
  array[tests.id('shop_a')],
  'owner sees only their shop''s member list'
);
select throws_ok(
  $$insert into public.shops (name, slug, timezone) values ('New', 'new-shop', 'America/Toronto')$$,
  '42501',
  'new row violates row-level security policy for table "shops"',
  'shops cannot be created through the API'
);
select is(tests.affected($$update public.shops set name = 'Renamed A' where id = tests.id('shop_a')$$), 1, 'owner can update their shop');
select is(tests.affected($$update public.shops set name = 'Hacked' where id = tests.id('shop_b')$$), 0, 'owner cannot update another shop');
select is(tests.affected($$delete from public.shops where id = tests.id('shop_a')$$), 0, 'shops cannot be deleted through the API');
select lives_ok(
  $$insert into public.shop_members (shop_id, user_id, role) values (tests.id('shop_a'), tests.id('user_c'), 'staff')$$,
  'owner can add a member to their shop'
);
select throws_ok(
  $$insert into public.shop_members (shop_id, user_id, role) values (tests.id('shop_b'), tests.id('user_c'), 'owner')$$,
  '42501',
  'new row violates row-level security policy for table "shop_members"',
  'owner cannot add a member to another shop'
);
select is(
  tests.affected($$update public.shop_members set role = 'staff' where shop_id = tests.id('shop_b')$$),
  0,
  'owner cannot change another shop''s members'
);
select is(
  tests.affected($$delete from public.shop_members where shop_id = tests.id('shop_b')$$),
  0,
  'owner cannot remove another shop''s members'
);
select is(
  tests.affected($$delete from public.shop_members where shop_id = tests.id('shop_a') and user_id = tests.id('user_c')$$),
  1,
  'owner can remove a member from their shop'
);

-- Staff-role member of shop A.
select tests.authenticate_as(tests.id('user_a_staff'));
select results_eq('select id from public.shops', array[tests.id('shop_a')], 'staff member sees their shop');
select is((select count(*)::int from public.shop_members), 2, 'staff member sees their shop''s member list');
select is(tests.affected($$update public.shops set name = 'Staff edit' where id = tests.id('shop_a')$$), 0, 'staff member cannot update the shop');
select throws_ok(
  $$insert into public.shop_members (shop_id, user_id, role) values (tests.id('shop_a'), tests.id('user_c'), 'staff')$$,
  '42501',
  'new row violates row-level security policy for table "shop_members"',
  'staff member cannot add members'
);
select is(
  tests.affected($$update public.shop_members set role = 'owner' where user_id = tests.id('user_a_staff')$$),
  0,
  'staff member cannot promote themselves to owner'
);
select is(
  tests.affected($$delete from public.shop_members where shop_id = tests.id('shop_a')$$),
  0,
  'staff member cannot remove members'
);

-- Owner of shop B.
select tests.authenticate_as(tests.id('user_b'));
select results_eq('select id from public.shops', array[tests.id('shop_b')], 'owner B sees only shop B');

select tests.clear_authentication();
select is((select name from public.shops where id = tests.id('shop_b')), 'Test Shop B', 'shop B is unchanged');
select is(
  (select role from public.shop_members where user_id = tests.id('user_a_staff')),
  'staff',
  'staff member role is unchanged'
);

select * from finish();
rollback;
