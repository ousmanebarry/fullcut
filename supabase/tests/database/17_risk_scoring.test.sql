begin;
select plan(34);

select tests.seed_two_shops();

update public.shops set
  risk_actions_enabled = true, waitlist_enabled = true, max_active_bookings_per_phone = 20
where id = tests.id('shop_a');

-- Columns and checks ---------------------------------------------------------------------------

select is(
  (select confirmation_status from public.bookings where id = tests.id('booking_a')),
  'not_required', 'bookings start with no confirmation needed'
);

select throws_ok(
  $$update public.bookings set risk_tier = 'extreme' where id = tests.id('booking_a')$$,
  '23514', null, 'risk_tier is checked'
);

select throws_ok(
  $$update public.bookings set confirmation_status = 'released' where id = tests.id('booking_a')$$,
  '23514', null, 'released needs a release reason and a cancelled booking'
);

select throws_ok(
  $$update public.shops set risk_medium_threshold = 0.5, risk_high_threshold = 0.4 where id = tests.id('shop_a')$$,
  '23514', null, 'medium threshold must be below high'
);

select throws_ok(
  $$update public.shops set risk_high_require_confirmation = true, risk_high_confirm_request = false where id = tests.id('shop_a')$$,
  '23514', null, 'requiring confirmation implies asking for it'
);

-- Guard: members cannot forge scores or the confirmation timeline -------------------------------

select tests.authenticate_as(tests.id('user_a'));

select throws_ok(
  $$update public.bookings set risk_score = 0.01, risk_tier = 'low' where id = tests.id('booking_a')$$,
  '42501', 'risk_columns_read_only', 'an owner cannot write a score'
);

select throws_ok(
  $$update public.bookings set confirmation_status = 'requested' where id = tests.id('booking_a')$$,
  '42501', 'risk_columns_read_only', 'members cannot request a confirmation themselves'
);

select throws_ok(
  $$select public.apply_booking_risk(tests.id('booking_a'), '2030-01-08 15:00Z', 'low', '[]'::jsonb)$$,
  '42501', null, 'members cannot call apply_booking_risk'
);

select throws_ok(
  $$select * from public.process_confirmation_deadlines(10)$$,
  '42501', null, 'members cannot run the deadline job'
);

select tests.clear_authentication();

-- Storing a score and its plan ---------------------------------------------------------------

select tests.insert_booking(tests.id('staff_a'), now() + interval '5 days', 30, 10, 'confirmed', tests.id('risky'));

select is(
  public.apply_booking_risk(
    tests.id('risky'),
    (select starts_at from public.bookings where id = tests.id('risky')),
    'high', '["3 no-shows in last 4 visits"]'::jsonb, 0.62, 'heuristic', 'heuristic-1',
    now() + interval '3 days', now() + interval '3 days 20 hours',
    null, now() + interval '4 days'
  ),
  'requested', 'a confirmation plan marks the booking requested'
);

select results_eq(
  $$select risk_tier, risk_method, risk_model_version, risk_factors, confirmation_due_at is not null, risk_scored_at is not null
    from public.bookings where id = tests.id('risky')$$,
  $$values ('high'::text, 'heuristic'::text, 'heuristic-1'::text, '["3 no-shows in last 4 visits"]'::jsonb, true, true)$$,
  'the score, reasons and deadline are stored'
);

select results_eq(
  $$select type from public.scheduled_messages where booking_id = tests.id('risky') and status = 'queued' and type in ('confirm_request', 'final_warning') order by type$$,
  $$values ('confirm_request'::text), ('final_warning'::text)$$,
  'the confirmation request and final warning are queued'
);

select is(
  public.apply_booking_risk(tests.id('risky'), now() + interval '9 days', 'low', '[]'::jsonb, 0.05),
  null, 'a score for a booking that has since moved is ignored'
);

