# Milestone 03 — Booking engine (pure logic)

**Goal:** the scheduling brain as pure, fully tested TypeScript functions: which times are bookable, how a booking's times are computed, and which status changes are allowed. No database, no UI.

**Depends on:** 02
**Skills to read:** `fullcut-booking-engine`

## In scope
- `apps/web/lib/booking/` modules and unit tests
- Timezone library choice (ADR)

## Out of scope
- Database queries, API routes, UI
- Gap-aware ranking and learned durations (milestone 15) — but leave a clean hook for both

## Tasks

### 3.1 Decide the time library
- Choose Luxon or `date-fns` + `date-fns-tz` (or Temporal if available in your Node version). Write a short ADR. All timezone math goes through one small wrapper module (`lib/time/`) so the library can be swapped.

### 3.2 Domain types (`lib/booking/types.ts`)
- `ShopSchedulingSettings`: `timezone`, `slotStepMinutes` (default 15), `minLeadMinutes` (default 120), `maxHorizonDays` (default 60).
- `AvailabilityRule`, `TimeOff`, `ExistingBooking` (`startsAt`, `blockedUntil`, `staffId`), `Service` (`durationMinutes`, `bufferMinutes`), `Slot` (`startsAt` UTC, `staffId`, `localLabel`).
- Use branded types or clear names to separate UTC instants from local wall-clock times.

### 3.3 Booking time computation (`computeBookingTimes`)
- Input: start instant, service (and an optional `durationOverrideMinutes`).
- Output: `startsAt`, `endsAt`, `blockedUntil`. Used by both slot generation and booking creation so they never disagree.

### 3.4 Slot generation (`generateSlots`)
Inputs: settings, service, staff list, rules, time off, existing active bookings, date range, `now`.
1. For each staff and each local date in range, build working windows from that weekday's rules, converted to UTC for that exact date.
2. Subtract time off and existing bookings' `[startsAt, blockedUntil)` ranges.
3. Step through free intervals by `slotStepMinutes`, aligned to the step in local time (e.g. :00, :15, :30, :45).
4. Keep a start only if `[start, blockedUntil)` fits inside the free interval.
5. Drop starts earlier than `now + minLeadMinutes` and later than `now + maxHorizonDays`.
6. "Any staff" mode: merge across staff, one slot per start time, choose the staff deterministically (fewest bookings that day, then stable order).
7. Return slots sorted by time, each with a local display label.
- `now` is always passed in (never read the clock inside), so tests are deterministic.
- Design the output so a later `rankSlots()` step (milestone 15) can reorder without changing generation.

### 3.5 Interval helpers (`lib/booking/intervals.ts`)
- Merge, subtract and intersect half-open intervals. These carry the logic; test them on their own.

### 3.6 Status machine (`transitionBooking`)
- States: `pending`, `confirmed`, `completed`, `cancelled`, `no_show`.
- Events: `depositPaid`, `holdExpired`, `cancel`, `markCompleted`, `markNoShow`, `confirmWithoutDeposit`.
- Return the new state or a typed error for invalid transitions. `completed`/`no_show` only allowed after the appointment's start time (pass `now`).

### 3.7 Validation helper (`validateRequestedStart`)
- Given everything `generateSlots` needs plus a requested start and staff, return `ok` or a specific reason (`outside_hours`, `time_off`, `conflict`, `too_soon`, `too_far`, `misaligned`). Used by the API for friendly errors before the DB constraint is the final judge.

## Tests (Vitest)
- Normal weekday: first and last slots exact; buffer respected; last slot's service ends by closing time.
- Interval helpers: overlap, touch (back-to-back), containment, empty results.
- Time off splitting a day; booking at the very start/end of a window.
- Lead time and horizon cut-offs.
- Service longer than any gap → no slots.
- "Any staff" merge and deterministic staff choice.
- **DST in `America/Toronto`:** spring forward Sunday 2026-03-08 and fall back Sunday 2026-11-01. Use a test rule like 00:00–04:00 on those Sundays to cross 02:00: no duplicated or impossible local times, correct UTC offsets before and after. Also a normal 09:00–17:00 day just before and after each change to confirm the offset shift (UTC-5 ↔ UTC-4).
- A second timezone (e.g. `America/Vancouver`) for one case.
- Status machine: every valid transition and a sample of invalid ones.
- Property-style test (optional, fast-check): generated slots never overlap existing bookings.

## Acceptance criteria
- All functions are pure (no DB, no `Date.now()` inside).
- Tests pass and cover the cases above.
- ADR for the time library.

## Agent prompt
```
Read .github/AGENTS.md and .github/milestones/03-booking-engine.md, then the
fullcut-booking-engine skill. Propose the module structure and function
signatures first and wait for my OK. Then implement test-first, run the tests,
and report coverage of the cases listed in the spec.
```
