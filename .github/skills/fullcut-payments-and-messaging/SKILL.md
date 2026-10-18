---
name: fullcut-payments-and-messaging
description: Use when working on Fullcut money or messages — Stripe Connect onboarding, deposits, refunds, platform fees, Twilio SMS reminders and confirmations, inbound text replies, webhooks, idempotency, quiet hours, opt-outs, or marketing consent.
---

# Fullcut: payments and messaging

Money and messages are where trust is won or lost. Fullcut's pitch is honesty: no commission on clients, no surprise fees, no spam.

## Development safety

- Use **Stripe test mode** keys and **Twilio test credentials or a verified test number** in development. Never send real texts or create real charges from local dev, tests or CI.
- Ask the human before changing anything about fees, pricing, or how the platform fee is calculated.

## Stripe Connect

- Each shop connects its own Stripe account (Express accounts are a good default) via Stripe-hosted onboarding links. Store `stripe_account_id` and onboarding status on the shop.
- A shop cannot require deposits until its connected account can accept charges; the dashboard shows a clear "finish payment setup" state.
- Deposits are collected with Stripe Checkout (hosted page) or a Payment Element, created **on the server** with:
  - `amount` in integer cents and the shop's `currency`
  - the connected account as the destination of funds
  - Fullcut's platform fee as an explicit application fee amount (if the shop's plan includes one)
  - `metadata`: `booking_id`, `shop_id`
  - an idempotency key derived from the booking id, so retries never create duplicate payments
- Pick one charge model (destination charges vs direct charges), record it in an ADR, and use it consistently. Check the current Stripe Connect docs before implementing; do not rely on memory for parameter names.
- **Disclosure:** the deposit screen shows the amount, the cancellation policy, and any platform fee before the client pays. Receipts show the same.

### Webhooks (`/api/webhooks/stripe`)

1. Read the **raw** request body (`await request.text()` in a Next.js route handler) and verify the signature with the webhook secret. Reject with 400 if verification fails.
2. Insert `('stripe', event.id)` into `webhook_events`. If it already exists, return 200 immediately (already processed).
3. Handle events:
   - checkout/payment completed → booking `pending` → `confirmed`, send confirmation SMS
   - checkout expired / payment failed → booking `pending` → `cancelled` (frees the slot)
   - account updated → refresh the shop's onboarding/charges-enabled status
4. Return 200 quickly. Any slow follow-up work goes to a background job.

- Locally: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

### Refunds and cancellation policy

- Each shop sets a policy, e.g. "full refund if cancelled 24 h or more before; deposit kept otherwise". Store it as structured data, not free text.
- One function decides the refund amount from (policy, booking time, cancellation time). Unit test the boundaries (exactly 24 h, DST weeks).
- No-show: the deposit is kept per policy; never charge more than the client agreed to.

## Twilio SMS

- Send through a Twilio Messaging Service. Store each outgoing message (booking id, type, Twilio SID, status) so sends are traceable and never duplicated.
- Status callbacks update delivery status; verify Twilio's request signature (`X-Twilio-Signature`) on every inbound webhook and reject unsigned requests.
- Phone numbers are E.164. Normalise with `libphonenumber-js` using the shop's country as the default region.

### Message types

| Type          | Examples                                                                                                                      | Consent                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Transactional | Booking confirmation, reminder for a booked appointment, "reply YES to confirm", deposit link, cancellation/reschedule notice | Sent because the client booked; still stop if they opted out of SMS                             |
| Marketing     | "Who's due" rebooking nudges, promotions, standby offers to non-booked clients                                                | Requires recorded opt-in (`marketing_opt_in`, timestamp, method) and an unsubscribe instruction |

Fullcut starts in Canada, where commercial electronic messages fall under CASL (consent, sender identification, unsubscribe mechanism). Treat rebooking nudges as marketing. This is guidance, not legal advice; confirm requirements before launch.

### Rules

- **Opt-out:** inbound `STOP` (and common variants) sets `clients.sms_opted_out = true` immediately and suppresses all further texts to that number for that shop. `START` re-subscribes.
- **Quiet hours:** no texts between 21:00 and 09:00 in the shop's timezone. Messages scheduled inside quiet hours move to 09:00.
- **Frequency caps:** at most one marketing message per client per 14 days per shop (configurable, never unlimited).
- Every message identifies the shop by name. Marketing messages include "Reply STOP to unsubscribe".
- Inbound replies: `YES`/`Y` to a confirmation request → mark confirmed-by-client (lowers effective risk). Anything unrecognised is forwarded to the shop's inbox view; never guess.
- Keep templates in one module with tests; messages must stay short (one SMS segment where possible) and plain.

## Tests that must exist

- Stripe webhook: bad signature → 400; valid event processed once; the same event replayed → no second state change.
- Expired checkout frees the slot.
- Refund calculation at policy boundaries.
- Twilio webhook signature rejection.
- STOP suppresses later sends; quiet hours defer sends; marketing without consent is blocked.
- No secret keys appear in client bundles (check that env vars used client-side are only `NEXT_PUBLIC_*` publishable values).
