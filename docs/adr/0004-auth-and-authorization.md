# ADR 0004: Authentication and authorization

- Status: accepted
- Date: 2026-10-19

## Context

Owners and staff sign in to a shared Next.js 16 app (App Router, Cache Components on). Every dashboard page and server action must know who the user is and which shop they act for, and a `staff` member must not reach owner-only settings — even by calling Supabase directly with their own JWT. New owners need a shop created before they are members of anything, so RLS alone cannot let them create it.

## Decision

- **Sessions:** Supabase Auth with `@supabase/ssr` cookie sessions. `proxy.ts` (Next 16's renamed middleware) refreshes the session with `getClaims()` on dashboard/auth routes and redirects signed-out users to `/login?next=…`. Server code verifies identity with `getClaims()` only, never `getSession()`.
- **Cache Components:** reading the session is request-time work. `lib/supabase/server.ts` calls `connection()` before creating the client (the auth client reads the clock), and pages read the session inside `<Suspense>`.
- **Data access layer (`lib/auth/session.ts`):** `getCurrentShop()` resolves `{ userId, role, staffId, shop }` from `shop_members` once per request; `requireShopMember()` / `requireShopOwner()` gate pages. Server actions never accept a `shop_id` from the client; it comes from the session, and writes also filter by it.
- **Two layers of authorization:**
  - App: settings mutations in `lib/shop/settings.ts` check the role (`isOwner`, `canEditSchedule`) and return a friendly error.
  - Database: RLS makes `shops`, `staff` and `services` owner-write; `availability_rules` and `time_off` are writable by owners or by the staff member linked through `shop_members.staff_id` (`is_own_staff()`). Integration tests call the mutations with forged actors to prove RLS still blocks them.
- **Onboarding:** `public.onboard_shop(user_id, payload)` creates shop, owner membership, first staff, services and hours in one transaction. Only `service_role` may execute it; the server action passes the user id from the verified JWT after zod validation. A per-user advisory lock and a membership check stop double submits from creating two shops.
- **Keys:** the browser and user-scoped server clients use the publishable key; the service-role client (`SUPABASE_SECRET_KEY`) is `server-only` and used only for onboarding.
- **Redirects:** `?next=` is accepted only as a same-origin path (`safeRedirectPath`). Auth email links are built from `SITE_URL`, never the request `Host`.

## Consequences

- One login maps to one shop for now (`getCurrentShop` takes the earliest membership). A shop switcher is needed before multi-shop logins.
- Staff invites (owner invites by email, linked to a staff profile) are deferred; staff-role logins currently have to be created by hand.
- Pages behind auth stream their content; the static shell holds only layout chrome.
