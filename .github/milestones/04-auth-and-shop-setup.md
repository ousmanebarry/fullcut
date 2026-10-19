# Milestone 04 — Auth and shop setup

**Goal:** an owner can sign up, create their shop, and set up staff, services, working hours, time off and booking settings. After this, a real shop exists without touching the seed file.

**Depends on:** 02, 03
**Skills to read:** `fullcut-data-and-tenancy`

## In scope

- Supabase Auth in Next.js (server-side sessions)
- Onboarding flow and settings pages
- Shop settings migration

## Out of scope

- Calendar and bookings UI (06), payments setup (10), messaging settings (09)

## Tasks

### 4.1 Auth wiring

1. Use `@supabase/ssr` with cookie-based sessions: browser client, server client, and middleware that refreshes sessions. Check current Supabase docs for the Next.js App Router pattern.
2. Pages: `/login`, `/signup`, `/auth/callback`, sign out. Email + password first; magic link optional.
3. Protect everything under `/dashboard` (redirect to `/login`).
4. A server helper `requireShopMember(shopId)` / `getCurrentShop()` used by every dashboard page and action.

### 4.2 Shop settings migration

`supabase migration new shop_settings`. Add to `shops` (or a `shop_settings` table, 1:1):

- `slot_step_minutes` (default 15), `min_lead_minutes` (120), `max_horizon_days` (60)
- `booking_page_enabled` (bool), `about_text`, `address`, `phone`, `logo_url` (nullable)
- Same RLS rules (owners write, members read). Regenerate types.

### 4.3 Onboarding wizard (`/onboarding`)

Shown after first sign-up when the user belongs to no shop:

1. Shop name → slug suggested from name (editable, validated: lowercase, a–z, 0–9, hyphens, unique, not reserved like `dashboard`, `api`, `login`).
2. Timezone (default from browser, editable list of IANA zones) and currency (default CAD).
3. First staff member (pre-filled with the owner's name).
4. First 1–3 services (name, duration, buffer, price).
5. Working hours for that staff (weekday toggles + start/end).

- Creating the shop and owner membership happens in one server action/transaction. Insert via the service role on the server (the user isn't a member yet, so RLS would block it), validating everything with zod.

### 4.4 Settings pages (`/dashboard/settings/...`)

- **Shop:** name, slug (warn that changing it breaks old links), timezone, contact info, about text.
- **Staff:** add, edit, deactivate (never hard-delete staff with bookings).
- **Services:** add, edit, deactivate, reorder; prices entered as dollars, stored as cents.
- **Hours:** per staff weekly rules, multiple windows per day allowed (e.g. lunch break).
- **Time off:** per staff, date/time ranges, list upcoming.
- **Booking rules:** slot step, lead time, horizon.
- Owner-only pages hidden from `staff` role and blocked on the server.

### 4.5 Invite staff logins (optional in this milestone)

- Owner invites by email → membership with role `staff`, linked to a staff profile. Can be deferred; note it if skipped.
- **Deferred.** Staff-role logins and RLS for them exist (staff edit only their own hours and time off), but there is no invite flow yet; the seed has one staff login for testing. See ADR 0004.

### 4.6 UX details

- Mobile-friendly forms, inline validation messages, saving states, toasts on success.
- Empty states that tell the owner what to do next ("Add your first service").

## Tests

- Unit: slug validation, money input parsing (dollars → cents), hours form → rules conversion.
- Integration: onboarding creates shop + membership + staff + services + rules atomically; failure leaves nothing behind.
- Authorization: a `staff` member can't reach owner-only actions; a user can't edit another shop by changing IDs in requests.
- e2e (Playwright, mobile viewport): sign up → onboarding → land on dashboard.

## Acceptance criteria

- A brand-new user can go from sign-up to a fully configured shop in under 3 minutes.
- All server actions validate input and check membership server-side.

## Agent prompt

```
Read .github/AGENTS.md and .github/milestones/04-auth-and-shop-setup.md and the
skills it lists. Check the current Supabase docs for the Next.js App Router
auth setup before planning. Give me a plan (routes, server actions, migration,
components), wait for my OK, then implement in small commits with tests.
```
