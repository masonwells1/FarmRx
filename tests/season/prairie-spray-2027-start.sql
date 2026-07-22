-- Disposable local fixture for Scenario PS — Prairie Spray compliance presence.
-- The only post-fixture mutations allowed are the manifest application, its
-- manifest product line, and the derived target inventory balance.

begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  phone, phone_change, phone_change_token, email_change_token_current,
  reauthentication_token, is_sso_user, is_anonymous
) values
(
  '00000000-0000-0000-0000-000000000000',
  '27000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'prairie.owner@farmrx.local.test',
  crypt(set_config('farmrx.season_owner_password', :'season_owner_password', true), gen_salt('bf', 10)),
  '2027-06-15 19:10:00+00', '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"email_verified":true,"synthetic_local_fixture":true}'::jsonb,
  false, '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00',
  null, '', '', '', '', false, false
),
(
  '00000000-0000-0000-0000-000000000000',
  '27000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'prairie.manager@farmrx.local.test',
  crypt(current_setting('farmrx.season_owner_password'), gen_salt('bf', 10)),
  '2027-06-15 19:10:00+00', '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"email_verified":true,"synthetic_local_fixture":true}'::jsonb,
  false, '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00',
  null, '', '', '', '', false, false
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values
(
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '{"sub":"27000000-0000-4000-8000-000000000001","email":"prairie.owner@farmrx.local.test","email_verified":true,"phone_verified":false}'::jsonb,
  'email', '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
),
(
  '27000000-0000-4000-8000-000000000002',
  '27000000-0000-4000-8000-000000000002',
  '27000000-0000-4000-8000-000000000002',
  '{"sub":"27000000-0000-4000-8000-000000000002","email":"prairie.manager@farmrx.local.test","email_verified":true,"phone_verified":false}'::jsonb,
  'email', '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
);

-- The product-owned farm bootstrap trigger requires the fixture creator to be
-- the authenticated owner. Switch to the manager only through real local Auth
-- in the browser after this setup transaction commits.
select set_config('request.jwt.claims', '{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000001', true);
select set_config('request.headers', jsonb_build_object('x-farm-rx-expected-user-id', '27000000-0000-4000-8000-000000000001', 'x-farm-rx-access-epochs', jsonb_build_object('27010000-0000-4000-8000-000000000003', 1)::text)::text, true);

insert into public.farms (id, name, share_with_rep, created_by, time_zone, created_at, updated_at)
values (
  '27010000-0000-4000-8000-000000000003', 'Prairie Spray', false,
  '27000000-0000-4000-8000-000000000001', 'America/Chicago',
  '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
);

-- The farm insert owns the first owner membership/access epoch. This explicit
-- fixture row makes the browser actor a real active manager, not an owner.
insert into public.farm_memberships (farm_id, user_id, role, status, created_at, updated_at)
values (
  '27010000-0000-4000-8000-000000000003',
  '27000000-0000-4000-8000-000000000002', 'manager', 'active',
  '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
);

insert into public.entities (id, farm_id, name, entity_type, is_active, created_at, updated_at)
values (
  '27011000-0000-4000-8000-000000000003',
  '27010000-0000-4000-8000-000000000003', 'Prairie Spray', 'sole_proprietorship', true,
  '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
);

insert into public.fields (
  id, farm_id, operating_entity_id, name, legal_description, county, state,
  total_acres, is_active, created_at, updated_at
) values (
  '27020000-0000-4000-8000-000000000003',
  '27010000-0000-4000-8000-000000000003',
  '27011000-0000-4000-8000-000000000003', 'Prairie South 120',
  'Synthetic Prairie South 120', 'Synthetic County', 'IL', 120.00, true,
  '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
);

insert into public.arrangements (
  id, farm_id, field_id, arrangement_type, effective_from,
  created_at, updated_at
) values (
  '27021000-0000-4000-8000-000000000003',
  '27010000-0000-4000-8000-000000000003',
  '27020000-0000-4000-8000-000000000003', 'owned', date '2027-01-01',
  '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
);

insert into public.crop_assignments (
  id, farm_id, field_id, crop_year, commodity_id, planting_sequence, planted_acres,
  variety, planting_date, harvest_date, harvested_bushels, expected_yield_per_acre,
  expected_price_per_bu, actual_price_per_bu, notes, created_at, updated_at
) values (
  '27030000-0000-4000-8000-000000000003',
  '27010000-0000-4000-8000-000000000003',
  '27020000-0000-4000-8000-000000000003', 2027, 'soybeans', 1, 120.00,
  null, null, null, null, null, null, null, null,
  '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
);

insert into public.inventory_products (
  id, farm_id, product_kind, name, manufacturer, inventory_unit,
  epa_registration_number, is_restricted_use, signal_word,
  restricted_entry_interval_hours, preharvest_interval_hours,
  max_label_rate, max_label_rate_unit, max_label_rate_basis,
  commodity_id, variety_name, fertilizer_analysis, crop_rx_product_id,
  is_active, notes, created_at, updated_at
) values (
  '27040000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000003', 'chemical', 'Synthetic Herbicide 41',
  null, 'gal', '00000-000', true, 'caution', 12.00, 0.00,
  0.125000, 'gal', 'acre', null, null, null, null, true,
  'Synthetic Prairie Spray fixture', '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
);

insert into public.inventory_receipts (
  id, farm_id, source, status, vendor_name, purchase_date, received_at,
  invoice_number, created_by, cancelled_at, cancelled_by, cancellation_reason,
  notes, created_at, updated_at
) values (
  '27041000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000003', 'opening_balance', 'draft', null,
  date '2027-06-15', null, null,
  '27000000-0000-4000-8000-000000000002', null, null, null,
  'Synthetic opening balance', '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
);

insert into public.inventory_receipt_lines (
  id, farm_id, receipt_id, product_id, entered_quantity, entered_unit,
  inventory_units_per_entered_unit, quantity_in_inventory_unit,
  unit_cost_per_inventory_unit, lot_number, expiration_date,
  external_delivery_line_id, notes, created_at, updated_at
) values (
  '27042000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000003',
  '27041000-0000-4000-8000-000000000001',
  '27040000-0000-4000-8000-000000000001', 100.00, 'gal', 1.0, 100.00,
  null, null, null, null, 'Synthetic opening balance',
  '2027-06-15 19:10:00+00', '2027-06-15 19:10:00+00'
);

-- Inventory history is intentionally draft-first. Finalize the synthetic
-- opening balance through the same immutable transition the product enforces.
update public.inventory_receipts
set status='received', received_at=timestamptz '2027-06-15 19:10:00+00'
where id='27041000-0000-4000-8000-000000000001'
  and farm_id='27010000-0000-4000-8000-000000000003';

commit;
