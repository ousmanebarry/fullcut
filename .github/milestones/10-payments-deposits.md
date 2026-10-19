# Milestone 10 — Payments: Stripe Connect deposits

**Goal:** shops can require deposits, clients pay them during booking, the slot is held while they pay, and refunds follow the shop's cancellation policy. Every fee is shown before it's charged.

**Depends on:** 05, 09 (job runner for hold expiry)
**Skills to read:** `fullcut-payments-and-messaging`, `fullcut-booking-engine` (pending holds)

## Manual steps for the human
- Create a Stripe account, enable Connect, use **test mode** keys only. Install the Stripe CLI for local webhooks.
- Decide the platform fee (ask before implementing any non-zero fee).

## In scope
- Connect onboarding, deposit rules, checkout with hold, webhooks, refunds, payments list

## Out of scope
- Risk-based deposits (12 adds the "high risk only" rule)
- Charging full service price online, tips, gift cards, subscriptions billing for Fullcut itself

## Tasks

### 10.1 ADR: charge model
- Compare destination charges vs direct charges for Fullcut's case (who pays Stripe fees, refunds, disputes, what the client's statement shows). Check current Stripe Connect docs. Recommend one.

### 10.2 Migration
- `shops`: `stripe_account_id`, `stripe_charges_enabled`, `stripe_details_submitted`.
- `deposit_policy` (structured): `mode` (`off` / `all_bookings` / `per_service` / later `high_risk`), default amount or percent.
- `cancellation_policy` (structured): `free_cancel_hours` (e.g. 24), `late_cancel_keeps_deposit` (bool), `no_show_keeps_deposit` (bool).
- `payments`: `shop_id`, `booking_id`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `amount_cents`, `platform_fee_cents`, `currency`, `status`, `refunded_cents`, timestamps. RLS as usual.

### 10.3 Connect onboarding
- Settings → Payments: "Connect Stripe" creates an Express account (if none) and redirects to a Stripe-hosted onboarding link; return and refresh URLs handled.
- Webhook `account.updated` keeps `charges_enabled` in sync. Deposit settings are disabled until charges are enabled.

### 10.4 Booking with deposit
1. Public booking: when a deposit applies, step 3 shows deposit amount, cancellation policy in plain words, and any platform fee, then "Pay deposit".
2. Server creates the booking as `pending` with `pending_expires_at = now + 15 min`, then a Checkout Session (amount, currency, connected account, platform fee, metadata `booking_id`/`shop_id`, idempotency key from booking id, success/cancel URLs back to the booking page).
3. `checkout.session.completed` → booking `confirmed`, payment `succeeded`, queue confirmation SMS (09).
4. `checkout.session.expired` or hold expiry job → booking `cancelled`, slot freed.
5. Success page polls booking status briefly (webhook may arrive after redirect).

### 10.5 Hold expiry
- Job (09 runner) cancels `pending` bookings past `pending_expires_at`.
- Booking creation also cancels expired holds for that staff in the same transaction (per skill).

### 10.6 Refunds and outcomes
- Pure function `refundAmount(policy, booking, cancelledAt, cancelledBy)` with boundary tests (exactly at `free_cancel_hours`, DST weeks, shop-initiated cancel = full refund).
- Client cancels via manage link → refund per policy through Stripe; booking drawer shows refund status.
- No-show: deposit kept if policy says so; nothing else charged.

### 10.7 Dashboard
- Payments list (date, client, amount, fee, status, refund), booking drawer payment section, manual "refund" button for owners.

### 10.8 Webhook route
- `/api/webhooks/stripe`: raw body, signature verification, `webhook_events` idempotency, fast 200, follow-up work queued.

## Tests
- Webhook: invalid signature → 400; duplicate event → no double processing; out-of-order events handled.
- Expired hold frees the slot; paid booking can't be double-confirmed.
- `refundAmount` boundaries.
- e2e (Stripe test mode + CLI): book with deposit using a test card → confirmed; abandon checkout → slot released after expiry.

## Acceptance criteria
- The full deposit flow works end-to-end in test mode.
- Deposit amount, policy and fees are visible before payment and on the receipt/confirmation.

## Agent prompt
```
Read .github/AGENTS.md, .github/milestones/10-payments-deposits.md and the
skills it lists. Start with the charge-model ADR using current Stripe docs;
recommend one and wait for my decision. Don't implement any non-zero platform
fee without asking me. Then plan, wait for OK, implement in test mode only.
```
