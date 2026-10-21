---
name: fullcut-messaging
description: Use when working on Fullcut messages — Twilio SMS confirmations and reminders, confirm-or-release, waitlist slot offers, inbound text replies, webhooks, idempotency, quiet hours, opt-outs, or marketing consent.
---

# Fullcut: messaging

Messages are where trust is won or lost. Fullcut's pitch is honesty: no commission on clients, no surprise fees, no spam.

Fullcut does **not** take payments from clients: no deposits, cards on file or refunds. No-show protection comes from confirmations, confirm-or-release and waitlist refill instead. Ask the human before adding any payment collection.

## Development safety

- Use **Twilio test credentials or a verified test number** in development, and `MESSAGING_MODE=log` by default. Never send real texts from local dev, tests or CI.
- Ask the human before changing anything about fees or pricing.

## Webhooks

1. Read the **raw** request body and verify the provider's signature (`X-Twilio-Signature` for Twilio). Reject with 400/403 if verification fails.
2. Insert `(provider, event id)` into `webhook_events`. If it already exists, return 200 immediately (already processed).
3. Return 200 quickly. Any slow follow-up work goes to a background job.

## Twilio SMS

- Send through a Twilio Messaging Service. Store each outgoing message (booking id, type, Twilio SID, status) so sends are traceable and never duplicated.
- Status callbacks update delivery status; verify Twilio's request signature (`X-Twilio-Signature`) on every inbound webhook and reject unsigned requests.
- Phone numbers are E.164. Normalise with `libphonenumber-js` using the shop's country as the default region.

### Message types

| Type           | Examples                                                                                                                     | Consent                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Transactional  | Booking confirmation, reminder, "reply YES to confirm" and its final warning, release notice, cancellation/reschedule notice | Sent because the client booked; still stop if they opted out of SMS                                                     |
| Waitlist offer | "A spot opened for … First to tap gets it" sent to clients on the waitlist                                                   | Only because the client asked when joining (`offers_requested_at`, method on the entry); ends with the entry or on STOP |
| Marketing      | "Who's due" rebooking nudges, promotions, slot offers to clients who aren't on the waitlist                                  | Requires recorded opt-in (`marketing_opt_in`, timestamp, method) and an unsubscribe instruction                         |

Fullcut starts in Canada, where commercial electronic messages fall under CASL (consent, sender identification, unsubscribe mechanism). Treat rebooking nudges as marketing. This is guidance, not legal advice; confirm requirements before launch.

### Rules

- **Opt-out:** inbound `STOP` (and common variants) sets `clients.sms_opted_out = true` immediately and suppresses all further texts to that number for that shop. `START` re-subscribes.
- **Quiet hours:** no texts between 21:00 and 09:00 in the shop's timezone. Messages scheduled inside quiet hours move to 09:00.
- **Frequency caps:** at most one marketing message per client per 14 days per shop (configurable, never unlimited).
- Every message identifies the shop by name. Marketing messages include "Reply STOP to unsubscribe".
- Inbound replies: `YES`/`Y` to a confirmation request → mark confirmed-by-client (lowers effective risk, and stops a confirm-or-release). Anything unrecognised is forwarded to the shop's inbox view; never guess.
- **Confirm-or-release:** confirm request, then a final warning that names the deadline in the shop's local time, then (only if the owner opted in to auto-release) a release notice. The final warning must go out outside quiet hours and before the deadline; if it can't, never release.
- **Waitlist offers:** sent in small waves with a short expiry (default 15 min). Never sent in quiet hours; if waiting until 09:00 would pass the slot's minimum notice, drop the slot instead of deferring. STOP also cancels the client's waitlist entries for that shop.
- Keep templates in one module with tests; messages must stay short (one SMS segment where possible) and plain.

## Tests that must exist

- Twilio webhook signature rejection; the same event replayed → no second state change.
- STOP suppresses later sends and cancels waitlist entries; quiet hours defer sends; marketing without consent is blocked.
- Waitlist offer without a recorded request is blocked; offers are never sent in quiet hours.
- A booking is never released unless the final warning was sent.
- No secret keys appear in client bundles (check that env vars used client-side are only `NEXT_PUBLIC_*` publishable values).
