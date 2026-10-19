begin;
select plan(14);

select tests.seed_two_shops();

set local role anon;

select throws_ok('select * from public.shops', '42501', null, 'anon cannot read shops');
select throws_ok('select * from public.shop_members', '42501', null, 'anon cannot read shop_members');
select throws_ok('select * from public.staff', '42501', null, 'anon cannot read staff');
select throws_ok('select * from public.services', '42501', null, 'anon cannot read services');
select throws_ok('select * from public.clients', '42501', null, 'anon cannot read clients');
select throws_ok('select * from public.bookings', '42501', null, 'anon cannot read bookings');
select throws_ok('select * from public.availability_rules', '42501', null, 'anon cannot read availability_rules');
select throws_ok('select * from public.time_off', '42501', null, 'anon cannot read time_off');
select throws_ok('select * from public.webhook_events', '42501', null, 'anon cannot read webhook_events');
select throws_ok(
  $$insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
    values (tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_a'),
      '2030-02-01 15:00Z', '2030-02-01 15:30Z', '2030-02-01 15:40Z', 'confirmed', 3000)$$,
  '42501',
  null,
  'anon cannot create bookings directly'
);
select throws_ok($$select public.is_shop_member(tests.id('shop_a'))$$, '42501', null, 'anon cannot call is_shop_member');

reset role;

-- webhook_events is service-role only, even for signed-in owners.
select tests.authenticate_as(tests.id('user_a'));
select throws_ok('select * from public.webhook_events', '42501', null, 'authenticated cannot read webhook_events');
select throws_ok(
  $$insert into public.webhook_events (provider, event_id) values ('stripe', 'evt_test')$$,
  '42501',
  null,
  'authenticated cannot write webhook_events'
);
select tests.clear_authentication();

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE'
  ),
  'authenticated has no TRUNCATE (it bypasses RLS)'
);

select * from finish();
rollback;
