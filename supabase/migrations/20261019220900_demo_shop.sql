-- Public demo shop: a shared, writable demo login whose shop is rebuilt from fake data every night
-- (docs/adr/0007-deployment-and-demo-shop.md). Config lives in a schema the Data API never exposes.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.demo_config (
  singleton      boolean primary key default true,
  -- No FK: the reset deletes and recreates this shop.
  shop_id        uuid not null,
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  slug           text not null,
  constraint demo_config_singleton check (singleton)
);

alter table private.demo_config enable row level security;

create function public.is_demo_shop(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.demo_config where shop_id = p_shop_id);
$$;

revoke execute on function public.is_demo_shop(uuid) from public, anon;
grant execute on function public.is_demo_shop(uuid) to authenticated, service_role;

-- Guards -----------------------------------------------------------------------
-- Visitors may edit bookings, clients, staff and services, but not the shop row (slug, booking page)
-- or memberships. Only signed-in users are blocked; the reset and service-role code have no auth.uid().

create function public.demo_shop_guard_shops()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and public.is_demo_shop(old.id) then
    raise exception 'demo_shop_locked' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger shops_demo_guard
  before update or delete on public.shops
  for each row execute function public.demo_shop_guard_shops();

create function public.demo_shop_guard_members()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_shop_id uuid;
begin
  if tg_op = 'INSERT' then
    v_shop_id := new.shop_id;
  else
    v_shop_id := old.shop_id;
  end if;
  if (select auth.uid()) is not null and public.is_demo_shop(v_shop_id) then
    raise exception 'demo_shop_locked' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger shop_members_demo_guard
  before insert or update or delete on public.shop_members
  for each row execute function public.demo_shop_guard_members();

-- Reset ------------------------------------------------------------------------
-- Deletes the demo shop (cascading to everything in it) and rebuilds it relative to today.

create function private.reset_demo_shop()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_config  private.demo_config;
  v_tz      constant text := 'America/Toronto';
  v_today   date;
  v_staff   uuid[];
