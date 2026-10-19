-- Concurrent inserts into an exclusion constraint can deadlock (40P01) instead of failing with 23P01.
-- Serialising writes per staff member makes the loser always see the winner's committed row and get 23P01.

create function public.lock_staff_bookings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fullcut.bookings.staff:' || new.staff_id::text, 0));
  return new;
end;
$$;

create trigger bookings_lock_staff
  before insert or update of staff_id, starts_at, ends_at, blocked_until, status on public.bookings
  for each row execute function public.lock_staff_bookings();
