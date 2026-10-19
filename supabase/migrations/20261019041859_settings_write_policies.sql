-- Settings writes by role: owners manage staff and services; a staff-role member may manage
-- only their own working hours and time off (linked through shop_members.staff_id).

create function public.is_own_staff(p_shop_id uuid, p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shop_members m
    where m.shop_id = p_shop_id
      and m.user_id = (select auth.uid())
      and m.staff_id = p_staff_id
  );
$$;

revoke execute on function public.is_own_staff(uuid, uuid) from public, anon;
grant execute on function public.is_own_staff(uuid, uuid) to authenticated, service_role;

-- staff ----------------------------------------------------------------------

drop policy staff_members_all on public.staff;

create policy staff_select_members on public.staff
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy staff_insert_owners on public.staff
  for insert to authenticated
  with check (public.is_shop_owner(shop_id));

create policy staff_update_owners on public.staff
  for update to authenticated
  using (public.is_shop_owner(shop_id))
  with check (public.is_shop_owner(shop_id));

create policy staff_delete_owners on public.staff
  for delete to authenticated
  using (public.is_shop_owner(shop_id));

-- services -------------------------------------------------------------------

drop policy services_members_all on public.services;

create policy services_select_members on public.services
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy services_insert_owners on public.services
  for insert to authenticated
  with check (public.is_shop_owner(shop_id));

create policy services_update_owners on public.services
  for update to authenticated
  using (public.is_shop_owner(shop_id))
  with check (public.is_shop_owner(shop_id));

create policy services_delete_owners on public.services
  for delete to authenticated
  using (public.is_shop_owner(shop_id));

-- availability_rules ---------------------------------------------------------

drop policy availability_rules_members_all on public.availability_rules;

create policy availability_rules_select_members on public.availability_rules
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy availability_rules_insert_owner_or_self on public.availability_rules
  for insert to authenticated
  with check (public.is_shop_owner(shop_id) or public.is_own_staff(shop_id, staff_id));

create policy availability_rules_update_owner_or_self on public.availability_rules
  for update to authenticated
  using (public.is_shop_owner(shop_id) or public.is_own_staff(shop_id, staff_id))
  with check (public.is_shop_owner(shop_id) or public.is_own_staff(shop_id, staff_id));

create policy availability_rules_delete_owner_or_self on public.availability_rules
  for delete to authenticated
  using (public.is_shop_owner(shop_id) or public.is_own_staff(shop_id, staff_id));

-- time_off -------------------------------------------------------------------

drop policy time_off_members_all on public.time_off;

create policy time_off_select_members on public.time_off
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy time_off_insert_owner_or_self on public.time_off
  for insert to authenticated
  with check (public.is_shop_owner(shop_id) or public.is_own_staff(shop_id, staff_id));

create policy time_off_update_owner_or_self on public.time_off
  for update to authenticated
  using (public.is_shop_owner(shop_id) or public.is_own_staff(shop_id, staff_id))
  with check (public.is_shop_owner(shop_id) or public.is_own_staff(shop_id, staff_id));

create policy time_off_delete_owner_or_self on public.time_off
  for delete to authenticated
  using (public.is_shop_owner(shop_id) or public.is_own_staff(shop_id, staff_id));
