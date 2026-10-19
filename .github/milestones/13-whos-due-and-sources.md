# Milestone 13 — "Who's due" rebooking, source tracking and analytics

**Goal:** Fullcut brings regulars back before they drift away, shows the owner where clients come from, and makes the app's value visible in numbers ("this month: 4 no-shows prevented, 9 clients rebooked, ~$X saved").

**Depends on:** 07, 09, 12
**Skills to read:** `fullcut-noshow-ml` (who's due), `fullcut-payments-and-messaging` (marketing consent)

## In scope
- Marketing consent capture
- Due list, rebooking nudges with suggested slots
- Source links and referral codes
- Analytics page

## Out of scope
- Paid marketing campaigns, email marketing

## Tasks

### 13.1 Consent capture
- Public booking form: unchecked-by-default checkbox "Text me when I'm due for my next appointment" with clear wording; stores `marketing_opt_in`, timestamp and method.
- Client profile shows consent; owner can record consent given in person (method `in_person`, with date).
- Consent text includes the shop name and how to unsubscribe (CASL-minded; not legal advice).

### 13.2 Due list
- Compute per the skill: ≥ 3 completed visits, median interval, due when overdue by ×1.2 (configurable) with no future booking.
- Implement as a SQL view/function or in the ML service; justify the choice. Recompute daily via job.
- Dashboard "Due" tab: client, usual interval, days since last visit, usual service/staff, consent status, actions (text, call, dismiss for N days).

### 13.3 Nudges
- Automatic (if the shop enables it) or one-tap manual nudge.
- Message suggests 2–3 open slots matching the client's usual weekday/time-of-day, each with a deep link that pre-fills the booking page.
- Rules: only with marketing consent; respects STOP, quiet hours and the frequency cap (≤ 1 marketing text per 14 days per client per shop); never if they already have a future booking.
- Track: nudge sent → booked within 14 days (attribution window).

### 13.4 Source tracking
- Shareable links per channel: `/<slug>?src=instagram`, `?src=google`, `?src=tiktok`, custom.
- Referral codes per client (`?ref=CODE`); the referrer is stored on the new client.
- `bookings.source` and `clients.first_source` filled consistently; imported clients keep `import:<platform>`.
- Settings page lists links with copy buttons and a QR code for the shop counter.

### 13.5 Analytics page (`/dashboard/insights`)
- Period selector (last 30 / 90 days, custom).
- Cards: bookings, revenue (completed bookings' price), no-show rate, new vs returning clients.
- Charts: bookings by source over time; no-show rate trend; top referrers.
- Fullcut value panel: no-shows estimated prevented (risk-flagged bookings that confirmed/paid deposit vs expected rate — explain the estimate method), rebookings from nudges, revenue from them.
- All figures computed server-side with tests on the seed data; every number has a short "how is this calculated" tooltip.

## Tests
- Due computation edge cases (irregular gaps, recent visit, future booking present).
- Nudge blocked without consent / after STOP / within cap / in quiet hours.
- Source and referral attribution through the full booking flow.
- Analytics numbers match hand-computed values on a fixture shop.

## Acceptance criteria
- Owner can see who's due and nudge them in one tap.
- Insights page explains every number it shows.

## Agent prompt
```
Read .github/AGENTS.md, .github/milestones/13-whos-due-and-sources.md and the
skills it lists. Plan consent capture, the due-list computation (and where it
lives), nudges, source tracking, and the insights page. Wait for my OK, then
implement in that order with tests.
```
