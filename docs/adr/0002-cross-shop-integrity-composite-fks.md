# ADR 0002: Cross-shop integrity with composite foreign keys

- Status: accepted
- Date: 2026-10-18

## Context

Every tenant row carries a `shop_id`, and RLS restricts members to their own shop. RLS alone does not stop a row in shop A from _referencing_ a row in shop B. For example, a booking in shop A could point at shop B's staff member. Server code that uses the service role bypasses RLS entirely. A mismatch like that would leak data across tenants and could block another shop's calendar through the `bookings_no_overlap` constraint.

Options considered:

1. **Composite foreign keys**: add `unique (shop_id, id)` to parent tables and reference `(shop_id, child_id)` from children.
2. **Trigger**: a `before insert or update` trigger on each child table that looks up each parent's `shop_id` and raises if it differs.

## Decision

Use composite foreign keys.

- `staff`, `services` and `clients` have `unique (shop_id, id)` (`<table>_shop_id_id_unique`).
- `bookings` references `(shop_id, staff_id)`, `(shop_id, service_id)` and `(shop_id, client_id)` (`bookings_<parent>_same_shop_fk`), with the default `NO ACTION`. Staff, services and clients with bookings cannot be hard-deleted, but deleting a whole shop still cascades.
- `availability_rules` and `time_off` reference `(shop_id, staff_id)` with `on delete cascade`.
- `shop_members` references `(shop_id, staff_id)` with `on delete set null (staff_id)`, so removing a staff profile unlinks the login without touching `shop_id`.

## Consequences

- The guarantee is declarative and covers every write path: the API, the service role, imports and migrations. No procedural code can be forgotten or bypassed.
- Foreign keys are race-free and use indexes Postgres maintains anyway. The extra `unique (shop_id, id)` index also serves `shop_id` lookups.
- Violations raise SQLSTATE `23503` with a named constraint, which the app can map to a clear error.
- Every new child table that references a tenant parent must use the composite form. The data-and-tenancy skill documents this.
- Generated Supabase types list both the simple `shop_id` FK and the composite FK in `Relationships`. That is harmless.