begin
  select * into v_config from private.demo_config;
  if not found then
    return;
  end if;

  -- Two overlapping resets would both delete, then collide inserting the same shop id.
  perform pg_advisory_xact_lock(hashtextextended('fullcut.demo_reset', 0));

  v_today := (now() at time zone v_tz)::date;
  v_staff := array(
    select md5(v_config.shop_id::text || ':staff:' || n)::uuid from generate_series(1, 3) as n
  );

  delete from public.shops where id = v_config.shop_id;

  insert into public.shops (id, name, slug, timezone, currency, about_text, address)
  values (
    v_config.shop_id,
    'Fullcut Demo Barbers',
    v_config.slug,
    v_tz,
    'CAD',
    'A demo shop with made-up clients and bookings. It resets every night, so click around freely.',
    '100 Example Street, Toronto, ON'
  );

  insert into public.staff (id, shop_id, display_name) values
    (v_staff[1], v_config.shop_id, 'Alex Demo'),
    (v_staff[2], v_config.shop_id, 'Jordan Demo'),
    (v_staff[3], v_config.shop_id, 'Taylor Demo');

  insert into public.shop_members (shop_id, user_id, role, staff_id)
  values (v_config.shop_id, v_config.owner_user_id, 'owner', v_staff[1]);

  -- duration + buffer <= 60 min so the hourly booking grid below never overlaps.
  insert into public.services (shop_id, name, duration_minutes, buffer_minutes, price_cents, sort_order) values
    (v_config.shop_id, 'Haircut',       30,  5, 3500, 0),
    (v_config.shop_id, 'Skin fade',     45, 10, 4500, 1),
    (v_config.shop_id, 'Beard trim',    20,  5, 2000, 2),
    (v_config.shop_id, 'Cut and beard', 50, 10, 5500, 3),
    (v_config.shop_id, 'Kids cut',      25,  5, 2500, 4);

  insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
  select v_config.shop_id, v_staff[s.n], wd, s.start_time, s.end_time
  from (values
    (1, array[1, 2, 3, 4, 5, 6], time '09:00', time '17:00'),
    (2, array[2, 3, 4, 5, 6],    time '10:00', time '18:00'),
    (3, array[0, 3, 4, 5, 6],    time '09:00', time '18:00')
  ) as s (n, weekdays, start_time, end_time)
  cross join unnest(s.weekdays) as wd;

  insert into public.time_off (shop_id, staff_id, starts_at, ends_at, reason)
  values (
    v_config.shop_id, v_staff[2],
    (v_today + 5)::timestamp at time zone v_tz,
    (v_today + 7)::timestamp at time zone v_tz,
    'Vacation'
  );

  insert into public.clients (
    id, shop_id, name, phone_e164, email,
    marketing_opt_in, marketing_opt_in_at, marketing_opt_in_method, first_source
  )
  select
    md5(v_config.shop_id::text || ':client:' || n)::uuid,
    v_config.shop_id,
    names.first_names[1 + (n - 1) % 12] || ' ' || names.last_names[1 + (n - 1) % 5],
    '+1416555' || lpad((100 + n)::text, 4, '0'),
    case when n % 4 <> 0 then
      lower(names.first_names[1 + (n - 1) % 12] || '.' || names.last_names[1 + (n - 1) % 5] || n || '@example.com')
    end,
    n % 3 = 0,
    case when n % 3 = 0 then now() - interval '90 days' end,
    case when n % 3 = 0 then 'booking_form_checkbox' end,
    (array['returning', 'instagram', 'referral', 'google', 'walk_in'])[1 + n % 5]
  from generate_series(1, 30) as n
  cross join (select
    array['Avery', 'Blake', 'Charlie', 'Devon', 'Emerson', 'Finley', 'Harper', 'Indigo', 'Jules', 'Kai', 'Logan', 'Morgan'] as first_names,
    array['Example', 'Sample', 'Testerson', 'Placeholder', 'Fakename'] as last_names
  ) as names;

  insert into public.client_notes (shop_id, client_id, body)
  select v_config.shop_id, md5(v_config.shop_id::text || ':client:' || t.n)::uuid, t.body
  from (values
    (1, 'Prefers a low taper. Ask before taking the top shorter.'),
    (2, 'Usually a few minutes late; fine to start with the next client.'),
    (5, 'Sensitive scalp: skip the hot towel.')
  ) as t (n, body);

  -- Hourly grid inside working hours, ~60% filled, 60 days back to 14 ahead. Today's earlier
  -- bookings stay confirmed so the "mark outcome" flow has something to show.
  with slots as (
    select
      r.staff_id,
      ((d.day + r.start_time) + make_interval(hours => h)) at time zone v_tz as starts_at,
      abs(hashtext(r.staff_id::text || d.day::text || h::text)::bigint) as hash
    from public.availability_rules r
    cross join lateral (select v_today - 60 + o as day from generate_series(0, 74) as o) as d
    cross join lateral generate_series(0, extract(hour from r.end_time - r.start_time)::int - 1) as h
    where r.shop_id = v_config.shop_id
      and extract(dow from d.day) = r.weekday
  ),
  picked as (
    select
      s.staff_id,
      s.starts_at,
      s.hash,
      svc.id as service_id,
      svc.price_cents,
      s.starts_at + make_interval(mins => svc.duration_minutes) as ends_at,
      s.starts_at + make_interval(mins => svc.duration_minutes + svc.buffer_minutes) as blocked_until,
      cl.id as client_id
    from slots s
    cross join lateral (
      select v.id, v.duration_minutes, v.buffer_minutes, v.price_cents
      from public.services v
      where v.shop_id = v_config.shop_id
      order by v.sort_order
      offset (s.hash / 10) % 5
      limit 1
    ) as svc
    cross join lateral (
      select c.id
      from public.clients c
      where c.shop_id = v_config.shop_id
      order by c.id
      offset (s.hash / 100) % 30
      limit 1
    ) as cl
    where s.hash % 10 < 6
      and not exists (
        select 1 from public.time_off o
        where o.staff_id = s.staff_id
          and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(s.starts_at, s.starts_at + interval '1 hour', '[)')
      )
  )
  insert into public.bookings (
    shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, source, price_cents
  )
  select
    v_config.shop_id, p.staff_id, p.client_id, p.service_id, p.starts_at, p.ends_at, p.blocked_until,
    case
      when p.starts_at >= v_today::timestamp at time zone v_tz then 'confirmed'
      when (p.hash / 1000) % 100 < 10 then 'no_show'
      when (p.hash / 1000) % 100 < 17 then 'cancelled'
      else 'completed'
    end,
    (array['returning', 'returning', 'instagram', 'direct', 'referral', 'google'])[1 + (p.hash / 7) % 6],
    p.price_cents
  from picked p;
end;
$$;

-- Run once by hand in the SQL editor after creating the demo auth user (see README, "Demo shop").
create function private.configure_demo_shop(p_owner_user_id uuid, p_slug text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_shop_id uuid;
begin
  if not exists (select 1 from auth.users where id = p_owner_user_id) then
    raise exception 'demo_user_not_found';
  end if;

  select shop_id into v_shop_id from private.demo_config;

  -- The nightly reset deletes the demo shop; never let it be pointed at a real owner's account.
  if exists (
    select 1 from public.shop_members m
    where m.user_id = p_owner_user_id
      and m.shop_id is distinct from v_shop_id
  ) then
    raise exception 'demo_user_has_other_shops';
  end if;

  insert into private.demo_config (singleton, shop_id, owner_user_id, slug)
  values (true, coalesce(v_shop_id, gen_random_uuid()), p_owner_user_id, p_slug)
  on conflict (singleton) do update
    set owner_user_id = excluded.owner_user_id,
        slug = excluded.slug
  returning shop_id into v_shop_id;

  perform private.reset_demo_shop();
  return v_shop_id;
end;
$$;

revoke all on all tables in schema private from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.demo_shop_guard_shops() from public, anon, authenticated;
revoke execute on function public.demo_shop_guard_members() from public, anon, authenticated;

-- Nightly at 08:00 UTC (03:00/04:00 Toronto). A no-op until configure_demo_shop has run.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('fullcut-demo-reset', '0 8 * * *', 'select private.reset_demo_shop()');
