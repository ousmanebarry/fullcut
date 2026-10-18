---
name: fullcut-booking-engine
description: Use when working on Fullcut's scheduling logic — generating available slots, staff hours and time off, buffers, creating, holding, rescheduling or cancelling bookings, booking statuses, double-booking handling, or timezone and DST behaviour.
---

# Fullcut: booking engine

The booking engine answers two questions: **which times can this client book?** and **can this exact booking be created right now?** Correctness beats cleverness here; a wrong slot is a real person standing in a shop with nobody to cut their hair.

Domain code lives in `apps/web/lib/booking/` as pure functions with no database or network calls, so it can be unit tested exhaustively. Route handlers fetch data, call these functions, and write results.

## Slot generation

Inputs: shop timezone, the service (duration, buffer), the staff member(s), a date range, availability rules, time off, and existing active bookings (`pending` + `confirmed`).

Algorithm per staff member per local date:

1. Take that weekday's availability rules (local wall-clock times like 09:00–17:00).
2. Convert each window to UTC instants **for that specific date** using the shop's IANA timezone and a timezone library. Never apply a fixed offset; offsets change with DST.
3. Subtract time off and existing bookings' blocked ranges (`starts_at` → `blocked_until`).
4. Walk each remaining free interval in steps of the slot granularity (default 15 minutes). A start time is valid if `start + duration + buffer` fits inside the free interval.
5. Apply shop rules: minimum lead time (e.g. no bookings starting in the next 2 hours) and maximum horizon (e.g. 60 days ahead).
6. Return slots as UTC instants plus their shop-local display string.

When the client picks "any staff", merge slots across staff and remember which staff each slot belongs to; pick deterministically (e.g. least-booked that day) when several are free.

Return only what the client needs: start times. Never return other bookings or client data to the public page.

### Gap-aware ranking (later feature)

After generating valid slots, a ranking step can order them to reduce dead time, e.g. prefer starts that touch an existing booking edge or leave a remaining gap long enough for the shop's shortest service. Ranking reorders or highlights slots; it never hides a valid slot unless the owner turns on a stricter mode.

## Creating a booking

Always on the server, in this order:

1. Validate input with zod (service id, staff id, start instant, client name/phone).
2. Load the service and shop **by the shop slug from the URL**, server-side. Never trust a `shop_id` sent by the browser on public routes.
3. Recompute `ends_at = starts_at + duration` and `blocked_until = ends_at + buffer` on the server. Never trust times computed by the client.
4. Re-check the slot is still valid (within hours, not in time off, respects lead time). This is for a friendly error; it is not the double-booking guarantee.
5. Find or create the client by `(shop_id, phone_e164)`.
6. Insert the booking. If Postgres raises SQLSTATE `23P01` (exclusion violation on `bookings_no_overlap`), return HTTP 409 with a "That time was just taken — here are the nearest open times" message and fresh slots.
7. After insert, request a risk score from the ML service with a short timeout (≈300 ms). On timeout or error, store `risk_score = null` and continue with default handling. Scoring must never fail the booking.

## Statuses

```
pending ──(deposit paid)──────────► confirmed ──(appointment done)──► completed
   │                                    │
   └─(hold expired / abandoned)─► cancelled ◄──(client or shop cancels)
                                        │
                                        └──(client didn't show)──► no_show
```

- `pending`: a deposit is required and checkout is in progress. Has `pending_expires_at` (e.g. 15 minutes). It blocks the slot so nobody else takes it mid-payment.
- `confirmed`: no deposit required, or deposit paid.
- `completed` / `no_show`: set by staff after the appointment time. These labels are the training data for the no-show model, so the dashboard should make marking them one tap and remind staff of unmarked past bookings.
- Expired holds: a scheduled job sets `status = 'cancelled'` on `pending` bookings past `pending_expires_at`. Additionally, before inserting a new booking, cancel any expired `pending` bookings for that staff member in the same transaction so a stale hold never blocks a real client.
- Only allowed transitions are permitted; enforce them in one function (`transitionBooking(booking, event)`), not scattered across handlers.

## Rescheduling and cancelling

- Reschedule = update `starts_at`, `ends_at`, `blocked_until` in a single statement; the exclusion constraint protects it the same way as an insert. Handle `23P01` the same way.
- Cancellations by clients go through a signed, single-use link sent in the confirmation message; no account needed.
- Shop cancellation policy (e.g. deposit kept if cancelled within 24 h) is applied by `fullcut-payments-and-messaging` logic; the booking engine only reports when the cancellation happened relative to the appointment.

## Learned durations (later feature)

Each completed booking can record actual start and finish (from staff tapping "start"/"done"). The ML side estimates a per-staff, per-service duration. The booking engine accepts an optional `durationOverride` per staff+service; the owner must approve an override before it changes slot lengths.

## Tests that must exist

- A normal weekday: correct slots, buffer respected, last slot ends exactly at closing.
- **DST spring-forward and fall-back days** in `America/Toronto` (and one other zone): no missing or duplicated slots, wall-clock hours preserved.
- Time off in the middle of a day splits availability correctly.
- Lead time and horizon limits.
- Service longer than any free gap returns no slots.
- Half-open ranges: back-to-back bookings (10:00–10:30 and 10:30–11:00) are both allowed.
- **Concurrency:** two simultaneous insert attempts for the same staff and time against a real local database; exactly one succeeds, the other gets 409.
- Expired `pending` hold no longer blocks a new booking.
- Invalid status transitions are rejected.
