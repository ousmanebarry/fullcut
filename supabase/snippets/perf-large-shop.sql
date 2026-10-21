-- Slow-query check: loads ~1M synthetic bookings, EXPLAINs the dashboard's hot queries as the seed
-- owner (RLS on), then rolls everything back. Local only:
--   docker exec -i supabase_db_fullcut psql -U postgres < supabase/snippets/perf-large-shop.sql

begin;

-- Triggers (messages, freed slots, audit) are irrelevant to read performance and slow the load.
set local session_replication_role = replica;

create temp table perf_shops on commit drop as
select '10000000-0000-4000-8000-000000000001'::uuid as shop_id, true as seed
union all
select gen_random_uuid(), false from generate_series(1, 30);

insert into public.shops (id, name, slug, timezone)
select shop_id, 'Perf shop', 'perf-' || shop_id, 'America/Toronto' from perf_shops where not seed;

-- New staff only, so future confirmed bookings never collide with the seed's.
create temp table perf_staff on commit drop as
select s.shop_id, gen_random_uuid() as staff_id
from perf_shops s, generate_series(1, case when s.seed then 3 else 6 end);
insert into public.staff (id, shop_id, display_name)
select staff_id, shop_id, 'Perf staff' from perf_staff;

create temp table perf_services on commit drop as
select shop_id, gen_random_uuid() as service_id from perf_shops;
insert into public.services (id, shop_id, name, duration_minutes, buffer_minutes, price_cents)
select service_id, shop_id, 'Perf cut', 30, 5, 3500 from perf_services;

create temp table perf_clients on commit drop as
select s.shop_id, n, gen_random_uuid() as client_id
from perf_shops s, generate_series(1, 4000) n;
insert into public.clients (id, shop_id, name, phone_e164)
select client_id, shop_id, 'Perf client ' || n, '+1416' || (5000000 + n) from perf_clients;

-- Three years back and 60 days ahead, weekdays 09:00-16:00 on the hour, ~70% full.
insert into public.bookings (
  shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents
)
select g.shop_id, g.staff_id, c.client_id, sv.service_id, g.starts_at,
  g.starts_at + interval '30 minutes', g.starts_at + interval '35 minutes',
  case
    when g.starts_at > now() then case when g.r < 0.9 then 'confirmed' else 'cancelled' end
    when g.r < 0.85 then 'completed'
    when g.r < 0.92 then 'no_show'
    else 'cancelled'
  end,
  3500
from (
  select st.shop_id, st.staff_id,
    ((d + make_interval(hours => h))::timestamp at time zone 'America/Toronto') as starts_at,
    random() as r, 1 + floor(random() * 4000)::int as client_n
  from perf_staff st,
    generate_series(current_date - 1095, current_date + 60, interval '1 day') d,
    generate_series(9, 16) h
  where extract(isodow from d) < 6 and random() < 0.7
) g
join perf_clients c on c.shop_id = g.shop_id and c.n = g.client_n
join perf_services sv on sv.shop_id = g.shop_id;

analyze public.bookings;
analyze public.clients;

select count(*) as total_bookings,
  count(*) filter (where shop_id = '10000000-0000-4000-8000-000000000001') as seed_shop_bookings
from public.bookings;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub": "20000000-0000-4000-8000-000000000001", "role": "authenticated"}',
  true
);

\echo '--- calendar: one week (loadBookings)'
explain (analyze, buffers, costs off)
select b.*, c.name, c.phone_e164, sv.name, st.display_name
from public.bookings b
left join public.clients c on c.shop_id = b.shop_id and c.id = b.client_id
left join public.services sv on sv.shop_id = b.shop_id and sv.id = b.service_id
left join public.staff st on st.shop_id = b.shop_id and st.id = b.staff_id
where b.shop_id = '10000000-0000-4000-8000-000000000001'
  and b.starts_at >= now() - interval '12 hours'
  and b.starts_at < now() + interval '7 days'
  and b.blocked_until > now()
  and (b.status <> 'cancelled' or b.release_reason is not null)
order by b.starts_at, b.id;

\echo '--- today: unmarked count (countUnmarked)'
explain (analyze, buffers, costs off)
select count(*) from public.bookings
where shop_id = '10000000-0000-4000-8000-000000000001' and status = 'confirmed' and ends_at <= now();

\echo '--- clients: total for pagination (listClients count=exact)'
explain (analyze, buffers, costs off)
select count(*) from public.client_stats
where shop_id = '10000000-0000-4000-8000-000000000001' and anonymised_at is null;

\echo '--- clients: first page by name (listClients)'
explain (analyze, buffers, costs off)
select id, name, phone_e164, visits, no_shows, last_visit_at, next_booking_at
from public.client_stats
where shop_id = '10000000-0000-4000-8000-000000000001' and anonymised_at is null
order by name, id limit 25;

\echo '--- clients: first page by last visit (listClients sort=last_visit)'
explain (analyze, buffers, costs off)
select id, name, phone_e164, visits, no_shows, last_visit_at, next_booking_at
from public.client_stats
where shop_id = '10000000-0000-4000-8000-000000000001' and anonymised_at is null
order by last_visit_at desc nulls last, name, id limit 25;

rollback;
