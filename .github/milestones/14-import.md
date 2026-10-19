# Milestone 14 — Import from other platforms

**Goal:** a shop switching from Square, Vagaro, Fresha or Booksy brings its clients, services and appointment history in a few minutes, safely, with a preview and an undo. Imported history powers the no-show and due features on day one.

**Depends on:** 07, 13 (sources/consent fields)
**Skills to read:** `fullcut-client-import`, `fullcut-data-and-tenancy`

## Manual steps for the human

- Get real export files from each platform (your own trial account or a friendly shop), anonymise them, and add them as fixtures. Agents must not guess column names.

## In scope

- Generic CSV import with manual column mapping
- Platform mappers for which real samples exist
- Preview, batches, undo, background processing

## Tasks

### 14.1 Migration

- `import_batches` (shop, platform, file name, status, counts, errors summary, created_by, created_at, undone_at) and `import_batch_id` on clients, services and bookings. RLS as usual.

### 14.2 Upload and parse

- Upload page (owner only): choose platform or "Other CSV", upload file (size limit, e.g. 20 MB).
- Parse with a streaming CSV parser; handle BOM, delimiter detection, quoted newlines.
- Store the file temporarily (Supabase Storage, private bucket, auto-delete after 7 days).

### 14.3 Generic mapper (build first)

- Show detected columns with sample values; owner maps each to a Fullcut field (client name, phone, email, service, staff, start time, status, price…) or "ignore".
- Save mappings per shop so a second file maps automatically.

### 14.4 Platform mappers

- One per platform with a real fixture: header-signature detection, mapping, status mapping table, tests against the fixture. Platforms without fixtures fall back to the generic mapper.

### 14.5 Normalise, dedupe, validate

- Exactly as the skill describes (phones to E.164, timezones, cents, statuses, dedupe by phone then email, merge rules).
- Services and staff matched by name to existing ones, or proposed as new.

### 14.6 Preview

- Summary: X new clients, Y merged, Z skipped (with reasons), services/staff to create, bookings by status, date range.
- Table of sample rows and a downloadable "problems.csv".
- Explicit consent note: imported clients won't get marketing texts unless consent is confirmed.

### 14.7 Commit, progress, undo

- Background job processes the batch in chunks with progress shown.
- Imported past bookings: `completed` / `no_show` / `cancelled` only; future bookings imported as `confirmed` but checked against the overlap constraint, with conflicts reported.
- No messages sent during or after import.
- Undo (within 7 days): deletes rows created by the batch, leaves merged clients' original data intact.

## Tests

- All cases listed in the skill.
- Large file (e.g. 50k rows synthetic) completes within a reasonable time and memory.
- Future-booking conflicts reported, not crashing the batch.

## Acceptance criteria

- Importing a realistic file takes under 5 minutes end-to-end including review.
- After import, the due list and client stats reflect the imported history.

## Agent prompt

```
Read .github/AGENTS.md, .github/milestones/14-import.md and the
fullcut-client-import skill. Check which platform fixtures exist in
apps/web/tests/fixtures/imports/. Plan the generic importer first, then
mappers only for platforms with fixtures. Wait for my OK, then implement.
```
