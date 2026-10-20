# ADR 0009: Deposits with Stripe Connect (charge model and holds)

- Status: accepted
- Date: 2026-10-20

## Context

Shops can require a deposit when a client books (milestone 10). Each shop has its own Stripe connected account. Fullcut's pitch is zero commission and honest pricing, so the platform fee starts at $0, and Fullcut must not lose money or take on risk for every deposit. Current Stripe docs (checked 2026-10-20) mark the legacy Standard/Express/Custom account types as deprecated and recommend the Accounts v2 API.

Charge models compared:

|                                         | Direct charges                                                                                                            | Destination charges                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Merchant of record / client's statement | The shop                                                                                                                  | Fullcut (unless `on_behalf_of`)                                                    |
| Stripe processing fee                   | Paid by the shop (`fees_collector: stripe`)                                                                               | Always from Fullcut's balance: with a $0 fee Fullcut loses ~2.9% + 30¢ per deposit |
| Refunds                                 | Debited from the shop's balance                                                                                           | Debited from Fullcut's balance; recovered by reversing the transfer                |
| Disputes / negative balances            | Stripe-liable with `losses_collector: stripe`                                                                             | Fullcut-liable                                                                     |
| Checkout branding                       | The shop's                                                                                                                | Fullcut's                                                                          |
| Platform visibility                     | Objects live on the connected account; API calls need the `Stripe-Account` header and events come from connected accounts | Everything on the platform                                                         |

Account configuration: Accounts v2 rejects `dashboard: express` unless both `fees_collector` and `losses_collector` are `application`, which would make Fullcut pay Stripe fees and carry negative balances. `dashboard: full` allows both to be `stripe`.

## Decision

- **Direct charges** on **Accounts v2** connected accounts with `dashboard: full`, `defaults.responsibilities.fees_collector: stripe`, `losses_collector: stripe`, and the `merchant` configuration requesting `card_payments`. Shops onboard through Stripe-hosted v2 account links. A shop can take deposits only while `card_payments` is `active` (`shops.stripe_charges_enabled`).
- **Platform fee: $0.** `application_fee_amount` is omitted (Stripe requires it to be positive when set) and `payments.platform_fee_cents` stores 0. The client sees "No Fullcut fee" next to the deposit. Any non-zero fee needs the owner of the product to decide and a new ADR.
- **Checkout:** a Stripe-hosted Checkout Session created on the server with the `Stripe-Account` header, card payments only (wallets included), one line item with the deposit amount in the shop's currency, metadata `booking_id` / `shop_id`, and idempotency key `checkout:<booking_id>`. Card-only means `checkout.session.completed` always means paid; there are no delayed payment methods to track.
- **Hold:** the booking is created `pending` with `pending_expires_at = now + 30 min`, and the session's `expires_at` is the same instant. 30 minutes is Stripe's minimum session lifetime; a shorter hold would let a client pay for a slot that has already been released. Expiry is enforced three ways: `checkout.session.expired`, the job tick (`expireHolds`), and the existing "cancel expired holds for this staff" step inside the booking RPCs.
- **Late payment:** if a payment completes for a booking that is no longer `pending`, the webhook re-confirms it when the slot is still free (the exclusion constraint decides), otherwise it records a full refund as due.
- **Return URLs:** success and cancel return to the client's manage page (`/b/<token>?checkout=…`). The manage token therefore passes through Stripe; it only grants access to that one booking, and the page polls briefly because the webhook can arrive after the redirect.
- **Refunds:** one pure function, `refundAmount(policy, booking, cancelledAt, cancelledBy)`. Shop cancellations refund in full. Client cancellations refund in full at least `free_cancel_hours` real (elapsed) hours before the start, otherwise per `late_cancel_keeps_deposit`. No-shows never refund automatically; when the policy says a no-show doesn't keep the deposit, the owner is prompted to refund. The amount owed is written to `payments.refund_due_cents` in the same change that cancels the booking, then Stripe is called with idempotency key `refund:<payment_id>:<cents>`; the job tick retries any refund still owed.
- **Webhooks:** `/api/webhooks/stripe` verifies the `Stripe-Signature` header on the raw body against each configured secret (platform and connected-account destinations can have different secrets), records `('stripe', event.id)` in `webhook_events`, and makes every state change conditional, so replays and out-of-order events change nothing. Thin v2 account events and snapshot `account.updated` both trigger a re-fetch of the account's status; the onboarding return page re-fetches too, so status never depends on one event.
- **Dev safety:** only `sk_test_` / `rk_test_` keys are accepted outside production, and the demo shop can never connect Stripe.

## Consequences

- Shops get a full Stripe Dashboard login. They could refund there too; `charge.refunded` keeps Fullcut's record in sync.
- Payment objects live on connected accounts, so every Stripe call for a payment needs the shop's account ID.
- A client holds a slot for up to 30 minutes while paying; abandoned holds free up within a minute of expiry.
- Stripe's fees are the shop's cost and are not shown to the client (the client pays exactly the deposit).
