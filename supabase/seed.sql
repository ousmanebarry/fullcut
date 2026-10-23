-- Local development seed. Fake data only; passwords below are for the local stack and must never be used elsewhere.
-- Bookings are generated relative to current_date so the calendar always has recent history and upcoming work.

-- Shops ----------------------------------------------------------------------

insert into public.shops (id, name, slug, timezone, currency) values
  ('10000000-0000-4000-8000-000000000001', 'Demo Barbers', 'demo-barbers', 'America/Toronto', 'CAD'),
  ('10000000-0000-4000-8000-000000000002', 'Other Shop',   'other-shop',   'America/Toronto', 'CAD');

update public.shops
set about_text = 'Classic cuts, skin fades and beard work. Walk-ins welcome when the chairs are free.',
    address = '123 Example Street, Toronto, ON'
where id = '10000000-0000-4000-8000-000000000001';

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

-- Waitlist ---------------------------------------------------------------------
-- Eight entries for Demo Barbers (six waiting, one booked, one expired) plus three freed slots with
-- offers in every state, so the Waitlist tab shows both lists. Seed clients 1-30 belong to Demo Barbers.

update public.shops set waitlist_enabled = true where id = '10000000-0000-4000-8000-000000000001';

insert into public.waitlist_entries (
  id, shop_id, client_id, service_id, staff_id, earliest_date, latest_date, time_windows, status, request_method, created_at
)
select
  md5('seed-waitlist-' || e.n)::uuid,
  '10000000-0000-4000-8000-000000000001',
  md5('seed-client-' || e.client_n)::uuid,
  ('40000000-0000-4000-8000-00000000000' || e.service_n)::uuid,
  e.staff_id::uuid,
  current_date + e.from_day,
  current_date + e.to_day,
  e.windows::jsonb,
  e.status,
  e.method,
  now() - e.age
from (values
  (1,  3, 1, null,                                   1, 14, '[]',                                                                          'active',  'booking_page', interval '96 hours'),
  (2,  7, 3, null,                                   1, 10, '[{"weekday":6,"start":"09:00","end":"13:00"}]',                                'active',  'booking_page', interval '20 hours'),
  (3, 11, 4, '30000000-0000-4000-8000-000000000001', 2, 21, '[{"weekday":3,"start":"15:00","end":"18:00"},{"weekday":4,"start":"15:00","end":"18:00"}]', 'active', 'staff', interval '6 hours'),
  (4, 14, 2, null,                                   1,  7, '[]',                                                                          'active',  'booking_page', interval '90 minutes'),
  (5, 19, 5, '30000000-0000-4000-8000-000000000002', 3, 14, '[{"weekday":6,"start":"10:00","end":"14:00"}]',                                'active',  'booking_page', interval '72 hours'),
  (6, 22, 1, null,                                  -1,  9, '[]',                                                                          'booked',  'booking_page', interval '120 hours'),
  (7, 25, 2, null,                                 -12, -2, '[]',                                                                          'expired', 'booking_page', interval '14 days'),
  (8, 28, 2, null,                                   1, 10, '[]',                                                                          'active',  'booking_page', interval '150 hours')
) as e (n, client_n, service_n, staff_id, from_day, to_day, windows, status, method, age);

insert into public.freed_slots (id, shop_id, staff_id, starts_at, ends_at, status, wave, next_run_at, created_at)
values
  (md5('seed-freed-1')::uuid, '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
    (current_date - 1 + time '14:00') at time zone 'America/Toronto',
    (current_date - 1 + time '14:30') at time zone 'America/Toronto', 'filled', 1, now() - interval '2 days', now() - interval '2 days'),
  (md5('seed-freed-2')::uuid, '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
    (current_date + 1 + time '11:00') at time zone 'America/Toronto',
    (current_date + 1 + time '11:20') at time zone 'America/Toronto', 'offering', 1, now() + interval '2 hours', now() - interval '15 minutes'),
  (md5('seed-freed-3')::uuid, '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003',
    (current_date - 3 + time '16:00') at time zone 'America/Toronto',
    (current_date - 3 + time '16:45') at time zone 'America/Toronto', 'exhausted', 2, now() - interval '4 days', now() - interval '4 days 6 hours');

-- token_hash stays null: seeded offers cannot be claimed from a link.
insert into public.slot_offers (
  id, shop_id, waitlist_entry_id, freed_slot_id, staff_id, service_id, starts_at, ends_at, blocked_until, wave, status, sent_at, expires_at
)
select
  md5('seed-offer-' || o.n)::uuid,
  '10000000-0000-4000-8000-000000000001',
  md5('seed-waitlist-' || o.entry_n)::uuid,
  f.id,
  f.staff_id,
  ('40000000-0000-4000-8000-00000000000' || o.service_n)::uuid,
  f.starts_at,
  f.ends_at,
  f.ends_at + make_interval(mins => o.buffer_min),
  o.wave,
  o.status,
  o.sent_at,
  o.sent_at + interval '30 minutes'
from (values
  (1, 6, 1, 'seed-freed-1', 5,  1, 'claimed', now() - interval '2 days'),
  (2, 1, 1, 'seed-freed-1', 5,  1, 'taken',   now() - interval '2 days'),
  (3, 2, 3, 'seed-freed-2', 5,  1, 'sent',    now() - interval '15 minutes'),
  (4, 8, 2, 'seed-freed-3', 10, 1, 'expired', now() - interval '4 days 6 hours'),
  (5, 7, 2, 'seed-freed-3', 10, 2, 'expired', now() - interval '4 days 5 hours')
) as o (n, entry_n, service_n, slot, buffer_min, wave, status, sent_at)
join public.freed_slots f on f.id = md5(o.slot)::uuid;

-- Inbox -------------------------------------------------------------------------
-- Replies that need a person (kind 'other', unhandled), plus a few already handled and automatic YES replies.

insert into public.inbound_messages (
  id, shop_id, client_id, twilio_sid, from_phone, body, kind, handled_at, handled_by, created_at
)
select
  md5('seed-inbound-' || m.n)::uuid,
  '10000000-0000-4000-8000-000000000001',
  case when m.client_n is not null then md5('seed-client-' || m.client_n)::uuid end,
  'SMseed' || lpad(m.n::text, 4, '0'),
  coalesce('+1555' || lpad(m.client_n::text, 7, '0'), m.phone),
  m.body,
  m.kind,
  case when m.handled then now() - m.age + interval '1 hour' end,
  case when m.handled then '20000000-0000-4000-8000-000000000001'::uuid end,
  now() - m.age
from (values
  (1,   5, null,           'Hey, can I move my appointment to later in the day? Running about 20 min behind.', 'other',   false, interval '25 minutes'),
  (2,   9, null,           'Do you have anything open Saturday morning for a skin fade?',                      'other',   false, interval '3 hours'),
  (3,   2, null,           'I''m running 10 min late, sorry!!',                                                  'other',   false, interval '5 hours'),
  (4,  16, null,           'Thanks! Also, do you take Apple Pay?',                                              'other',   false, interval '1 day'),
  (5, null, '+14165550199', 'Is this the barbershop on Example St? I got a text about a booking.',               'other',   false, interval '2 days'),
  (6,  12, null,           'Can you add my brother to the same time? He needs a kids cut.',                    'other',   true,  interval '3 days'),
  (7,  20, null,           'Perfect, see you then.',                                                           'other',   true,  interval '4 days'),
  (8,  10, null,           'YES',                                                                              'confirm', true,  interval '6 hours'),
  (9,  13, null,           'yes',                                                                              'confirm', true,  interval '1 day')
) as m (n, client_n, phone, body, kind, handled, age);
