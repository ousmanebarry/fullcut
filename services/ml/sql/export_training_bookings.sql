-- Labelled-bookings export for `python -m fullcut_ml.retrain`. Run against production with a
-- read-only role:
--   psql "$READONLY_DB_URL" --csv -f sql/export_training_bookings.sql > data/bookings.csv
-- Every booking is exported (history features need cancellations too); demo shops never are.
-- No names, phones or emails: only ids, times and outcomes.
select
  b.id as booking_id,
  b.shop_id,
  b.client_id,
  b.created_at,
  b.starts_at,
  b.ends_at,
  b.status,
  b.source,
  b.price_cents,
  b.cancelled_at,
  b.client_confirmed_at,
  b.confirmation_status,
  b.release_reason,
  b.risk_tier,
  s.timezone as shop_timezone
from public.bookings b
join public.shops s on s.id = b.shop_id
where not public.is_demo_shop(b.shop_id)
order by b.starts_at