select is(
  public.apply_booking_risk(
    tests.id('risky'), (select starts_at from public.bookings where id = tests.id('risky')),
    'low', '[]'::jsonb, 0.05, 'heuristic', 'heuristic-1'
  ),
  'not_required', 'a lower score withdraws an unsent request'
);

select is(
  (select count(*)::int from public.scheduled_messages
   where booking_id = tests.id('risky') and status = 'queued' and type in ('confirm_request', 'final_warning')),
  0, 'and cancels its queued texts'
);

select is(
  public.apply_booking_risk(tests.id('risky'), (select starts_at from public.bookings where id = tests.id('risky')), 'unknown', '[]'::jsonb),
  'not_required', 'a failed score stores tier unknown without a score'
);

select results_eq(
  $$select risk_score, risk_tier from public.bookings where id = tests.id('risky')$$,
  $$values (null::real, 'unknown'::text)$$,
  'unknown has no score'
);

-- Moving a booking resets its pending confirmation ------------------------------------------------

select public.apply_booking_risk(
  tests.id('risky'), (select starts_at from public.bookings where id = tests.id('risky')),
  'high', '[]'::jsonb, 0.6, 'heuristic', 'heuristic-1',
  now() + interval '3 days', now() + interval '3 days 20 hours', null, now() + interval '4 days'
);

update public.bookings set
  starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day', blocked_until = blocked_until + interval '1 day'
where id = tests.id('risky');

select results_eq(
  $$select confirmation_status, confirmation_due_at from public.bookings where id = tests.id('risky')$$,
  $$values ('not_required'::text, null::timestamptz)$$,
  'rescheduling clears the pending confirmation until it is re-scored'
);

select is(
  (select count(*)::int from public.scheduled_messages
   where booking_id = tests.id('risky') and status = 'queued' and type in ('confirm_request', 'final_warning')),
  0, 'rescheduling cancels the queued confirmation texts'
);

-- Deadlines --------------------------------------------------------------------------------------

create temporary table due_ids (name text, id uuid) on commit drop;

-- Every booking below is requested with a deadline that just passed.
create or replace function pg_temp.requested(p_name text, p_start interval)
returns uuid language plpgsql as $$
declare v_id uuid := tests.id(p_name);
begin
  perform tests.insert_booking(tests.id('staff_a'), now() + p_start, 30, 10, 'confirmed', v_id);
  update public.bookings set confirmation_status = 'requested', confirmation_due_at = now() - interval '1 minute'
  where id = v_id;
  insert into due_ids values (p_name, v_id);
  return v_id;
end;
$$;

create or replace function pg_temp.warned(p_id uuid)
returns void language sql as $$
  insert into public.scheduled_messages (shop_id, booking_id, client_id, type, dedupe_key, send_at, status, sent_at)
  select shop_id, id, client_id, 'final_warning', 'final_warning@test', now() - interval '3 hours', 'sent', now() - interval '3 hours'
  from public.bookings where id = p_id;
$$;

select pg_temp.requested('flag_only', interval '2 days');
select pg_temp.warned(tests.id('flag_only'));

select results_eq(
  $$select outcome from public.process_confirmation_deadlines(10) where booking_id = tests.id('flag_only')$$,
  $$values ('flagged'::text)$$,
  'with auto-release off an unconfirmed booking is only flagged'
);

select results_eq(
  $$select status, confirmation_status from public.bookings where id = tests.id('flag_only')$$,
  $$values ('confirmed'::text, 'unconfirmed'::text)$$,
  'a flagged booking keeps its slot'
);

update public.shops set risk_auto_release = true where id = tests.id('shop_a');

