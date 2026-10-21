# Milestone 05 — Public booking page

**Goal:** a client opens `fullcut.ca/<shop-slug>` on their phone, picks a service, a stylist and a time, enters their name and phone, and gets a confirmed booking — in three steps, no account, no app. They can later view or cancel it from a private link.

**Depends on:** 03, 04
**Skills to read:** `fullcut-booking-engine`, `fullcut-data-and-tenancy`

## In scope

- Public pages, availability API, booking creation API
- Manage-booking page via signed link
- Basic abuse protection

## Out of scope

- Waitlist (10), SMS confirmations (09), risk scoring (12)
- Marketing opt-in checkbox can be added now but nothing uses it until 13

## Tasks

### 5.1 Public data access

- Server-side loader `getPublicShop(slug)` returning only: shop name, about, address, logo, timezone, active services (name, duration, price), active staff (display name). Uses the service role on the server; never exposes IDs or data beyond this.
- 404 page for unknown or disabled shops.

### 5.2 Availability endpoint

- `GET /api/public/[slug]/availability?serviceId=&staffId=any|<id>&from=&to=` (max 7 days per request).
- Server loads rules, time off, active bookings for the range; calls `generateSlots`; returns `[{ startsAt, staffId, label }]`.
- Cache-friendly but short-lived (slots change); never cache across shops.

### 5.3 Booking page UI (`app/[shopSlug]/page.tsx`)

Steps on one page, mobile-first:

1. **Service** — cards with name, duration, price.
2. **Time** — staff selector ("Anyone" default), horizontal day picker, time chips grouped Morning / Afternoon / Evening, "next available" shortcut, loading skeletons, empty-day message with "jump to next open day".
3. **Your details** — name, mobile number (formatted as typed, validated to E.164 with the shop's country), optional email, optional notes; summary of service, staff, local time and price; Confirm.

- Shop branding at top (name, logo). Times always shown in the shop's timezone with the zone noted if the client's browser timezone differs.
- Accessible: keyboard navigation, labelled inputs, visible focus, large tap targets, works at 360px width.

### 5.4 Create booking endpoint

`POST /api/public/[slug]/bookings`, following the skill's order exactly:

1. zod-validate the body; resolve shop by slug server-side.
2. Recompute times with `computeBookingTimes`; run `validateRequestedStart` for friendly errors.
3. Find-or-create client by `(shop_id, phone_e164)`; update name/email if empty.
4. Insert with status `confirmed` and `source` from a `?src=` param if present, else `direct`.
5. On SQLSTATE `23P01` → 409 with fresh nearby slots.
6. Return booking reference + manage link.

### 5.5 Confirmation and manage-booking

- Confirmation screen: details, "Add to calendar" (.ics download), manage link.
- Manage link: `/b/<token>` where the token is a signed, unguessable value (HMAC of booking id + expiry, or a random token stored hashed in a `booking_links` table — pick one, note in ADR).
- Manage page: view details, cancel (respects a shop "cancel until X hours before" setting; default 2 h), and reschedule (pick a new slot; same conflict handling).

### 5.6 Abuse protection

- Honeypot field + per-IP and per-phone rate limits on booking creation (e.g. 5/hour). A simple Postgres-backed or in-memory limiter is fine for now; note the limitation.
- Cap future active bookings per phone per shop (default 3).

## Tests

- API: validation errors, unknown shop, slot outside hours, 409 on conflict with suggestions, client find-or-create, rate limit.
- Token: tampered/expired tokens rejected; can't access another booking.
- e2e (mobile viewport): full happy path; conflict path (two browsers grab the same slot, second sees "just taken"); cancel via manage link frees the slot.
- Accessibility check (axe via Playwright) on the booking page.

## Acceptance criteria

- Booking takes ≤ 3 screens on a phone.
- No other client's data is ever returned by public endpoints (review responses).
- Lighthouse mobile performance and accessibility ≥ 90 on the booking page with seed data.

## Agent prompt

```
Read .github/AGENTS.md, .github/milestones/05-public-booking-page.md and the
skills it lists. Plan the routes, API contracts (request/response shapes),
components and the manage-link approach. Wait for my OK. Implement API +
tests first, then the UI, then e2e tests. Report Lighthouse and axe results.
```
