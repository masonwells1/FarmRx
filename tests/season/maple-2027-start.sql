-- Canonical January-only starting state for the continuous Maple Ridge 2027 proof.
-- Apply only to a freshly reset disposable local database. Later monthly outcomes
-- must be created through the product UI, never pre-seeded here.

begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  phone, phone_change, phone_change_token, email_change_token_current,
  reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '27000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'maple.owner@farmrx.local.test',
  '$2a$10$HU4qKAkUUTh8zudes1sqYu74RMeFZwIRb1tXxOxTFrV9COElPyXKm',
  '2027-01-12 14:00:00+00', '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"email_verified":true,"synthetic_local_fixture":true}'::jsonb,
  false, '2027-01-12 14:00:00+00', '2027-01-12 14:00:00+00',
  null, '', '', '', '', false, false
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at,
  created_at, updated_at
) values (
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '{"sub":"27000000-0000-4000-8000-000000000001","email":"maple.owner@farmrx.local.test","email_verified":true,"phone_verified":false}'::jsonb,
  'email', '2027-01-12 14:00:00+00', '2027-01-12 14:00:00+00',
  '2027-01-12 14:00:00+00'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '27000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id', '27000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs', jsonb_build_object(
      '27010000-0000-4000-8000-000000000001', 1
    )::text
  )::text,
  true
);

-- Farm insertion exercises the product-owned owner-membership/access-epoch
-- bootstrap triggers. Do not hand-seed those derived rows.
insert into public.farms (
  id, name, share_with_rep, created_by, time_zone, created_at, updated_at
) values (
  '27010000-0000-4000-8000-000000000001', 'Maple Ridge', false,
  '27000000-0000-4000-8000-000000000001', 'America/Chicago',
  '2027-01-12 14:00:00+00', '2027-01-12 14:00:00+00'
);

insert into public.entities (
  id, farm_id, name, entity_type, is_active, created_at, updated_at
) values (
  '27011000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  'Maple Ridge', 'sole_proprietorship', true,
  '2027-01-12 14:00:00+00', '2027-01-12 14:00:00+00'
);

insert into public.inventory_products (
  id, farm_id, product_kind, name, inventory_unit, is_restricted_use,
  is_active, notes, created_at, updated_at
) values (
  '27040000-0000-4000-8000-000000000000',
  '27010000-0000-4000-8000-000000000001',
  'chemical', 'Synthetic Herbicide 41 — Maple', 'gal', false, true,
  'Synthetic season fixture',
  '2027-01-12 14:00:00+00', '2027-01-12 14:00:00+00'
);

insert into public.cash_bids (
  id, farm_id, elevator, commodity_id, bid_date, basis, cash_price,
  delivery_start, delivery_end, notes, created_at, updated_at
) values (
  '27070500-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  'Synthetic Elevator', 'corn_yellow', '2027-11-10', 0.000000, 4.250000,
  '2027-11-10', '2027-12-15', 'Synthetic season fixture',
  '2027-01-12 14:00:00+00', '2027-01-12 14:00:00+00'
);

commit;