select pg_temp.requested('released', interval '2 days 1 hour');
select pg_temp.warned(tests.id('released'));
select pg_temp.requested('never_warned', interval '2 days 2 hours');
select pg_temp.requested('trusted', interval '2 days 3 hours');
select pg_temp.warned(tests.id('trusted'));
update public.bookings set risk_trusted_at = now() where id = tests.id('trusted');
select pg_temp.requested('too_soon', interval '30 minutes');
select pg_temp.warned(tests.id('too_soon'));
select pg_temp.requested('said_yes', interval '2 days 4 hours');
select pg_temp.warned(tests.id('said_yes'));
update public.bookings set confirmation_status = 'confirmed' where id = tests.id('said_yes');

create temporary table outcomes on commit drop as
select * from public.process_confirmation_deadlines(50);

select results_eq(
  $$select d.name, o.outcome from outcomes o join due_ids d on d.id = o.booking_id order by d.name$$,
  $$values ('never_warned'::text, 'flagged'::text), ('released', 'released'), ('too_soon', 'flagged'), ('trusted', 'flagged')$$,
  'only a warned, untrusted, refillable booking is released; YES before the deadline is never touched'
);

select results_eq(
  $$select status, cancelled_by, confirmation_status, release_reason from public.bookings where id = tests.id('released')$$,
  $$values ('cancelled'::text, 'shop'::text, 'released'::text, 'unconfirmed'::text)$$,
  'a release is an ordinary cancel by the shop'
);

select is(
  (select count(*)::int from public.freed_slots where freed_booking_id = tests.id('released')),
  1, 'a release queues the slot for the waitlist refill'
);

select results_eq(
  $$select type, status from public.scheduled_messages where booking_id = tests.id('released') and type in ('released', 'cancelled')$$,
  $$values ('released'::text, 'queued'::text)$$,
  'the client gets a release notice, not a plain cancellation'
);

select is(
  (select confirmation_status from public.bookings where id = tests.id('said_yes')),
  'confirmed', 'a client who confirmed stays confirmed'
);

select is(
  (select count(*)::int from public.process_confirmation_deadlines(50)),
  0, 'deadlines are processed once'
);

-- Members may record a confirmation; the owner may trust a client -----------------------------

select tests.authenticate_as(tests.id('user_a_staff'));

select is(
  tests.affected($$update public.bookings set confirmation_status = 'confirmed' where id = tests.id('flag_only')$$),
  1, 'staff can mark an unconfirmed booking confirmed (the client phoned)'
);

select throws_ok(
  $$select public.set_booking_trust(tests.id('never_warned'), true)$$,
  '42501', 'trust_forbidden', 'only the owner can trust a client'
);

select tests.authenticate_as(tests.id('user_b'));

select throws_ok(
  $$select public.set_booking_trust(tests.id('never_warned'), true)$$,
  'P0002', 'booking_not_found', 'other shops cannot see the booking'
);

select tests.authenticate_as(tests.id('user_a'));
select public.set_booking_trust(tests.id('never_warned'), true);

select results_eq(
  $$select confirmation_status, risk_trusted_at is not null, risk_trusted_by from public.bookings where id = tests.id('never_warned')$$,
  $$values ('not_required'::text, true, tests.id('user_a'))$$,
  'trusting a client clears the flag and records who did it'
);

select public.set_booking_trust(tests.id('never_warned'), false);
select is(
  (select risk_trusted_at from public.bookings where id = tests.id('never_warned')),
  null, 'trust can be removed'
);

select tests.clear_authentication();

-- Scoring queue ----------------------------------------------------------------------------------

select ok(
  exists (select 1 from public.bookings_due_for_scoring(1000) where booking_id = tests.id('booking_a')),
  'never-scored upcoming bookings are due for scoring'
);

select public.apply_booking_risk(
  tests.id('too_soon'), (select starts_at from public.bookings where id = tests.id('too_soon')), 'low', '[]'::jsonb, 0.05
);
select ok(
  not exists (select 1 from public.bookings_due_for_scoring(1000) where booking_id = tests.id('too_soon')),
  'a booking scored inside its final 48 hours is not scored again'
);

select * from finish();
rollback;
