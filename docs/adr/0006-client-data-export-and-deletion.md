# ADR 0006: Client data export, merge and deletion

- Status: accepted
- Date: 2026-10-19

## Context

"Your clients stay yours" has to hold in the product: owners must be able to take all their data with them, merge duplicate clients, and forget a client who asks. Bookings reference clients with a restricting composite foreign key, and booking history feeds stats and the future no-show model.

## Decision

- **Export:** an owner-only `POST /dashboard/settings/export/download` streams a ZIP (`fflate`, small and dependency-free) of CSVs. It reads with the owner's own session (RLS applies) and also filters by `shop_id`, paging 1000 rows at a time by keyset `(created_at|starts_at, id)`, so memory stays flat for tens of thousands of bookings. CSVs are hand-written: UTF-8 BOM, CRLF, RFC 4180 quoting, and a `'` prefix on free text starting with `= + - @` (spreadsheet formula injection). Columns include IDs, shop-local times with a `timezone` column (plus UTC for bookings and time off), and dollars with a currency. POST plus an Origin check keeps prefetches and cross-site forms from starting an export.
- **Coverage rule:** every table with a `shop_id` is listed in `EXPORT_SOURCES` or in `EXPORT_EXCLUDED` with a reason (`lib/export/tables.ts`); `tests/db/export-coverage.test.ts` fails otherwise. Excluded: `booking_links` (token hashes) and `shop_members` (login accounts).
- **Audit log:** `audit_events` (append-only, owner read/insert, actor stamped from the session by a trigger) records exports, merges and deletions with IDs and counts only, never personal data. It is exported as `activity.csv`.
- **Deletion = anonymisation:** `anonymise_client()` clears contact details, consent and private notes, nulls free-text notes on the client's bookings, revokes their manage links, and sets `anonymised_at`. Booking rows stay. It refuses while the client has upcoming bookings.
- **Merge:** `merge_clients()` (owner-only) moves bookings and notes, fills empty fields from the merged record, keeps the latest marketing opt-in and any SMS opt-out, deletes the merged row, then applies the contact details being saved.
- Both functions are `security definer` (manage links and the audit log have no client-writable policies) with explicit owner checks and every statement filtered by the checked shop. Client row deletes are now owner-only in RLS; staff keep read and edit.

## Consequences

- Anonymised clients stay in the database as "Deleted client"; stats and ML keep their history, but the data can't be restored.
- A public booking that arrives for a client mid-merge waits on the row lock and then fails; the client simply retries.
- Adding a tenant table now also means deciding how it is exported.
