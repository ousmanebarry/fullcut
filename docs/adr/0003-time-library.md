# ADR 0003: Time library for scheduling

- Status: accepted
- Date: 2026-10-18

## Context

The booking engine converts weekly wall-clock availability (e.g. "Tue 09:00–17:00" in `America/Toronto`) into UTC instants for specific dates, and renders slots back in the shop's timezone. Fixed offsets are wrong twice a year, so every conversion needs IANA timezone data and well-defined DST behaviour. Options considered:

- **Luxon** — immutable `DateTime` with first-class IANA zones (via `Intl`), documented behaviour for nonexistent and ambiguous local times, and `getPossibleOffsets()` to detect ambiguity.
- **date-fns v4 + `@date-fns/tz`** — tree-shakeable, but DST gap/overlap handling is less explicit and the `TZDate` wrapper mixes `Date` semantics with zoned semantics.
- **Temporal** — the best long-term API, but Node 24 does not ship it unflagged and the polyfill is large.

## Decision

- Use **Luxon**. Only `apps/web/lib/time/` imports it; everything else uses that wrapper so the library can be swapped (e.g. for Temporal) in one place.
- Instants are branded epoch-millisecond numbers (`Instant`). Local values are branded strings: `LocalDate` (`YYYY-MM-DD`), `LocalTime` (`HH:mm[:ss]`), and `TimeZone` (validated IANA name). ISO strings only appear at the API/DB edge.
- Durations (service length, buffer, lead time) are absolute minutes. The booking horizon is calendar days in the shop's timezone.
- DST rules:
  - A local time inside a spring-forward gap moves forward by the gap (02:30 → 03:30).
  - An ambiguous local time used as a window endpoint resolves to the earlier offset.
  - Inside an availability window, the repeated fall-back hour is real working time, so both occurrences are offered as distinct slots. Their labels include the zone abbreviation (e.g. `1:30 AM EDT` / `1:30 AM EST`) so no two labels are identical.
- Timezone data comes from Node's built-in full ICU.

## Consequences

- One small dependency (`luxon`, plus `@types/luxon`).
- ICU timezone data updates arrive with Node upgrades; keep Node current so rule changes are picked up.
- Moving to Temporal later means rewriting `lib/time/` only.
