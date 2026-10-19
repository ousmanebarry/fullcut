# Milestone 15 — Learned durations and gap-aware slots

**Goal:** Fullcut learns how long each stylist really takes for each service and suggests booking times that keep the day tight, so the shop fits more appointments without rushing anyone.

**Depends on:** 06, 12
**Skills to read:** `fullcut-booking-engine`, `fullcut-noshow-ml` (durations)

## In scope
- Capturing actual start/finish
- Duration suggestions and owner-approved overrides
- Gap-aware slot ranking on the booking page

## Tasks

### 15.1 Capture actual times
- Migration: `bookings.actual_started_at`, `actual_finished_at`.
- Dashboard: "Start" and "Done" buttons on the current appointment (Done also marks completed). Optional, never required.

### 15.2 Duration estimates
- Per staff + service with ≥ 10 observations: median and 75th percentile actual duration, sample size, trend.
- Computed daily (job) into `duration_estimates`.

### 15.3 Suggestions and overrides
- Insights card: "Sam's Skin Fade averages 42 min; it's booked as 30. Update?" with Accept / Dismiss.
- Accept → `service_duration_overrides (staff_id, service_id, duration_minutes, accepted_by, accepted_at)`.
- `computeBookingTimes` and `generateSlots` use the override when present (the hook from 03). Existing bookings are not changed.

### 15.4 Gap-aware ranking
- `rankSlots()` after `generateSlots()`: score each slot by how well it fits (touches an existing booking edge, leaves remaining gaps either zero or ≥ the shop's shortest service).
- Booking page highlights up to 3 "best times" at the top; all valid slots still shown below.
- Shop setting: off / highlight (default) / strict (strict hides slots that create unusable gaps — warn the owner it reduces choice).

### 15.5 Measure it
- Insights: idle minutes per day between bookings (before vs after enabling), estimated extra appointments fitted per week.

## Tests
- Estimates with outliers (one 3-hour "appointment" shouldn't move the median much).
- Override changes slot length only for that staff+service.
- `rankSlots` on hand-built schedules; strict mode never hides all slots when valid ones exist.

## Acceptance criteria
- Owners can see and accept duration suggestions.
- The booking page shows best times without hiding choice by default.

## Agent prompt
```
Read .github/AGENTS.md, .github/milestones/15-durations-and-smart-slots.md
and the skills it lists. Plan the migrations, estimate job, override flow and
the rankSlots scoring function (show me the scoring formula first). Wait for
my OK, then implement with tests.
```
