# ADR 0009: Waitlist refill

- Status: accepted
- Date: 2026-10-20

## Context

When a booked slot frees up, Fullcut texts matching waitlisted clients and the first to tap books it (milestone 10). This must never double-book, never text at night or without the client's request, survive concurrent ticks and claims, and leave the app unchanged for shops that keep it off.

## Decision

- **Freed-slot queue:** a `bookings` trigger (`private.queue_freed_slot`) inserts a `freed_slots` row in the same transaction when a confirmed booking is cancelled or moved, if the shop has the waitlist on and the old start is more than the minimum notice away. The row holds only the freed staff and time (never the reason), so milestone 12's release can reuse it. `freed_slots` also holds the refill state (`pending` → `offering` → `filled` / `exhausted` / `dropped` / `cancelled`, `wave`, `next_run_at`).
- **Job:** the tick runs `runWaitlistBatch` before the message worker, so offers go out in the same tick. It expires stale offers and entries (`expire_waitlist`), claims due rows with `claim_due_freed_slots` (`SKIP LOCKED`, a 5-minute stale lock), then per slot: drop if inside the minimum notice; wait while a wave is open; during quiet hours wait for 09:00, or drop if 09:00 is past the notice; otherwise match and send the next wave via `create_slot_offers`.
- **Matching** (`lib/waitlist/match.ts`, pure) re-runs `generateSlots` for the freed staff and day and keeps starts inside the freed time, so an offer is always a time the booking page would show. Specific-staff entries come before any-staff, then oldest first. Clients who opted out, have an open offer, were offered this slot in an earlier wave, already book that day, or are at the per-phone booking cap are skipped.
- **One outbox:** `scheduled_messages` now belongs to a booking, a waitlist entry (`waitlist_joined`) or an offer (`waitlist_offer`). Offers are never sent or deferred in quiet hours. Claim and view/leave tokens are issued at send time and only their SHA-256 is stored (ADR 0005).
- **Claims** go through `claim_slot_offer`, which inserts via `private.insert_public_booking` (the body of `create_public_booking`, which is now a wrapper), so the per-phone cap and `bookings_no_overlap` apply exactly as on the booking page. Locks are taken in the same order as other writers (staff advisory lock, refill, entry, offer). The winner's offer becomes `claimed`; the rest of the wave becomes `taken` and their entries stay active. A confirmed booking that overlaps an open offer withdraws it (`private.withdraw_overlapping_offers`).
- **Links:** `/w/<token>` shows the offer and claims only on POST, because SMS link previews fetch with GET. `/wl/<token>` views or leaves an entry. Both send `no-referrer` and `no-store`.
- **Consent:** an entry exists only with `offers_requested_at` (ticked box online, or staff confirming the client asked). STOP and anonymising cancel the client's active entries by trigger.

## Consequences

- One refill per freed slot: if a short service claims part of a longer gap, the rest is not offered again.
- A failed offer text is not retried (its token was already issued); the next wave takes over.
- The e2e test drives the wave through `create_slot_offers` directly because log mode hides tokens and the job respects quiet hours; `tests/db/waitlist-refill.test.ts` covers the job itself.
- DB integration test files now run one at a time, since both workers claim due rows database-wide.
