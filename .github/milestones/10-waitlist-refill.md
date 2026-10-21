# Milestone 10 — Waitlist and slot refill

**Goal:** when a booked slot frees up, Fullcut fills it from the shop's waitlist by text: matching clients get an offer and the first to tap books it. A late cancellation then costs the owner little. This replaces deposits: Fullcut never charges clients up front; the owner is made whole by a refilled chair, and the dashboard shows how many slots were recovered and what they were worth.

**Depends on:** 05, 07, 09
**Skills to read:** `fullcut-booking-engine` (waitlist and slot refill), `fullcut-messaging` (waitlist offers, quiet hours), `fullcut-data-and-tenancy`

## Manual steps for the human

- Nothing new beyond 09 (Twilio). Develop with `MESSAGING_MODE=log`; send real offers only to your own verified number.
- Confirm the defaults: wave size 3, offer expiry 15 min, minimum notice 60 min.

## In scope

- Waitlist entries: join on the public page, added by staff, left by the client
- Freed-slot detection, matching, SMS offers in waves, one-tap claim page
- Owner settings, waitlist page, "slots recovered" metric

## Out of scope

- Deposits, cards on file or any payment collection (Fullcut doesn't take client payments)
- Risk-based confirm-or-release and standby suggestions (12 plugs into this milestone's refill)
- Offers to clients who aren't on the waitlist — those are marketing nudges (13)

## Tasks

### 10.1 Migration

- `waitlist_entries`: `shop_id`, `client_id`, `service_id`, `staff_id` (null = any staff), `earliest_date` / `latest_date` (shop-local dates, within the booking horizon), `time_windows` (jsonb list of weekday + local start/end; empty = any time), `status` (`active` / `booked` / `expired` / `cancelled`), `offers_requested_at`, `request_method` (`booking_page` / `staff`), `created_at`.
- `slot_offers`: `shop_id`, `waitlist_entry_id`, `staff_id`, `service_id`, `starts_at`, `freed_booking_id`, `wave`, `token_hash`, `status` (`sent` / `claimed` / `taken` / `expired` / `withdrawn`), `sent_at`, `expires_at`, `booking_id` (set on claim). Unique `(waitlist_entry_id, staff_id, starts_at)` so a client is never offered the same slot twice.
- `bookings.slot_offer_id` (nullable) and `source = 'waitlist'` for bookings created from an offer; the client's `first_source` is unchanged.
- Shop settings: `waitlist_enabled`, `waitlist_wave_size` (default 3), `waitlist_offer_minutes` (default 15), `waitlist_min_notice_minutes` (default 60: never offer a slot starting sooner).
- Composite FKs (ADR 0002), RLS, an index for matching (`shop_id, service_id, status`). Add both tables to the export (`EXPORT_SOURCES`) and to the merge/anonymise RPCs.
- Cap active entries per phone per shop (e.g. 3), enforced in the write RPC.

### 10.2 Joining and leaving

- Public booking page: "Can't find a time? Join the waitlist" (also shown when no slots fit). Fields: service, staff (any or specific), date range, optional time-of-day windows, name, phone, and an unchecked-by-default checkbox "Text me when a spot opens" that must be ticked to join. Same rate limits and honeypot as booking (ADR 0005); writes go through a service-role RPC.
- Confirmation text with a signed link (like manage links) to view or leave the waitlist.
- Dashboard: staff add an entry for a client on the phone (`request_method = 'staff'`), see and cancel entries.
- STOP cancels the client's active entries for that shop. Entries past `latest_date` expire (job).

### 10.3 Freed-slot detection

- A booking that leaves the active set (cancelled by client or shop, or rescheduled to another time) with `starts_at` more than `waitlist_min_notice_minutes` away queues a `slot_freed` job, written by a trigger in the same transaction (same pattern as the message outbox in ADR 0008).
- 12 adds "released for no confirmation" as another trigger; the job input must not depend on why the slot freed.

### 10.4 Matching (pure functions in `apps/web/lib/waitlist/`)

- `matchWaitlist({ freedSlot, entries, schedulingInputs, now })` → ordered candidates, each with the exact start, staff and service to offer.
- Re-run the booking engine for the freed staff and window, so an offer is always a slot the booking page would also show (hours, time off, lead time, other bookings). A freed 60-min gap can serve a 30-min service; never offer a service that doesn't fit.
- An entry matches when the service matches, the staff matches (or the entry says any), and the slot's local date and time fall inside its range and windows (DST-safe via `lib/time`).
- Order: specific-staff entries before any-staff, then oldest entry first. Skip entries with an unexpired offer, SMS-opted-out clients, and clients who already have a booking with the shop that day.

### 10.5 Offers in waves

- Wave 1 texts the top `wave_size` candidates at once: "Demo Barbers: a spot opened for Skin Fade with Sam, Tue 3:00 PM. First to tap gets it: <link> (until 2:15 PM)".
- Unclaimed at expiry → next wave, until candidates run out or the slot passes its minimum notice. An offer never expires later than slot start − minimum notice.
- Quiet hours: never send an offer; if waiting until 09:00 would pass the minimum notice, drop the slot instead of deferring.
- Claim page (`/w/<token>`): shows the slot and one "Book it" button. The claim RPC checks the token (status `sent`, not expired), then inserts the booking through the same path as `create_public_booking`, so `bookings_no_overlap` settles races. Winner: offer `claimed`, entry `booked`, normal confirmation text. Others: "Sorry, someone just took it — you're still on the waitlist", offer `taken`.
- If someone books the slot directly on the booking page first, outstanding offers become `withdrawn`; opening the link shows the "taken" page.
- Demo shop: offers are created and visible in the dashboard but never texted (09 rules).

### 10.6 Dashboard

- Waitlist page: active entries (client, service, staff, dates, windows, age) and recent offers with outcomes.
- Booking drawer and calendar block: "Refilled from waitlist" badge.
- Settings → Waitlist: on/off, wave size, offer expiry, minimum notice, with a plain-language preview ("When a slot frees up at least 1 hour ahead, we text up to 3 matching clients; the first to tap gets it").
- Metric card: slots recovered this month and the revenue they represent (price of completed refilled bookings), each with a "how is this calculated" tooltip. 13 reuses it in the value panel.

## Tests

- Matcher unit tests: staff preference order, oldest first, time windows on the DST days in `America/Toronto`, shorter service fits a longer freed gap and a longer one doesn't, minimum notice and lead time cut-offs, client already booked that day is skipped.
- Two clients claim the same slot concurrently → exactly one booking; the other gets "taken" and their entry stays `active`.
- Expired, reused or forged token rejected; slot booked directly before any claim → "taken".
- STOP cancels entries; quiet hours suppress waves; the demo shop sends nothing.
- RLS: another shop can't read or write entries or offers; the export includes both tables.
- e2e (log mode): client A cancels via the manage link → waitlisted client B's offer is queued → B opens the claim link → the booking shows on the calendar with the refilled badge.

## Acceptance criteria

- A cancelled slot is offered to matching waitlisted clients within a minute and can be claimed from a phone in one tap.
- No double booking under concurrent claims.
- Turning the waitlist off makes the app behave exactly as before this milestone.

## Agent prompt

```
Read .github/AGENTS.md, .github/milestones/10-waitlist-refill.md and the
skills it lists. Plan in phases: (1) migration + joining/leaving, (2) freed-slot
detection + matcher, (3) offers, claim page and jobs, (4) dashboard, settings
and metric. Wait for my OK on the plan, then do one phase at a time, stopping
after each phase for review.
```
