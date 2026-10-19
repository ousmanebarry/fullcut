-- Local development seed. Fake data only; passwords below are for the local stack and must never be used elsewhere.
-- Bookings are generated relative to current_date so the calendar always has recent history and upcoming work.

-- Shops ----------------------------------------------------------------------

insert into public.shops (id, name, slug, timezone, currency) values
  ('10000000-0000-4000-8000-000000000001', 'Demo Barbers', 'demo-barbers', 'America/Toronto', 'CAD'),
  ('10000000-0000-4000-8000-000000000002', 'Other Shop',   'other-shop',   'America/Toronto', 'CAD');

-- Logins: two owners and one staff-role member (local only) ------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt(u.password, extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}', jsonb_build_object('name', u.name), now(), now(),
  '', '', '', ''
from (values
  ('20000000-0000-4000-8000-000000000001'::uuid, 'owner@demo-barbers.example.com', 'demo-owner-password',  'Demo Owner'),
  ('20000000-0000-4000-8000-000000000002'::uuid, 'owner@other-shop.example.com',   'other-owner-password', 'Other Owner'),
  ('20000000-0000-4000-8000-000000000003'::uuid, 'staff@demo-barbers.example.com', 'demo-staff-password',  'Jordan Demo')
) as u (id, email, password, name);

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
from auth.users u
where u.id in (
  '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003'
);

-- Staff and memberships ------------------------------------------------------

insert into public.staff (id, shop_id, display_name) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Alex Demo'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Jordan Demo'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Taylor Demo'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'Casey Other');

insert into public.shop_members (shop_id, user_id, role, staff_id) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'owner', '30000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'owner', '30000000-0000-4000-8000-000000000004'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'staff', '30000000-0000-4000-8000-000000000002');

-- Services (duration + buffer <= 60 min so the hourly booking grid below never overlaps) --

insert into public.services (id, shop_id, name, duration_minutes, buffer_minutes, price_cents) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Haircut',         30,  5, 3500),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Skin fade',       45, 10, 4500),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Beard trim',      20,  5, 2000),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Cut and beard',   50, 10, 5500),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'Kids cut',        25,  5, 2500),
  ('40000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000002', 'Classic cut',     30,  5, 3000),
  ('40000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000002', 'Buzz cut',        20,  5, 2000),
  ('40000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000002', 'Beard shape-up',  20,  0, 1800),
  ('40000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000002', 'Hot towel shave', 40, 10, 4000);

-- Weekly availability (0 = Sunday), staggered per staff ----------------------

insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
select s.shop_id, s.staff_id, wd, s.start_time, s.end_time
from (values
  ('10000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 2, 6, time '09:00', time '17:00'),
  ('10000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000002'::uuid, 2, 6, time '10:00', time '18:00'),
  ('10000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000003'::uuid, 3, 6, time '09:00', time '18:00'),
  ('10000000-0000-4000-8000-000000000002'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, 2, 6, time '09:00', time '18:00')
) as s (shop_id, staff_id, first_day, last_day, start_time, end_time)
cross join generate_series(s.first_day, s.last_day) as wd;

-- Time off (bookings below skip these ranges) --------------------------------

insert into public.time_off (shop_id, staff_id, starts_at, ends_at, reason) values
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
    (current_date - 20 + time '13:00') at time zone 'America/Toronto',
    (current_date - 20 + time '17:00') at time zone 'America/Toronto', 'Appointment'),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
    (current_date + 5)::timestamp at time zone 'America/Toronto',
    (current_date + 7)::timestamp at time zone 'America/Toronto', 'Vacation');

-- Clients --------------------------------------------------------------------

insert into public.clients (id, shop_id, name, phone_e164, email, marketing_opt_in, marketing_opt_in_at, marketing_opt_in_method, first_source)
select
  md5('seed-client-' || n)::uuid,
  case when n <= 30 then '10000000-0000-4000-8000-000000000001'::uuid else '10000000-0000-4000-8000-000000000002'::uuid end,
  first_names[1 + (n - 1) % 12] || ' ' || last_names[1 + (n - 1) % 5],
  '+1555' || lpad(n::text, 7, '0'),
  case when n % 4 <> 0 then lower(first_names[1 + (n - 1) % 12] || '.' || last_names[1 + (n - 1) % 5] || n || '@example.com') end,
  n % 3 = 0,
  case when n % 3 = 0 then now() - interval '90 days' end,
  case when n % 3 = 0 then 'booking_form_checkbox' end,
  (array['returning', 'instagram', 'referral', 'google', 'walk_in'])[1 + n % 5]
from generate_series(1, 36) as n,
  lateral (select
    array['Avery', 'Blake', 'Charlie', 'Devon', 'Emerson', 'Finley', 'Harper', 'Indigo', 'Jules', 'Kai', 'Logan', 'Morgan'] as first_names,
    array['Example', 'Sample', 'Testerson', 'Placeholder', 'Fakename'] as last_names
  ) as names;

-- Bookings: hourly grid inside availability, ~60% filled, from 60 days ago to 14 days ahead --

with slots as (
  select
    r.shop_id,
    r.staff_id,
    ((d::date + r.start_time) + make_interval(hours => h)) at time zone sh.timezone as starts_at,
    abs(hashtext(r.staff_id::text || d::date::text || h::text)::bigint) as hash
  from public.availability_rules r
  join public.shops sh on sh.id = r.shop_id
  cross join generate_series(current_date - 60, current_date + 14, interval '1 day') as d
  cross join lateral generate_series(0, extract(hour from r.end_time - r.start_time)::int - 1) as h
  where extract(dow from d) = r.weekday
),
picked as (
  select
    s.*,
    svc.id as service_id,
    svc.price_cents,
    s.starts_at + make_interval(mins => svc.duration_minutes) as ends_at,
    s.starts_at + make_interval(mins => svc.duration_minutes + svc.buffer_minutes) as blocked_until,
    cl.id as client_id
  from slots s
  cross join lateral (
    select v.id, v.duration_minutes, v.buffer_minutes, v.price_cents
    from public.services v
    where v.shop_id = s.shop_id
    order by v.id
    offset (s.hash / 10) % (select count(*) from public.services where shop_id = s.shop_id)
    limit 1
  ) as svc
  cross join lateral (
    select c.id
    from public.clients c
    where c.shop_id = s.shop_id
    order by c.id
    offset (s.hash / 100) % (select count(*) from public.clients where shop_id = s.shop_id)
    limit 1
  ) as cl
  where s.hash % 10 < 6
    and not exists (
      select 1 from public.time_off o
      where o.staff_id = s.staff_id
        and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(s.starts_at, s.starts_at + interval '1 hour', '[)')
    )
)
insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, source, price_cents)
select
  shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until,
  case
    when starts_at >= now() then 'confirmed'
    when (hash / 1000) % 100 < 10 then 'no_show'
    when (hash / 1000) % 100 < 17 then 'cancelled'
    else 'completed'
  end,
  (array['returning', 'returning', 'instagram', 'direct', 'referral', 'google'])[1 + (hash / 7) % 6],
  price_cents
from picked;
