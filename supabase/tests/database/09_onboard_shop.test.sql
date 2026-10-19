begin;
select plan(13);

select tests.seed_two_shops();

grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', tests.id('user_d'), 'authenticated', 'authenticated', 'new-owner@test.example.com');

create temporary table payloads (name text primary key, body jsonb) on commit drop;
grant select on payloads to service_role, authenticated, anon;
insert into payloads values
  ('valid', $${
    "shop": {"name": "New Cuts", "slug": "new-cuts", "timezone": "America/Toronto", "currency": "CAD"},
    "staff": {"display_name": "Sam Owner"},
    "services": [
      {"name": "Haircut", "duration_minutes": 30, "buffer_minutes": 5, "price_cents": 3500},
      {"name": "Beard trim", "duration_minutes": 20, "buffer_minutes": 0, "price_cents": 2000}
    ],
    "rules": [
      {"weekday": 2, "start_time": "09:00", "end_time": "12:00"},
      {"weekday": 2, "start_time": "13:00", "end_time": "17:00"},
      {"weekday": 3, "start_time": "09:00", "end_time": "17:00"}
    ]
  }$$),
  ('bad_service', $${
    "shop": {"name": "Broken Cuts", "slug": "broken-cuts", "timezone": "America/Toronto"},
    "staff": {"display_name": "Sam"},
    "services": [{"name": "Haircut", "duration_minutes": 30, "price_cents": -1}],
    "rules": []
  }$$),
  ('taken_slug', $${
    "shop": {"name": "Copy", "slug": "test-shop-a", "timezone": "America/Toronto"},
    "staff": {"display_name": "Sam"},
    "services": [{"name": "Haircut", "duration_minutes": 30, "price_cents": 3000}]
  }$$),
  ('no_services', $${
    "shop": {"name": "Empty", "slug": "empty-shop", "timezone": "America/Toronto"},
    "staff": {"display_name": "Sam"},
    "services": []
  }$$);

-- Callers other than the service role.
set local role anon;
select throws_ok(
  $$select public.onboard_shop(tests.id('user_d'), (select body from payloads where name = 'valid'))$$,
  '42501', null, 'anon cannot call onboard_shop'
);
reset role;
select tests.authenticate_as(tests.id('user_d'));
select throws_ok(
  $$select public.onboard_shop(tests.id('user_d'), (select body from payloads where name = 'valid'))$$,
  '42501', null, 'authenticated cannot call onboard_shop'
);
select tests.clear_authentication();

set local role service_role;

-- Failures leave nothing behind.
select throws_ok(
  $$select public.onboard_shop(tests.id('user_d'), (select body from payloads where name = 'bad_service'))$$,
  '23514', null, 'invalid service aborts onboarding'
);
select throws_ok(
  $$select public.onboard_shop(tests.id('user_d'), (select body from payloads where name = 'taken_slug'))$$,
  '23505',
  'duplicate key value violates unique constraint "shops_slug_unique"',
  'taken slug aborts onboarding'
);
select throws_ok(
  $$select public.onboard_shop(tests.id('user_d'), (select body from payloads where name = 'no_services'))$$,
  'P0001', 'onboarding_no_services', 'onboarding needs at least one service'
);
select is(
  (select count(*)::int from public.shops where slug in ('broken-cuts', 'empty-shop'))
    + (select count(*)::int from public.shop_members where user_id = tests.id('user_d')),
  0,
  'failed onboarding leaves no shop or membership'
);

-- Happy path.
select lives_ok(
  $$select public.onboard_shop(tests.id('user_d'), (select body from payloads where name = 'valid'))$$,
  'service role can onboard a new owner'
);
select results_eq(
  $$select role, staff_id is not null from public.shop_members where user_id = tests.id('user_d')$$,
  $$values ('owner'::text, true)$$,
  'user is the owner, linked to a staff profile'
);
select results_eq(
  $$select st.display_name from public.staff st
    join public.shop_members m on m.staff_id = st.id and m.shop_id = st.shop_id
    where m.user_id = tests.id('user_d')$$,
  array['Sam Owner'],
  'first staff member is created'
);
select results_eq(
  $$select sv.name, sv.sort_order, sv.price_cents from public.services sv
    join public.shops s on s.id = sv.shop_id where s.slug = 'new-cuts' order by sv.sort_order$$,
  $$values ('Haircut'::text, 0, 3500), ('Beard trim'::text, 1, 2000)$$,
  'services are created in order'
);
select is(
  (select count(*)::int from public.availability_rules r join public.shops s on s.id = r.shop_id where s.slug = 'new-cuts'),
  3,
  'weekly hours are created, including split days'
);
select is(
  (select currency::text from public.shops where slug = 'new-cuts'),
  'CAD',
  'currency is stored'
);
select throws_ok(
  $$select public.onboard_shop(tests.id('user_d'), (select body from payloads where name = 'valid'))$$,
  'P0001', 'onboarding_already_member', 'a user who already has a shop cannot onboard again'
);

reset role;

select * from finish();
rollback;
