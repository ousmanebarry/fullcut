-- Shared helpers for database tests. Runs first (files run alphabetically) and is committed, not rolled back,
-- so later test files can call tests.*. Only ever installed into local/CI databases by `supabase test db`.

set client_min_messages to warning;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

-- Readable, stable fixture ids: tests.id('shop_a').
create or replace function tests.id(p_name text)
returns uuid
language sql
immutable
as $$
  select md5('fullcut-test-' || p_name)::uuid;
$$;

create or replace function tests.authenticate_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- Runs a statement as the current role and returns how many rows it touched.
create or replace function tests.affected(p_sql text)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Two shops with one row in every tenant table, plus an owner each, a staff-role member of A, and an outsider.
create or replace function tests.seed_two_shops()
returns void
language plpgsql
as $$
begin
  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', tests.id('user_a'),       'authenticated', 'authenticated', 'owner-a@test.example.com'),
    ('00000000-0000-0000-0000-000000000000', tests.id('user_a_staff'), 'authenticated', 'authenticated', 'staff-a@test.example.com'),
    ('00000000-0000-0000-0000-000000000000', tests.id('user_b'),       'authenticated', 'authenticated', 'owner-b@test.example.com'),
    ('00000000-0000-0000-0000-000000000000', tests.id('user_c'),       'authenticated', 'authenticated', 'outsider@test.example.com');

  insert into public.shops (id, name, slug, timezone) values
    (tests.id('shop_a'), 'Test Shop A', 'test-shop-a', 'America/Toronto'),
    (tests.id('shop_b'), 'Test Shop B', 'test-shop-b', 'America/Toronto');

  insert into public.staff (id, shop_id, display_name) values
    (tests.id('staff_a'),  tests.id('shop_a'), 'Staff A'),
    (tests.id('staff_a2'), tests.id('shop_a'), 'Staff A2'),
    (tests.id('staff_b'),  tests.id('shop_b'), 'Staff B');

  insert into public.shop_members (shop_id, user_id, role, staff_id) values
    (tests.id('shop_a'), tests.id('user_a'),       'owner', tests.id('staff_a')),
    (tests.id('shop_a'), tests.id('user_a_staff'), 'staff', tests.id('staff_a2')),
    (tests.id('shop_b'), tests.id('user_b'),       'owner', tests.id('staff_b'));

  insert into public.services (id, shop_id, name, duration_minutes, buffer_minutes, price_cents) values
    (tests.id('service_a'), tests.id('shop_a'), 'Cut A', 30, 10, 3000),
    (tests.id('service_b'), tests.id('shop_b'), 'Cut B', 30, 10, 3000);

  insert into public.clients (id, shop_id, name, phone_e164) values
    (tests.id('client_a'), tests.id('shop_a'), 'Client A', '+15559990001'),
    (tests.id('client_b'), tests.id('shop_b'), 'Client B', '+15559990002');

  insert into public.bookings (id, shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents) values
    (tests.id('booking_a'), tests.id('shop_a'), tests.id('staff_a'), tests.id('client_a'), tests.id('service_a'),
      '2030-01-08 15:00Z', '2030-01-08 15:30Z', '2030-01-08 15:40Z', 'confirmed', 3000),
    (tests.id('booking_b'), tests.id('shop_b'), tests.id('staff_b'), tests.id('client_b'), tests.id('service_b'),
      '2030-01-08 15:00Z', '2030-01-08 15:30Z', '2030-01-08 15:40Z', 'confirmed', 3000);

  insert into public.availability_rules (id, shop_id, staff_id, weekday, start_time, end_time) values
    (tests.id('rule_a'), tests.id('shop_a'), tests.id('staff_a'), 2, '09:00', '17:00'),
    (tests.id('rule_b'), tests.id('shop_b'), tests.id('staff_b'), 2, '09:00', '17:00');

  insert into public.time_off (id, shop_id, staff_id, starts_at, ends_at) values
    (tests.id('time_off_a'), tests.id('shop_a'), tests.id('staff_a'), '2030-01-09 14:00Z', '2030-01-09 22:00Z'),
    (tests.id('time_off_b'), tests.id('shop_b'), tests.id('staff_b'), '2030-01-09 14:00Z', '2030-01-09 22:00Z');
end;
$$;

-- Inserts a booking for p_staff_id using a client and service from the same shop.
create or replace function tests.insert_booking(
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_minutes int,
  p_buffer_minutes int,
  p_status text,
  p_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
as $$
declare
  v_shop_id uuid;
begin
  select shop_id into v_shop_id from public.staff where id = p_staff_id;
  insert into public.bookings (id, shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
  values (
    p_id, v_shop_id, p_staff_id,
    (select id from public.clients where shop_id = v_shop_id order by created_at, id limit 1),
    (select id from public.services where shop_id = v_shop_id order by created_at, id limit 1),
    p_starts_at,
    p_starts_at + make_interval(mins => p_minutes),
    p_starts_at + make_interval(mins => p_minutes + p_buffer_minutes),
    p_status,
    3000
  );
  return p_id;
end;
$$;

-- Standard cross-shop checks for a tenant table; caller must be authenticated as shop A's owner. Emits 9 tests.
create or replace function tests.rls_isolation(p_table text, p_cols text, p_values_a text, p_values_b text)
returns setof text
language plpgsql
as $$
declare
  v_shop_a uuid := tests.id('shop_a');
  v_shop_b uuid := tests.id('shop_b');
  v_count int;
  v_id uuid;
begin
  execute format('select count(*) from public.%I where shop_id <> $1', p_table) into v_count using v_shop_a;
  return next is(v_count, 0, p_table || ': sees no other shop''s rows');

  execute format('select count(*) from public.%I where shop_id = $1', p_table) into v_count using v_shop_a;
  return next ok(v_count > 0, p_table || ': sees own shop''s rows');

  return next throws_ok(
    format('insert into public.%I (%s) values (%s)', p_table, p_cols, p_values_b),
    '42501',
    format('new row violates row-level security policy for table "%s"', p_table),
    p_table || ': cannot insert into another shop'
  );

  execute format('insert into public.%I (%s) values (%s) returning id', p_table, p_cols, p_values_a) into v_id;
  return next ok(v_id is not null, p_table || ': can insert into own shop');

  return next is(
    tests.affected(format('update public.%I set shop_id = shop_id where id = %L', p_table, v_id)),
    1,
    p_table || ': can update own row'
  );

  return next is(
    tests.affected(format('update public.%I set shop_id = shop_id where shop_id = %L', p_table, v_shop_b)),
    0,
    p_table || ': cannot update another shop''s rows'
  );

  return next throws_ok(
    format('update public.%I set shop_id = %L where id = %L', p_table, v_shop_b, v_id),
    '42501',
    null,
    p_table || ': cannot move own row into another shop'
  );

  return next is(
    tests.affected(format('delete from public.%I where shop_id = %L', p_table, v_shop_b)),
    0,
    p_table || ': cannot delete another shop''s rows'
  );

  return next is(
    tests.affected(format('delete from public.%I where id = %L', p_table, v_id)),
    1,
    p_table || ': can delete own row'
  );
end;
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

begin;
select plan(1);
select has_function('tests', 'seed_two_shops', 'test helpers are installed');
select * from finish();
rollback;
