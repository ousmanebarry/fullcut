# Milestone 09 — Background jobs and SMS messaging

**Goal:** Fullcut texts clients: booking confirmations, reminders, "reply YES to confirm", and cancel/reschedule links, with opt-outs and quiet hours handled correctly. This milestone also adds the background job system that later milestones (deposit holds, ML, rebooking nudges) depend on.

**Depends on:** 05, 06 (and 08 if testing webhooks against the deployed app)
**Skills to read:** `fullcut-payments-and-messaging` (Twilio parts), `fullcut-data-and-tenancy`

## Manual steps for the human
- Create a Twilio account (trial is fine), a Messaging Service and a phone number; add credentials to `.env.local` and Vercel. On a trial, texts only go to verified numbers — verify your own phone for testing.

## In scope
- Job runner, message outbox, Twilio sending and webhooks
- Confirmation, reminder, confirm-request, cancellation messages
- STOP/START handling, quiet hours, per-shop message settings

## Out of scope
- Marketing messages (rebooking nudges) — 13
- Risk-based confirmation requests — 12 (build the message type now, trigger it from 12)

## Tasks

### 9.1 Job runner (ADR first)
Options: Supabase `pg_cron` + `pg_net` calling a protected Next.js route every minute; or a hosted job service (Inngest / Trigger.dev); or a platform cron. Compare cost, local-dev story, retries, and plan limits (check current limits, some free tiers only allow daily cron). Recommend one in an ADR and implement a single `/api/jobs/tick` (or equivalent) that runs due work.
- Protect job endpoints with a secret header; reject anything else.
- Jobs must be idempotent and safe to run twice.

### 9.2 Outbox tables (migration)
- `scheduled_messages`: `shop_id`, `booking_id`, `client_id`, `type`, `send_at`, `status` (`queued`/`sending`/`sent`/`failed`/`skipped`/`cancelled`), `skip_reason`, `attempts`, `twilio_sid`, `body`, timestamps.
- Unique constraint on `(booking_id, type)` for one-per-booking message types so duplicates are impossible.
- `inbound_messages`: raw inbound SMS (shop resolved via client phone + recent booking), for the shop's inbox view.
- RLS: members read their shop's rows; only the server writes.

### 9.3 Scheduling rules
- On booking created → queue `confirmation` (now) and `reminder` (24 h before, configurable; skip if the appointment is less than 3 h away).
- On reschedule → cancel queued reminder, queue a new one, send `rescheduled`.
- On cancel → cancel queued messages, send `cancelled` (if cancelled by the shop).
- `confirm_request` type exists (sent by 12 for medium/high risk).
- Worker picks due `queued` rows with `FOR UPDATE SKIP LOCKED`, applies rules, sends, records result. Retry failures with backoff up to 3 attempts.

### 9.4 Send-time checks (in one function, unit tested)
Skip (with reason) if: client `sms_opted_out`; no valid phone; booking no longer active; shop disabled that message type. Defer if inside quiet hours (21:00–09:00 shop local) to 09:00.

### 9.5 Templates
- One module, typed, shop name always included, short (aim for one SMS segment), includes the manage link from 05.
- Examples: confirmation ("Demo Barbers: you're booked for a Skin Fade with Sam, Tue Nov 3 at 10:00. Manage: <link>"), reminder, confirm request ("Reply YES to confirm or use <link> to change"), cancelled, rescheduled.
- Snapshot tests for every template.

### 9.6 Twilio webhooks
- Status callback route: verify `X-Twilio-Signature`, update message status.
- Inbound route: verify signature; `STOP`/`STOPALL`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT` → set `sms_opted_out = true` for that phone in the relevant shop(s); `START`/`UNSTOP` → re-enable; `YES`/`Y` → mark the client's next upcoming booking `client_confirmed_at` (add column); anything else → `inbound_messages` for the shop inbox.
- Record processed provider IDs in `webhook_events` for idempotency.

### 9.7 Shop settings and inbox
- Settings: toggle each message type, reminder lead time, custom sign-off line.
- Dashboard inbox: unmatched replies with client name and quick "call"/"mark handled".
- Booking drawer shows message history (sent/delivered/failed).

### 9.8 Dev safety
- A `MESSAGING_MODE=log|twilio` env: `log` (default in dev/test) writes messages to the console/db instead of sending.

## Tests
- Scheduling rules for create/reschedule/cancel; no duplicate reminders.
- Quiet hours deferral around midnight and DST days.
- STOP blocks later sends; START re-enables.
- Signature rejection on both webhooks; replayed webhook does nothing twice.
- Worker concurrency: two workers never send the same message.

## Acceptance criteria
- Booking on the public page produces a confirmation text on your verified phone (Twilio mode) and a reminder at the right time.
- Replying STOP stops all further texts from that shop.

## Agent prompt
```
Read .github/AGENTS.md, .github/milestones/09-messaging-and-jobs.md and the
skills it lists. Start with the job-runner ADR: compare options for our stack
and recommend one. Wait for my decision. Then plan the migration, worker,
templates and webhooks, wait for OK, implement with MESSAGING_MODE=log by
default, and run the tests.
```
