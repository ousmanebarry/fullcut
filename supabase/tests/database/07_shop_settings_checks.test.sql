begin;
select plan(12);

select tests.seed_two_shops();

select throws_ok(
  $$update public.shops set slug = 'Bad_Slug' where id = tests.id('shop_a')$$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_slug_format"',
  'slug with uppercase or underscores is rejected'
);
select throws_ok(
  $$update public.shops set slug = 'ab' where id = tests.id('shop_a')$$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_slug_format"',
  'slug shorter than 3 characters is rejected'
);
select throws_ok(
  $$update public.shops set slug = 'trailing-' where id = tests.id('shop_a')$$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_slug_format"',
  'slug with a trailing hyphen is rejected'
);
select throws_ok(
  $$update public.shops set name = '   ' where id = tests.id('shop_a')$$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_name_length"',
  'blank shop name is rejected'
);
select throws_ok(
  $$update public.shops set slot_step_minutes = 7 where id = tests.id('shop_a')$$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_slot_step_valid"',
  'unsupported slot step is rejected'
);
select throws_ok(
  $$update public.shops set min_lead_minutes = -1 where id = tests.id('shop_a')$$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_min_lead_valid"',
  'negative lead time is rejected'
);
select throws_ok(
  $$update public.shops set max_horizon_days = 0 where id = tests.id('shop_a')$$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_max_horizon_valid"',
  'zero-day horizon is rejected'
);
select throws_ok(
  $$update public.shops set phone = '416-555-0100' where id = tests.id('shop_a')$$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_phone_e164_format"',
  'non-E.164 shop phone is rejected'
);
select throws_ok(
  $$update public.shops set logo_url = 'http://example.com/logo.png' where id = tests.id('shop_a')$$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_logo_url_https"',
  'non-https logo URL is rejected'
);
select throws_ok(
  $$update public.shops set currency = 'cad' where id = tests.id('shop_a')$$,
  '23514',
  'new row for relation "shops" violates check constraint "shops_currency_format"',
  'lowercase currency code is rejected'
);
select lives_ok(
  $$update public.shops
    set slot_step_minutes = 30, min_lead_minutes = 0, max_horizon_days = 365, phone = '+14165550100',
        logo_url = 'https://example.com/logo.png', about_text = 'Fades and beards.', booking_page_enabled = false
    where id = tests.id('shop_a')$$,
  'valid settings are accepted'
);
select results_eq(
  $$select slot_step_minutes, min_lead_minutes, max_horizon_days from public.shops where id = tests.id('shop_b')$$,
  $$values (15, 120, 60)$$,
  'booking rules default to 15 min step, 120 min lead, 60 day horizon'
);

select * from finish();
rollback;
