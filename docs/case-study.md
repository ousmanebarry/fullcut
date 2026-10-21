# Fullcut case study

Booking and scheduling for independent barbers and stylists who already have their own clients. Live demo at [fullcut.ca](https://fullcut.ca); code and setup in the [README](../README.md).

Every number in this document comes from the code, the test suites or [docs/ml/noshow-prototype-metrics.json](ml/noshow-prototype-metrics.json). Where there is no data yet (real shops), it says so.

## The problem

An established barber with a full book doesn't need a marketplace. They need their regulars to book easily, show up, and have gaps filled. The big platforms (Square Appointments, Booksy, Fresha, Vagaro, StyleSeat) are built around a marketplace instead, and that shows up as pain for exactly these professionals:

- **Commission on their own clients.** New-client fees, often around 20–30% of a first booking, including on clients who found the barber themselves through Instagram or word of mouth.
- **Hidden monthly cost.** A low headline price, then paid add-ons for reminders, deposits or extra staff.
- **Competitors on the booking page.** Marketplaces list other shops next to yours, on the page your clients use to book you.
- **Data lock-in.** Exporting your client list is hard or partial, which makes leaving expensive.
- **No-shows are the barber's problem.** An empty chair is lost income, and the usual answer (a card or deposit on every booking) adds friction for the many clients who always show up.

## Users

- **Owners and chair renters** of 1–6 chair shops: run the day from a phone or an iPad at the station, between clients.
- **Their clients:** book from a link in an Instagram bio or a text, on a phone, without creating an account.

## What I built

| Area                | What exists                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public booking page | Service → time → confirm in three steps, no account. Manage links to cancel or reschedule. Rate limited.                                                                 |
| Dashboard (PWA)     | Today view, calendar with live updates, outcomes, client book with notes, merge and anonymise, inbox for text replies, settings.                                         |
| Messaging           | SMS confirmations and reminders through a transactional outbox, quiet hours, STOP handling, two-way replies.                                                             |
| Waitlist refill     | Freed slots are matched to waitlisted clients and offered by text; the first to tap books it.                                                                            |
| No-show risk        | A scoring service rates every booking; owners choose what each risk level triggers: confirmation request, extra reminder, confirm-or-release, standby from the waitlist. |
| Data ownership      | Full CSV export (ZIP) of every tenant table, enforced by a test.                                                                                                         |
| ML                  | Offline prototype with a time-based evaluation, a FastAPI scoring service sharing the same feature code, and a retraining path.                                          |
| Delivery            | CI (lint, types, unit, pgTAP, DB integration, e2e with axe, ML), staged migrations, approval gate for production, a public demo shop reset nightly.                      |

Stack: Next.js 16 (App Router, TypeScript strict), Supabase (Postgres, Auth, RLS, Realtime, pg_cron), Twilio, Python 3.12 (scikit-learn, LightGBM, FastAPI), Vercel. The reasons for each choice are in the [ADRs](adr).

## Hardest problems and how I solved them

### 1. "No double bookings" under real concurrency

Checking for overlaps in application code is a race: two clients can both see 10:00 as free and both insert. I made the database the source of truth with an exclusion constraint on each staff member's blocked time range (`bookings_no_overlap`, using `btree_gist`), active only for pending and confirmed bookings.

The first concurrency test then failed in an unexpected way: parallel inserts against an exclusion constraint can **deadlock** (`40P01`) instead of cleanly failing with a conflict. The fix was a trigger that takes a per-staff transaction-scoped advisory lock before the insert, so writes for one stylist are serialised while different stylists stay parallel. The test opens 10 transactions, fires 10 inserts for the same slot at once, and asserts exactly one succeeds and nine get `23P01`. The API turns `23P01` into "that time was just taken" plus the nearest open times. The waitlist claim reuses the same per-staff lock, so a client claiming an offer and a client booking online can't both win.

### 2. Multi-tenant isolation that doesn't depend on the app being careful

Every tenant table has `shop_id`, row-level security, and policies limited to members of that shop. Two things go further than the usual setup:

- **Composite foreign keys** (`(shop_id, client_id)` instead of `client_id`) make it impossible for a booking in shop A to reference a client in shop B, even through the service role ([ADR 0002](adr/0002-cross-shop-integrity-composite-fks.md)).
- **Tests that fail when someone forgets.** pgTAP tests run every tenant table through a helper that checks another shop's member can't select, insert, update or delete. A separate test fails if a new tenant table isn't in the CSV export or explicitly excluded, so "the shop owns its data" can't silently regress.

### 3. Time zones and daylight saving

Slots are generated in the shop's IANA time zone from wall-clock working hours ("Tue 09:00–17:00"), while instants are stored in UTC. On a spring-forward day 02:30 doesn't exist, and on a fall-back day 01:30 happens twice. Only one module imports the time library (Luxon), instants are a branded type, and slot generation is a pure function with explicit DST tests for Toronto plus property-based tests.

One Next.js-specific trap: with Cache Components on, Luxon's parsing calls `Date.now()`, which Next.js rejects while prerendering. Requests now resolve the session (which makes the route dynamic) before any date is parsed, and that rule is written down for future work.

### 4. Texts that are sent once, at the right time

Booking changes queue messages in a `scheduled_messages` table from a trigger, in the same transaction as the change (a transactional outbox). `pg_cron` calls the app every minute; the worker claims due rows with `FOR UPDATE SKIP LOCKED`, so overlapping ticks can't send the same text twice. Each send passes one decision function: opted out, booking no longer active, demo shop, or inside quiet hours (deferred to the morning, or skipped if that's after the appointment). Twilio webhooks are signature-checked and recorded by event ID, so retries are no-ops.

