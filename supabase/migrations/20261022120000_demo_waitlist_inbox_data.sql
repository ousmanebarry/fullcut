-- Demo data for the Waitlist and Inbox tabs: entries and slot offers in every state, plus inbound texts.
-- Synthetic, and rebuilt by every nightly reset like the rest of the demo shop.

alter function private.reset_demo_shop() rename to reset_demo_shop_risk;

create function private.reset_demo_shop()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_config  private.demo_config;
  v_today   date;
  v_staff   uuid[];
begin
  perform private.reset_demo_shop_risk();

  select * into v_config from private.demo_config;
  if not found then
    return;
  end if;

  v_today := (now() at time zone 'America/Toronto')::date;
  v_staff := array(
    select md5(v_config.shop_id::text || ':staff:' || n)::uuid from generate_series(1, 3) as n
  );

  -- The reset already added waiting entries for clients 3, 7 and 11; these add the other states.
  insert into public.waitlist_entries (
    shop_id, client_id, service_id, staff_id, earliest_date, latest_date, time_windows, status, request_method, created_at
  )
  select
    v_config.shop_id,
    md5(v_config.shop_id::text || ':client:' || e.client_n)::uuid,
    (select s.id from public.services s where s.shop_id = v_config.shop_id and s.sort_order = e.service_sort),
    null,
    v_today + e.from_day,
    v_today + e.to_day,
    e.windows::jsonb,
    e.status,
    'booking_page',
    now() - e.age
  from (values
    (19, 4,   1, 14, '[]',                                                       'active',  interval '72 hours'),
    (22, 0,  -1,  9, '[]',                                                       'booked',  interval '120 hours'),
    (25, 1, -12, -2, '[]',                                                       'expired', interval '14 days'),
    (28, 1,   1, 10, '[{"weekday":6,"start":"10:00","end":"14:00"}]',            'active',  interval '150 hours')
  ) as e (client_n, service_sort, from_day, to_day, windows, status, age);

  -- Freed slots: one refilled yesterday, one being offered now, one nobody took.
  -- The open slot and its offer stay live until the next reset, so the jobs tick does not close them mid-demo.
  insert into public.freed_slots (id, shop_id, staff_id, starts_at, ends_at, status, wave, next_run_at, created_at)
  values
    (md5(v_config.shop_id::text || ':freed:1')::uuid, v_config.shop_id, v_staff[1],
      (v_today - 1 + time '14:00') at time zone 'America/Toronto',
      (v_today - 1 + time '14:30') at time zone 'America/Toronto',
      'filled', 1, now() - interval '2 days', now() - interval '2 days'),
    (md5(v_config.shop_id::text || ':freed:2')::uuid, v_config.shop_id, v_staff[2],
      (v_today + 1 + time '11:00') at time zone 'America/Toronto',
      (v_today + 1 + time '11:30') at time zone 'America/Toronto',
      'offering', 1, now() + interval '20 hours', now() - interval '15 minutes'),
    (md5(v_config.shop_id::text || ':freed:3')::uuid, v_config.shop_id, v_staff[3],
      (v_today - 3 + time '16:00') at time zone 'America/Toronto',
      (v_today - 3 + time '16:45') at time zone 'America/Toronto',
      'exhausted', 2, now() - interval '4 days', now() - interval '4 days 6 hours');

  -- token_hash stays null: demo offers cannot be claimed from a link, and no text is sent.
  insert into public.slot_offers (
    shop_id, waitlist_entry_id, freed_slot_id, staff_id, service_id, starts_at, ends_at, blocked_until,
    wave, status, sent_at, expires_at
  )
  select
    v_config.shop_id,
    e.id,
    f.id,
    f.staff_id,
    e.service_id,
    f.starts_at,
    f.ends_at,
    f.ends_at + make_interval(mins => o.buffer_min),
    o.wave,
    o.status,
    o.sent_at,
    o.sent_at + o.lifetime
  from (values
    (22, 1, 5,  1, 'claimed', now() - interval '2 days',                interval '30 minutes'),
    (19, 1, 5,  1, 'taken',   now() - interval '2 days',                interval '30 minutes'),
    (7,  2, 5,  1, 'sent',    now() - interval '15 minutes',            interval '20 hours'),
    (28, 3, 10, 1, 'expired', now() - interval '4 days 6 hours',        interval '30 minutes'),
    (25, 3, 10, 2, 'expired', now() - interval '4 days 5 hours',        interval '30 minutes')
  ) as o (client_n, slot_n, buffer_min, wave, status, sent_at, lifetime)
  join public.freed_slots f on f.id = md5(v_config.shop_id::text || ':freed:' || o.slot_n)::uuid
  join public.waitlist_entries e
    on e.shop_id = v_config.shop_id
   and e.client_id = md5(v_config.shop_id::text || ':client:' || o.client_n)::uuid;

  -- Replies that need a person (kind 'other', unhandled), a few already handled, and automatic YES replies.
  insert into public.inbound_messages (
    shop_id, client_id, twilio_sid, from_phone, body, kind, handled_at, handled_by, created_at
  )
  select
    v_config.shop_id,
    c.id,
    'SMdemo' || lpad(m.n::text, 4, '0'),
    coalesce(c.phone_e164, m.phone),
    m.body,
    m.kind,
    case when m.handled then now() - m.age + interval '1 hour' end,
    case when m.handled then v_config.owner_user_id end,
    now() - m.age
  from (values
    (1,  5,    null,            'Hey, can I move my appointment to later in the day? Running about 20 min behind.', 'other',   false, interval '25 minutes'),
    (2,  9,    null,            'Do you have anything open Saturday morning for a skin fade?',                      'other',   false, interval '3 hours'),
    (3,  2,    null,            'I''m running 10 min late, sorry!!',                                                 'other',   false, interval '5 hours'),
    (4,  16,   null,            'Thanks! Also, do you take Apple Pay?',                                             'other',   false, interval '1 day'),
    (5,  null, '+14165550199',  'Is this the barbershop on Example St? I got a text about a booking.',              'other',   false, interval '2 days'),
    (6,  12,   null,            'Can you add my brother to the same time? He needs a kids cut.',                    'other',   true,  interval '3 days'),
    (7,  20,   null,            'Perfect, see you then.',                                                           'other',   true,  interval '4 days'),
    (8,  10,   null,            'YES',                                                                              'confirm', true,  interval '6 hours'),
    (9,  13,   null,            'yes',                                                                              'confirm', true,  interval '1 day')
  ) as m (n, client_n, phone, body, kind, handled, age)
  left join public.clients c
    on c.shop_id = v_config.shop_id
   and c.id = md5(v_config.shop_id::text || ':client:' || m.client_n)::uuid;
end;
$$;

revoke execute on function private.reset_demo_shop() from public, anon, authenticated;
revoke execute on function private.reset_demo_shop_risk() from public, anon, authenticated;
