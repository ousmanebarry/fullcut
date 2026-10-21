# Milestone 06 — Dashboard: calendar and booking management

**Goal:** owners and staff run their day from the dashboard: see the calendar, add phone and walk-in bookings, reschedule, cancel, and mark appointments completed or no-show. Marking outcomes is what feeds the ML later, so it must be fast.

**Depends on:** 04, 05
**Skills to read:** `fullcut-booking-engine`

## In scope

- Day and week calendar, booking drawer, manual bookings, status actions
- "Today" home screen, unmarked-bookings prompt
- Live updates

## Out of scope

- Client profiles (07), waitlist (10), risk badges (12)

## Tasks

### 6.1 Today screen (`/dashboard`)

- Next appointments for the signed-in staff (or all staff for owners), with client name, service, time, and quick actions.
- Banner: "N past appointments need an outcome" → opens a quick-marking list.
- Small stats: bookings today, open slots left today.

### 6.2 Calendar (`/dashboard/calendar`)

- **Day view:** columns per staff, time grid in the shop's timezone, bookings as blocks sized by duration, buffer shown as a lighter tail, time off shaded, now-line.
- **Week view:** one staff at a time (or compact all-staff).
- Navigation: today, previous/next, date picker; URL reflects date/view so it's shareable and back-button friendly.
- On phones: single-staff day view with swipe or tabs between staff.
- Tapping empty space starts "new booking" at that time.

### 6.3 Booking drawer

- Details: client (name, phone tap-to-call), service, staff, times, price, source, notes, status, created at.
- Actions by status: reschedule, change staff/service, cancel (with optional reason), mark completed, mark no-show, undo the last outcome within a short window.
- All changes go through server actions using `transitionBooking` and `computeBookingTimes`; conflicts (23P01) show a clear message.

### 6.4 New booking (phone/walk-in)

- Search existing clients by name/phone or create a new one inline.
- Pick service, staff, time (show the engine's free slots, plus an owner-only "override hours" option that still can't break the overlap constraint).
- `source = 'phone'` or `'walk_in'`.

### 6.5 Fast outcome marking

- After an appointment's end time, it shows "Done? ✓ / No-show" inline on the calendar and Today screen.
- One tap each; bulk-mark from the unmarked list.

### 6.6 Live updates

- Subscribe to booking changes for the current shop (Supabase Realtime, respecting RLS) so a booking made online appears without refresh. Fall back to refetch on focus if Realtime is unavailable.

### 6.7 Performance

- Fetch only the visible range; index-backed queries; avoid N+1 (join service/staff/client names in one query or a view).

## Tests

- Server actions: each status action, permissions (staff can manage bookings, not settings), conflict handling.
- Component tests: calendar block positioning for normal and DST days (reuse 03 fixtures).
- e2e: create phone booking → appears in calendar → reschedule → mark completed; a booking made on the public page appears live in an open dashboard.

## Acceptance criteria

- Marking an outcome takes one tap from the Today screen.
- Calendar is usable on an iPad and a phone.
- No full-page reloads needed during normal use.

## Agent prompt

```
Read .github/AGENTS.md, .github/milestones/06-dashboard-calendar.md and the
booking-engine skill. Propose the component tree, data-fetching approach and
server actions. Consider whether to use a calendar library or build the grid;
recommend one with reasons. Wait for my OK, then implement with tests.
```
