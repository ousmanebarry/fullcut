# ADR 0008: Background jobs and SMS messaging

- Status: accepted
- Date: 2026-10-19

## Context

Fullcut must text clients (confirmations, reminders, reschedule/cancel notices, "reply YES") at the right time, never twice, never to someone who replied STOP, and never at night. Later milestones (waitlist offers, ML scoring, rebooking nudges) need the same "run due work every minute" mechanism. The web app runs on Vercel and the database on Supabase (free plans for now).

Options compared (limits checked 2026-10-19):

| Option                                           | Cost / limits                                                                      | Local dev                                                 | Retries                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------- |
| Vercel Cron → route                              | Hobby: once per day, ±59 min. Per-minute needs Pro.                                | Call the route by hand                                    | None (next run)             |
| Inngest                                          | Free: 50k executions/month; a per-minute cron alone uses ~43k. New vendor + SDK.   | `inngest-cli dev` server                                  | Built in                    |
| Trigger.dev                                      | Free: $5/month credit, 10 schedules. New vendor + SDK, tasks run on their workers. | CLI dev mode                                              | Built in                    |
| **Supabase pg_cron + pg_net → `/api/jobs/tick`** | Free on every plan. pg_cron is already enabled (demo reset).                       | Cron no-ops locally; `pnpm jobs:dev` ticks the dev server | From the outbox (see below) |

## Decision

- **Runner:** pg_cron runs `private.trigger_jobs_tick()` every minute. It reads `jobs_tick_url` and `jobs_secret` from Supabase Vault and, when both exist, POSTs to `/api/jobs/tick` with `Authorization: Bearer <secret>` via pg_net. Without the secrets it does nothing, so local databases and CI never call out. The route compares the secret in constant time and rejects everything else with 401. Locally, `pnpm jobs:dev` posts to the dev server every 15 s.
- **Outbox:** `scheduled_messages` is the queue. An `after insert or update` trigger on `bookings` (`private.enqueue_booking_messages`) writes rows in the same transaction as the booking change, so every writer (public RPC, staff RPC, manage links, dashboard, future waitlist claims) is covered and a rolled-back booking never leaves a message behind.
  - New confirmed booking, or `pending` → `confirmed`: `confirmation` now (not for walk-ins) and `reminder` at start − lead hours (skipped when that moment has already passed).
  - Start time or staff changed: queued reminders/confirm requests are cancelled, `rescheduled` and a new reminder are queued.
  - Cancelled: everything queued is cancelled; `cancelled` is queued only when `bookings.cancelled_by = 'shop'`.
  - Completed / no-show: everything queued is cancelled.
  - Demo-shop and past bookings never queue anything.
- **No duplicates:** `unique (booking_id, dedupe_key)`. The key is the type for one-off messages (`confirmation`, `cancelled`) and `type@<starts_at>` for per-appointment-time messages, so a reschedule can get a new reminder but the same appointment time can never get two.
- **Worker:** `claim_due_messages(limit)` moves due `queued` rows to `sending` with `FOR UPDATE SKIP LOCKED`, so concurrent ticks never claim the same row. Each row goes through one send-time check (`decideSend`): opted out, no valid phone, booking no longer active, type turned off, demo shop → `skipped` with a reason; inside quiet hours (21:00–09:00 shop time) → deferred to 09:00, or skipped if that is after the appointment starts. `confirmation` is exempt from quiet hours because the client has just acted.
- **At most once:** temporary Twilio failures (network, 429, 5xx) go back to `queued` with backoff (1, 5, 25 min, 3 attempts). A row left in `sending` for 10 minutes (the process died mid-send) is marked `failed` (`unknown_outcome`) rather than retried, because a client getting the same text twice is worse than missing one.
- **Manage links:** only token hashes are stored (ADR 0005), so the worker issues a fresh link per message. The stored body has the link replaced by `[manage link]`.
- **Twilio:** the official `twilio` SDK (server-only) sends through a Messaging Service with a per-message status callback. Both webhooks verify `X-Twilio-Signature` against `TWILIO_WEBHOOK_BASE_URL` (default `SITE_URL`) + path, never the Host header, and record `webhook_events` (`MessageSid:Status` for status callbacks, `MessageSid` for inbound) so a replay changes nothing.
- **Inbound:** one Twilio sender serves every shop, and Twilio's own opt-out blocks the whole sender, so STOP/START apply to that phone in every shop. YES confirms the phone's next upcoming booking. Anything else is filed under the shop of the nearest upcoming booking (else the most recent one in 30 days) for the dashboard inbox; with no match it is dropped.
- **Dev safety:** `MESSAGING_MODE=log` (the default) logs a masked line instead of calling Twilio. Only `MESSAGING_MODE=twilio` sends real texts.

## Consequences

- Each environment needs its Vault secrets set once by hand (`vault.create_secret`), and the URL must point at that environment's deployment.
- The tick is at-least-once per minute but not exact; messages can go out up to about a minute late.
- Message rules live partly in SQL (what to queue) and partly in TypeScript (whether to send now); tests cover both.
- A failed send is visible in the booking drawer but is not retried by hand yet.
- One shared sender number means a STOP to one shop stops texts from all Fullcut shops to that phone. Per-shop numbers would fix this at extra cost.
