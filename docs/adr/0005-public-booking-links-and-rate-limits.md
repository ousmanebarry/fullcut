# ADR 0005: Public booking links, write path and rate limits

- Status: accepted
- Date: 2026-10-19

## Context

Clients book on `/<shopSlug>` without an account and later view, cancel or reschedule from a private link. Public routes run with the service role, so every check that RLS would normally do has to be explicit, and the write path has to be safe against double submits and abuse (bots, one phone booking out a whole week).

## Decision

- **Manage links:** `/b/<token>` where the token is 32 random bytes (base64url). Only its SHA-256 hex digest is stored, in `booking_links` (RLS on, no policies, no client-role grants). A link expires 7 days after the appointment and can be revoked (`revoked_at`). Unknown, tampered, expired and revoked tokens all get the same "link not valid" response, so a link never reveals whether a booking exists. Rejected alternative: HMAC(booking id + expiry) — stateless, but needs a new long-lived secret and a single link cannot be revoked.
- **Write path:** `public.create_public_booking(...)` (service role only) takes an advisory lock per (shop, phone), cancels expired `pending` holds for the staff member, upserts the client on `clients_shop_phone_unique` (fills an empty name/email, never withdraws marketing consent), enforces `shops.max_active_bookings_per_phone` (SQLSTATE `FC001`), inserts the `confirmed` booking and its manage link — all in one transaction. Times and price are still computed in TypeScript (`computeBookingTimes`) from server-loaded rows; overlaps still surface as `23P01` from `bookings_no_overlap`.
- **Rate limits:** `public.hit_rate_limit(key, window_seconds, max)` counts hits per fixed window in `public_rate_limits`. Keys are SHA-256 hashes (`ip:…`, `phone:<shop>:…`), never raw IPs or phone numbers. Defaults: 5 booking attempts per phone per shop per hour, 10 per IP per hour, 20 manage actions per IP per hour.
- **Honeypot:** a hidden `website` field; any value rejects the request with a generic validation error.

## Consequences

- Fixed windows allow up to 2× the limit across a window boundary; acceptable for abuse protection, not for billing.
- The client IP comes from `x-forwarded-for` / `x-real-ip`, which is only trustworthy behind a proxy that sets it (Vercel). Self-hosting needs the proxy configured to overwrite these headers.
- Loopback addresses are treated as "no IP" (only the per-phone limit applies), since in local dev every request arrives as `::1`.
- Old rate-limit windows are pruned opportunistically (~1% of hits) rather than by a scheduled job.
- Service and staff ids are exposed to the public page because the APIs address them; shop ids, client data and other bookings never are.
