begin;
select plan(18);

select tests.seed_two_shops();

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', tests.id('user_demo'), 'authenticated', 'authenticated', 'demo@test.example.com');

create temporary table demo (shop_id uuid) on commit drop;
grant select on demo to authenticated;
insert into demo select private.configure_demo_shop(tests.id('user_demo'), 'test-demo');

-- Configuration and generated data ---------------------------------------------

select is(
  (select slug from public.shops where id = (select shop_id from demo)),
  'test-demo',
  'configure_demo_shop creates the demo shop with the given slug'
);

select is(
  (select role from public.shop_members where shop_id = (select shop_id from demo) and user_id = tests.id('user_demo')),
  'owner',
  'the demo user owns the demo shop'
);

select results_eq(
  $$select
      (select count(*)::int from public.staff where shop_id = (select shop_id from demo)),
      (select count(*)::int from public.services where shop_id = (select shop_id from demo)),
      (select count(*)::int from public.clients where shop_id = (select shop_id from demo))$$,
  $$values (3, 5, 30)$$,
  'demo shop has staff, services and clients'
);

select ok(
  (select count(*) from public.bookings where shop_id = (select shop_id from demo) and starts_at < now()) > 50
    and (select count(*) from public.bookings where shop_id = (select shop_id from demo) and starts_at > now()) > 10,
  'demo shop has past and upcoming bookings'
);

select is(
  (select count(*)::int from public.bookings
   where shop_id = (select shop_id from demo)
     and status = 'confirmed'
     and starts_at < (now() at time zone 'America/Toronto')::date::timestamp at time zone 'America/Toronto'),
  0,
  'bookings before today all have an outcome'
);

select ok(public.is_demo_shop((select shop_id from demo)), 'is_demo_shop is true for the demo shop');
select ok(not public.is_demo_shop(tests.id('shop_a')), 'is_demo_shop is false for other shops');

select is(
  (select count(*)::int from cron.job where jobname = 'fullcut-demo-reset'),
  1,
  'nightly reset is scheduled'
);

-- Visitors can edit day-to-day data but not the shop row or memberships ---------

select tests.authenticate_as(tests.id('user_demo'));

select lives_ok(
  $$insert into public.clients (shop_id, name) values ((select shop_id from demo), 'Visitor Added')$$,
  'demo visitors can add clients'
);

select throws_ok(
  $$update public.shops set slug = 'hijacked' where id = (select shop_id from demo)$$,
  '42501', 'demo_shop_locked', 'demo visitors cannot change the shop row'
);

select throws_ok(
  $$delete from public.shop_members where shop_id = (select shop_id from demo)$$,
  '42501', 'demo_shop_locked', 'demo visitors cannot change memberships'
);

select tests.authenticate_as(tests.id('user_a'));

select is(
  tests.affected($$update public.shops set name = 'Renamed A' where id = tests.id('shop_a')$$),
  1,
  'other owners can still update their own shop'
);

select throws_ok(
  $$select private.reset_demo_shop()$$,
  '42501', null, 'signed-in users cannot run the reset'
);

select tests.clear_authentication();

-- Reset ------------------------------------------------------------------------

create temporary table before_reset on commit drop as
select
  (select count(*) from public.bookings where shop_id = (select shop_id from demo)) as demo_bookings,
  (select count(*) from public.bookings where shop_id = tests.id('shop_a')) as shop_a_bookings;

select private.reset_demo_shop();

select is(
  (select count(*)::int from public.clients where shop_id = (select shop_id from demo) and name = 'Visitor Added'),
  0,
  'reset removes visitor changes'
);

select is(
  (select count(*) from public.bookings where shop_id = (select shop_id from demo)),
  (select demo_bookings from before_reset),
  'reset is repeatable'
);

select is(
  (select count(*) from public.bookings where shop_id = tests.id('shop_a')),
  (select shop_a_bookings from before_reset),
  'reset leaves other shops alone'
);

select is(
  (select name from public.shops where id = tests.id('shop_a')),
  'Renamed A',
  'reset does not touch other shop rows'
);

select throws_ok(
  $$select private.configure_demo_shop(tests.id('user_a'), 'not-a-demo')$$,
  'P0001', 'demo_user_has_other_shops', 'a real owner can never be made the demo user'
);

select * from finish();
rollback;