A bug the tests caught: the worker claims due rows across the whole database, so DB tests that forced failures for "their" rows were also failing other tests' rows. Tests now only fail sends for their own phone numbers, and DB test files run serially.

### 5. An ML feature that is honest about what it knows

There was no salon data, so the prototype trains on a public clinic no-show dataset (110,522 bookings) loaded into the same booking shape Fullcut stores. Decisions that mattered:

- **Time-based split, never random**: train on appointments up to 19 May, calibrate and pick the model on 20–31 May, test once on 1–8 June. A test checks that adding future bookings doesn't change any feature (no leakage).
- **A baseline to beat**: the client's own smoothed no-show history.
- **Fairness by construction**: age, gender, neighbourhood and health flags are dropped in the adapter, so no later code can use them. Clients who keep confirming and showing up stop being asked. Every action is opt-in per shop, and the owner can trust a client with one tap.
- **Advisory, never blocking**: scoring has a 300 ms budget and runs after the booking response; on failure the booking proceeds unscored.

The finding I'd lead with in an interview is the caveat: most of the model's lift comes from same-day bookings, which almost always show up. For bookings made at least a day ahead it barely beats the baseline. So real shops get a transparent heuristic, and the clinic-trained model is never enabled for them; it waits for each shop's own labelled data.

### 6. Cutting a feature on principle

Deposits were partly built (Stripe Connect, checkout, refunds) before I cut them: taking money from clients conflicts with "frictionless for clients" and with keeping Fullcut out of the client's wallet. Risky bookings get **confirm-or-release** instead: a text asking the client to confirm, and if they don't, the slot is released for the waitlist (only if the owner turned that on). The Stripe work lives on an unmerged branch, and the specs were updated so no future session rebuilds it.

## Results

**Engineering**

| Measure                                 | Result                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (Vitest)                     | 500                                                                                                                               |
| Database tests (pgTAP)                  | 462                                                                                                                               |
| DB integration tests (real Postgres)    | 110                                                                                                                               |
| End-to-end scenarios (Playwright)       | 22, each on desktop and mobile Chrome                                                                                             |
| ML tests (pytest)                       | 54                                                                                                                                |
| Accessibility                           | Zero axe WCAG 2.1 AA violations on the landing, auth and every dashboard page, and each step of the booking flow (enforced in CI) |
| Concurrency                             | 10 simultaneous bookings for one slot: exactly 1 succeeds                                                                         |
| Calendar query, 850k bookings in the DB | 5.9 ms for a week (RLS on); client list 130 ms for a 4,000-client shop                                                            |

**No-show model** (clinic data, test week of 26,451 bookings)

| Model               | PR AUC    | ROC AUC   | Top-20% recall | Top-20% precision |
| ------------------- | --------- | --------- | -------------- | ----------------- |
| Baseline (history)  | 0.220     | 0.557     | 23.3%          | 21.5%             |
| Logistic regression | **0.302** | **0.707** | **33.9%**      | **31.3%**         |

Flagging the riskiest 20% of bookings catches 34% of no-shows, against 23% for the history rule and 20% at random. For bookings made at least a day ahead, it's 24.3% against 22%.

**Real users:** no pilot shops yet, so there are no booking, no-show or refill numbers from production. This is the next step.

## What I'd do next

1. **Pilot with 1–3 shops** and track bookings through Fullcut, flagged vs actual no-shows, and slots refilled from the waitlist.
2. **Retrain on real salon data** pooled across shops, promoting a model only if it beats the current one on the same time-based holdout, and re-score 48 hours before the appointment, when "replied YES" is known.
3. **"Who's due" rebooking**: learn each client's visit rhythm and nudge overdue clients with open slots (marketing consent required).
4. **Source reports** from the source already recorded on every booking, and **imports** from Square, Booksy, Fresha and Vagaro exports.
5. **Learned durations**: how long each stylist really takes per service, and slot suggestions that avoid dead gaps.
6. **RLS at scale**: the membership check runs once per row; switching policies to a cached set of the user's shop IDs would cut the client list's cost if shops grow past a few thousand clients.

## Resume bullets

- Built Fullcut, a multi-tenant booking platform for independent barbers (Next.js 16, TypeScript, Supabase Postgres, Twilio, FastAPI), with zero double bookings guaranteed by a Postgres exclusion constraint and per-staff advisory locks, proven by a test where exactly 1 of 10 concurrent bookings for a slot succeeds.
- Enforced tenant isolation with row-level security and composite foreign keys, backed by 462 pgTAP tests and 110 integration tests against real Postgres; 500 unit tests, 22 Playwright scenarios on desktop and mobile, and zero axe WCAG 2.1 AA violations, all in CI.
- Designed a no-show model with a time-based split and leakage tests: PR AUC 0.302 vs a 0.220 history baseline, catching 34% of no-shows in the riskiest 20% of bookings (vs 23%); excluded demographic features, and served it through a FastAPI service with a 300 ms advisory budget so scoring can never block a booking.
- Shipped a transactional outbox for SMS (pg_cron, `SKIP LOCKED`, idempotent signed webhooks, quiet hours) and a waitlist that texts freed slots to matching clients, with race-free claims in a single SQL function.

<!-- Add a pilot bullet once there are real numbers (bookings made, no-shows flagged vs actual, slots refilled). -->
