-- Atomic shop setup helpers. onboard_shop runs as the service role (the user is not a member yet);
-- the other two run as the caller, so RLS decides who may change what.

create function public.onboard_shop(p_user_id uuid, p_payload jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_shop_id  uuid;
  v_staff_id uuid;
begin
  -- Serialise per user so a double submit cannot create two shops.
  perform pg_advisory_xact_lock(hashtextextended('fullcut.onboard:' || p_user_id::text, 0));

  if exists (select 1 from public.shop_members where user_id = p_user_id) then
    raise exception 'onboarding_already_member' using errcode = 'P0001';
  end if;

  if jsonb_array_length(coalesce(p_payload -> 'services', '[]'::jsonb)) = 0 then
    raise exception 'onboarding_no_services' using errcode = 'P0001';
  end if;

  insert into public.shops (name, slug, timezone, currency)
  values (
    p_payload -> 'shop' ->> 'name',
    p_payload -> 'shop' ->> 'slug',
    p_payload -> 'shop' ->> 'timezone',
    coalesce(p_payload -> 'shop' ->> 'currency', 'CAD')
  )
  returning id into v_shop_id;

  insert into public.staff (shop_id, display_name)
  values (v_shop_id, p_payload -> 'staff' ->> 'display_name')
  returning id into v_staff_id;

  insert into public.shop_members (shop_id, user_id, role, staff_id)
  values (v_shop_id, p_user_id, 'owner', v_staff_id);

  insert into public.services (shop_id, name, duration_minutes, buffer_minutes, price_cents, sort_order)
  select
    v_shop_id,
    s ->> 'name',
    (s ->> 'duration_minutes')::int,
    coalesce((s ->> 'buffer_minutes')::int, 0),
    (s ->> 'price_cents')::int,
    (ord - 1)::int
  from jsonb_array_elements(p_payload -> 'services') with ordinality as t (s, ord);

  insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
  select v_shop_id, v_staff_id, (r ->> 'weekday')::int, (r ->> 'start_time')::time, (r ->> 'end_time')::time
  from jsonb_array_elements(coalesce(p_payload -> 'rules', '[]'::jsonb)) as t (r);

  return v_shop_id;
end;
$$;

revoke execute on function public.onboard_shop(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.onboard_shop(uuid, jsonb) to service_role;

-- Sets sort_order to each id's position in p_service_ids; ids outside the shop are ignored.
create function public.reorder_services(p_shop_id uuid, p_service_ids uuid[])
returns void
language sql
set search_path = ''
as $$
  update public.services s
  set sort_order = (x.ord - 1)::int
  from unnest(p_service_ids) with ordinality as x (id, ord)
  where s.id = x.id
    and s.shop_id = p_shop_id;
$$;

revoke execute on function public.reorder_services(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_services(uuid, uuid[]) to authenticated, service_role;

-- Replaces a staff member's weekly rules in one transaction.
create function public.replace_availability_rules(p_staff_id uuid, p_rules jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_shop_id uuid;
begin
  select shop_id into v_shop_id from public.staff where id = p_staff_id;
  if v_shop_id is null then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;

  -- Without this, a forbidden caller clearing hours would silently delete nothing and "succeed".
  if not (public.is_shop_owner(v_shop_id) or public.is_own_staff(v_shop_id, p_staff_id)) then
    raise exception 'availability_rules_forbidden' using errcode = '42501';
  end if;

  delete from public.availability_rules where staff_id = p_staff_id;

  insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
  select v_shop_id, p_staff_id, (r ->> 'weekday')::int, (r ->> 'start_time')::time, (r ->> 'end_time')::time
  from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) as t (r);
end;
$$;

revoke execute on function public.replace_availability_rules(uuid, jsonb) from public, anon;
grant execute on function public.replace_availability_rules(uuid, jsonb) to authenticated, service_role;
