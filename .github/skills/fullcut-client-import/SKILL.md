---
name: fullcut-client-import
description: Use when building or fixing Fullcut's data migration — importing clients, services or appointment history from Square, Vagaro, Fresha, Booksy or generic CSV exports, column mapping, phone normalisation, deduplication, import previews or undo.
---

# Fullcut: importing from other booking platforms

One-click migration is a key reason a shop switches to Fullcut. Imported history also gives the no-show and "who's due" features data on day one. An import must be **safe** (previewable, undoable), **honest** (never invent consent), and **forgiving** (messy files are normal).

## Do not guess export formats

Competitor export formats differ and change over time. **Do not invent column names.** Before writing a mapper for a platform:

1. Get a real sample export from that platform (ask the human for one), and anonymise it.
2. Save it as a fixture in `apps/web/tests/fixtures/imports/<platform>/`.
3. Write the mapper and tests against that fixture.

Until a real sample exists, only the generic CSV importer (user maps columns manually) should be offered.

## Architecture

```
upload ─► parse (CSV) ─► detect platform by header signature
       ─► platform mapper (or manual column mapping)
       ─► normalise + validate each row ─► dedupe
       ─► PREVIEW (counts, sample rows, problems) ─► user confirms
       ─► write in one import batch ─► report
```

- One mapper per platform in `apps/web/lib/import/mappers/<platform>.ts`, each converting rows into a shared `ImportedClient` / `ImportedService` / `ImportedBooking` shape (validated with zod).
- Unknown extra columns are ignored, not fatal. Missing required columns produce a clear error naming the column.
- Parse in a streaming or chunked way; shops may have tens of thousands of rows.
- Encoding: handle UTF-8 with or without BOM; detect delimiter (comma, semicolon, tab).

## Normalisation

- Names: trim, collapse whitespace; keep original casing.
- Phones: `libphonenumber-js` with the shop's country as default region → E.164. Invalid numbers are kept as `null` with a warning row in the report, not dropped silently.
- Emails: trim, lowercase, basic validation.
- Money: parse to integer cents in the shop's currency; reject ambiguous formats instead of guessing.
- Dates/times: parse in the **shop's timezone** unless the export clearly includes an offset; store as `timestamptz`.
- Imported booking statuses map to Fullcut's (`completed`, `no_show`, `cancelled`); unmappable statuses are skipped and reported. Imported past bookings never become `confirmed`.

## Deduplication

- Within the file and against existing clients, match on `(shop_id, phone_e164)`, then on email.
- On a match, merge: fill empty fields, never overwrite non-empty Fullcut data without showing it in the preview.
- Report every merge in the preview.

## Consent (non-negotiable)

- Imported clients get `marketing_opt_in = false`, **unless** the export explicitly contains a consent field and the human has confirmed it represents valid consent. Record `marketing_opt_in_method = 'import:<platform>'` and the original consent date when available.
- Never send any message as a side effect of an import.

## Batches and undo

- Each import creates an `import_batches` row (shop, platform, file name, counts, created by, created at), and every inserted row stores its `import_batch_id`.
- "Undo import" deletes rows created by that batch (not rows that were merged into existing records) within a reasonable window, after confirmation.
- Imports run as a background job for large files; the UI shows progress and the final report.
- The `import_batches` table follows the tenancy rules in `fullcut-data-and-tenancy`.

## Source attribution

Imported clients get `first_source = 'import:<platform>'` so analytics do not count them as new clients acquired through Fullcut.

## Tests that must exist

- Each platform mapper against its real anonymised fixture.
- Messy CSV: BOM, semicolons, blank lines, extra columns, missing optional fields.
- Phone normalisation incl. invalid numbers.
- Dedupe within file and against existing clients.
- Timezone handling for imported booking times.
- Consent defaults to false; no messages sent during import.
- Undo removes exactly the batch's created rows.
