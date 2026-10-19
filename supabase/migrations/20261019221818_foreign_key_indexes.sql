-- Covering indexes for foreign keys (Supabase performance advisor: unindexed_foreign_keys).
-- A (shop_id, x_id) index covers both the composite same-shop FK and the plain shop_id FK, so
-- cascading deletes of staff, clients, services, bookings and users never scan whole tables.

create index availability_rules_shop_staff_idx on public.availability_rules (shop_id, staff_id);
create index time_off_shop_staff_idx on public.time_off (shop_id, staff_id);

create index bookings_shop_staff_idx on public.bookings (shop_id, staff_id);
create index bookings_shop_client_idx on public.bookings (shop_id, client_id);
create index bookings_shop_service_idx on public.bookings (shop_id, service_id);

create index booking_links_shop_booking_idx on public.booking_links (shop_id, booking_id);

create index client_notes_shop_client_idx on public.client_notes (shop_id, client_id);
create index client_notes_author_user_id_idx on public.client_notes (author_user_id);

create index audit_events_actor_user_id_idx on public.audit_events (actor_user_id);

create index shop_members_shop_staff_idx on public.shop_members (shop_id, staff_id);
create index shop_members_user_id_idx on public.shop_members (user_id);

create index demo_config_owner_user_id_idx on private.demo_config (owner_user_id);
