begin;
select plan(13);

select tests.seed_two_shops();

-- Base booking: 15:00-15:30 plus a 10 minute buffer, so the staff member is blocked until 15:40.
select tests.insert_booking(tests.id('staff_a'), '2030-03-05 15:00Z', 30, 10, 'confirmed', tests.id('base'));

select throws_ok(
  $$select tests.insert_booking(tests.id('staff_a'), '2030-03-05 15:15Z', 30, 10, 'confirmed')$$,
  '23P01',
  'conflicting key value violates exclusion constraint "bookings_no_overlap"',
  'overlapping confirmed booking is rejected'
);
select throws_ok(
  $$select tests.insert_booking(tests.id('staff_a'), '2030-03-05 15:35Z', 30, 10, 'confirmed')$$,
  '23P01',
  null,
  'booking that overlaps only the buffer is rejected'
);
select throws_ok(
  $$select tests.insert_booking(tests.id('staff_a'), '2030-03-05 14:45Z', 30, 0, 'pending')$$,
  '23P01',
  null,
  'pending hold overlapping a confirmed booking is rejected'
);
select lives_ok(
  $$select tests.insert_booking(tests.id('staff_a'), '2030-03-05 15:40Z', 30, 10, 'confirmed', tests.id('back_to_back'))$$,
  'back-to-back booking starting when the buffer ends is allowed'
);
select lives_ok(
  $$select tests.insert_booking(tests.id('staff_a'), '2030-03-05 14:30Z', 30, 0, 'confirmed')$$,
  'back-to-back booking ending when the base starts is allowed'
);
select lives_ok(
  $$select tests.insert_booking(tests.id('staff_a'), '2030-03-05 15:00Z', 30, 10, 'cancelled', tests.id('cancelled'))$$,
  'overlapping cancelled booking is allowed'
);
select lives_ok(
  $$select tests.insert_booking(tests.id('staff_a'), '2030-03-05 15:00Z', 30, 10, 'completed')$$,
  'overlapping completed booking is allowed'
);
select lives_ok(
  $$select tests.insert_booking(tests.id('staff_a'), '2030-03-05 15:00Z', 30, 10, 'no_show')$$,
  'overlapping no-show booking is allowed'
);
select lives_ok(
  $$select tests.insert_booking(tests.id('staff_a2'), '2030-03-05 15:00Z', 30, 10, 'confirmed')$$,
  'same time for a different staff member is allowed'
);
select throws_ok(
  $$update public.bookings set status = 'confirmed' where id = tests.id('cancelled')$$,
  '23P01',
  null,
  'reactivating a cancelled booking into an overlap is rejected'
);
select throws_ok(
  $$update public.bookings
       set starts_at = '2030-03-05 15:20Z', ends_at = '2030-03-05 15:50Z', blocked_until = '2030-03-05 16:00Z'
     where id = tests.id('back_to_back')$$,
  '23P01',
  null,
  'rescheduling into an overlap is rejected'
);

-- An expired hold stops blocking as soon as its status changes.
update public.bookings set status = 'pending', pending_expires_at = '2030-03-05 12:00Z' where id = tests.id('base');
select is(
  tests.affected($$update public.bookings set status = 'cancelled' where id = tests.id('base')$$),
  1,
  'expired hold can be cancelled'
);
select lives_ok(
  $$select tests.insert_booking(tests.id('staff_a'), '2030-03-05 15:00Z', 30, 10, 'confirmed')$$,
  'slot is bookable once the hold is cancelled'
);

select * from finish();
rollback;
