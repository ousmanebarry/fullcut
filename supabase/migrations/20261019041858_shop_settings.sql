-- Shop profile and booking-rule settings, plus owner-controlled service ordering.

alter table public.shops
  add column slot_step_minutes     int not null default 15,
  add column min_lead_minutes      int not null default 120,
  add column max_horizon_days      int not null default 60,
  add column booking_page_enabled  boolean not null default true,
  add column about_text            text,
  add column address               text,
  add column phone                 text,
  add column logo_url              text,
  add constraint shops_name_length check (char_length(btrim(name)) between 1 and 80),
  add constraint shops_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 63),
  add constraint shops_currency_format check (currency ~ '^[A-Z]{3}$'),
  add constraint shops_slot_step_valid check (slot_step_minutes in (5, 10, 15, 20, 30, 60)),
  add constraint shops_min_lead_valid check (min_lead_minutes between 0 and 10080),
  add constraint shops_max_horizon_valid check (max_horizon_days between 1 and 365),
  add constraint shops_about_text_length check (char_length(about_text) <= 2000),
  add constraint shops_address_length check (char_length(address) <= 300),
  add constraint shops_phone_e164_format check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  add constraint shops_logo_url_https check (logo_url ~ '^https://' and char_length(logo_url) <= 2048);

alter table public.services
  add column sort_order int not null default 0;

update public.services s
set sort_order = ordered.position
from (
  select id, (row_number() over (partition by shop_id order by created_at, id) - 1)::int as position
  from public.services
) ordered
where s.id = ordered.id;

create index services_shop_sort_order_idx on public.services (shop_id, sort_order);
