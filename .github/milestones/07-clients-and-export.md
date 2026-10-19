# Milestone 07 — Clients and data export

**Goal:** a simple client book (search, profile, history, notes) and a one-click export of all shop data. "Your clients stay yours" has to be true in the product, not just the pitch.

**Depends on:** 06
**Skills to read:** `fullcut-data-and-tenancy`

## In scope

- Client list, profile, edit, notes
- Full CSV export (owner only)
- Client data deletion on request

## Out of scope

- Marketing consent management UI beyond showing status (13)
- Import (14)

## Tasks

### 7.1 Client list (`/dashboard/clients`)

- Search by name or phone (normalise the search input), sort by name / last visit / visit count.
- Columns: name, phone, last visit, total visits, no-shows, next booking.
- Paginated or virtualised; backed by a view or query that computes visit stats efficiently.

### 7.2 Client profile (`/dashboard/clients/[id]`)

- Contact details (editable), first source, created date.
- Stats: visits, no-shows, cancellations, average spend, usual interval between visits (simple median for now).
- Booking history (past and upcoming) with status.
- Private notes (e.g. "#2 fade, likes it short on top") — add a `client_notes` table or `notes` column via migration, with RLS.
- "Book again" button → new booking prefilled with their usual service/staff.
- Consent/opt-out status displayed read-only (`marketing_opt_in`, `sms_opted_out`).

### 7.3 Duplicate handling

- When editing a phone number that matches another client, block the save and offer "merge" (move bookings to one client, keep the richer details). Merge is owner-only and logged.

### 7.4 Export (`/dashboard/settings/export`, owner only)

- One click → a ZIP containing `clients.csv`, `services.csv`, `staff.csv`, `bookings.csv`, `availability.csv`, `time_off.csv`.
- Human-readable columns (names, local times with timezone, dollars) **and** IDs for re-import.
- Generated server-side, streamed; works for tens of thousands of bookings.
- Log each export (who, when).
- Add a test that fails if a new tenant table isn't covered by export or explicitly excluded (keep an allowlist), enforcing the skill's rule.

### 7.5 Delete a client

- Owner-only "delete client data": removes contact details and notes, keeps anonymised booking rows (so stats/ML aren't corrupted). Confirm dialog explains this.

## Tests

- Visit stats correctness (completed vs no-show vs cancelled).
- Merge moves all bookings and leaves no orphans.
- Export contents for the seed shop; another shop's data never appears; staff role can't export.
- Deletion anonymises correctly.

## Acceptance criteria

- Owner can find any client in two taps and export everything in one.
- Export opens cleanly in Excel/Google Sheets (UTF-8 with BOM, proper quoting).

## Agent prompt

```
Read .github/AGENTS.md, .github/milestones/07-clients-and-export.md and the
data-and-tenancy skill. Plan the migration (notes, any views), pages and the
export implementation. Wait for my OK, then implement with tests.
```
