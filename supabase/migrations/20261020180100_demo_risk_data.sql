-- Demo data for no-show risk (milestone 12): realistic lead times, a few habitual no-showers whose
-- history the scoring service can learn from, and upcoming bookings in each confirmation state.
-- Synthetic: good for showing the feature, never for reporting model metrics.

alter function private.reset_demo_shop() rename to reset_demo_shop_waitlist;

create function private.reset_demo_shop()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_config    private.demo_config;
  v_habitual  uuid[];
begin
  perform private.reset_demo_shop_waitlist();

  select * into v_config from private.demo_config;
  if not found then
    return;
  end if;

  v_habitual := array(
    select md5(v_config.shop_id::text || ':client:' || n)::uuid from unnest(array[2, 6, 13, 21, 27]) as n
  );

  update public.shops set risk_actions_enabled = true where id = v_config.shop_id;

  -- Lead times: about a third booked within two days, most within two weeks, the rest weeks ahead.
  update public.bookings b set created_at = least(now(), b.starts_at - make_interval(hours => l.hours::int))
  from (
    select id,
      case
        when h % 100 < 35 then 2 + (h / 100) % 46
        when h % 100 < 75 then 72 + (h / 100) % 200
        else 336 + (h / 100) % 600
      end as hours
    from (select id, abs(hashtext(id::text))::bigint as h from public.bookings where shop_id = v_config.shop_id) as x
  ) as l
  where b.id = l.id;

  -- Outcomes the model can learn: habitual no-showers miss about half, long lead times miss more.
  update public.bookings b set status = case
    when abs(hashtext(b.id::text || ':show')) % 100 < case
      when b.client_id = any(v_habitual) then 55
      when b.starts_at - b.created_at > interval '14 days' then 14
      else 4
    end then 'no_show'
    else 'completed'
  end
  where b.shop_id = v_config.shop_id and b.status in ('completed', 'no_show');

  -- Upcoming bookings of habitual no-showers show each confirmation state.
  update public.bookings set
    confirmation_status = 'requested',
    confirmation_due_at = starts_at - interval '24 hours'
  where shop_id = v_config.shop_id
    and status = 'confirmed'
    and client_id = any(v_habitual)
    and starts_at > now() + interval '30 hours'
    and starts_at < now() + interval '5 days';

  update public.bookings set
    confirmation_status = 'unconfirmed',
    confirmation_due_at = starts_at - interval '24 hours'
  where id = (
    select id from public.bookings
    where shop_id = v_config.shop_id
      and status = 'confirmed'
      and client_id = any(v_habitual)
      and starts_at > now() + interval '2 hours'
      and starts_at <= now() + interval '24 hours'
    order by starts_at
    limit 1
  );

  update public.bookings set
    status = 'cancelled',
    cancelled_by = 'shop',
    cancel_reason = 'Not confirmed in time',
    confirmation_status = 'released',
    release_reason = 'unconfirmed',
    confirmation_due_at = starts_at - interval '24 hours'
  where id = (
    select id from public.bookings
    where shop_id = v_config.shop_id
      and confirmation_status = 'requested'
    order by starts_at desc
    limit 1
  );
end;
$$;

revoke execute on function private.reset_demo_shop() from public, anon, authenticated;
revoke execute on function private.reset_demo_shop_waitlist() from public, anon, authenticated;
