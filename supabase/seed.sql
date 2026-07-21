-- Synthetic, local-only Programs -> Inventory browser-proof baseline.
-- This file is intentionally small: a fresh `supabase db reset --local`
-- supplies idempotence, and no production or customer data belongs here.

begin;

-- Auth-shaped local email identity. The default seed receives a fresh,
-- unknowable verifier so it cannot become a reusable login credential;
-- executable season runners replace this seed entirely and inject their
-- process-only credential through the dedicated fixture.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at,
  phone,
  phone_change,
  phone_change_token,
  email_change_token_current,
  reauthentication_token,
  is_sso_user,
  is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  '27000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'maple.owner@farmrx.local.test',
  crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf', 10)),
  '2027-01-12 14:00:00+00',
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"email_verified":true,"synthetic_local_fixture":true}'::jsonb,
  false,
  '2027-01-12 14:00:00+00',
  '2027-01-12 14:00:00+00',
  null,
  '',
  '',
  '',
  '',
  false,
  false
);

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '{"sub":"27000000-0000-4000-8000-000000000001","email":"maple.owner@farmrx.local.test","email_verified":true,"phone_verified":false}'::jsonb,
  'email',
  '2027-01-12 14:00:00+00',
  '2027-01-12 14:00:00+00',
  '2027-01-12 14:00:00+00'
);

-- Preserve the actual farm bootstrap behavior: inserting the farm creates the
-- active owner membership and its initial access epoch through product-owned
-- triggers. Request context is local to this seed transaction and lets later
-- guarded fixture inserts follow the same epoch contract as browser writes.
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

insert into public.farms (
  id, name, share_with_rep, created_by, time_zone, created_at, updated_at
)
values (
  '27010000-0000-4000-8000-000000000001',
  'Maple Ridge',
  false,
  '27000000-0000-4000-8000-000000000001',
  'America/Chicago',
  '2027-01-12 14:00:00+00',
  '2027-01-12 14:00:00+00'
);

insert into public.entities (
  id, farm_id, name, entity_type, is_active, created_at, updated_at
)
values (
  '27011000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  'Maple Ridge',
  'sole_proprietorship',
  true,
  '2027-01-12 14:00:00+00',
  '2027-01-12 14:00:00+00'
);

insert into public.fields (
  id,
  farm_id,
  operating_entity_id,
  name,
  county,
  state,
  total_acres,
  is_active,
  created_at,
  updated_at
)
values (
  '27020000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  '27011000-0000-4000-8000-000000000001',
  'Maple East 160',
  'Jackson County',
  'IL',
  160.00,
  true,
  '2027-01-12 14:00:00+00',
  '2027-01-12 14:00:00+00'
);

insert into public.crop_assignments (
  id,
  farm_id,
  field_id,
  crop_year,
  commodity_id,
  planting_sequence,
  planted_acres,
  expected_yield_per_acre,
  created_at,
  updated_at
)
values (
  '27030000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  '27020000-0000-4000-8000-000000000001',
  2027,
  'corn_yellow',
  1,
  160.00,
  200.0000,
  '2027-01-12 14:00:00+00',
  '2027-01-12 14:00:00+00'
);

-- Inventory starts with the scenario's known product but no ledger rows.
-- The authoritative inventory_on_hand view therefore reports exactly 0 gal.
insert into public.inventory_products (
  id,
  farm_id,
  product_kind,
  name,
  inventory_unit,
  is_restricted_use,
  is_active,
  notes,
  created_at,
  updated_at
)
values (
  '27040000-0000-4000-8000-000000000000',
  '27010000-0000-4000-8000-000000000001',
  'chemical',
  'Synthetic Herbicide 41 — Maple',
  'gal',
  false,
  true,
  'Synthetic local season fixture',
  '2027-01-12 14:00:00+00',
  '2027-01-12 14:00:00+00'
);

insert into public.programs (
  id,
  farm_id,
  name,
  program_kind,
  commodity_id,
  crop_year,
  revision,
  is_archived,
  created_by,
  updated_by,
  created_at,
  updated_at
)
values (
  '27050000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  'Maple 2027 Corn Program',
  'chemical',
  null,
  2027,
  1,
  false,
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '2027-02-18 15:00:00+00',
  '2027-02-18 15:00:00+00'
);

insert into public.program_passes (
  id,
  farm_id,
  program_id,
  sequence,
  name,
  pass_type,
  activity_type,
  target_date,
  reminder_lead_days,
  is_archived,
  created_by,
  updated_by,
  created_at,
  updated_at
)
values (
  '27051000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  '27050000-0000-4000-8000-000000000001',
  1,
  'Post-emerge synthetic pass',
  'post',
  'spray',
  '2027-05-20',
  3,
  false,
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '2027-02-18 15:00:00+00',
  '2027-02-18 15:00:00+00'
);

insert into public.program_pass_products (
  id,
  farm_id,
  program_pass_id,
  sequence,
  product_name,
  rate_text,
  unit_text,
  estimated_cost_per_acre,
  catalog_product_id,
  is_archived,
  created_by,
  updated_by,
  created_at,
  updated_at
)
values (
  '27051100-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  '27051000-0000-4000-8000-000000000001',
  1,
  'Free-Typed Program Herbicide',
  '10.00',
  'gal total',
  7.0000,
  null,
  false,
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '2027-02-18 15:00:00+00',
  '2027-02-18 15:00:00+00'
);

insert into public.program_assignments (
  id,
  farm_id,
  program_id,
  crop_assignment_id,
  program_name_snapshot,
  program_kind_snapshot,
  status,
  template_revision,
  assigned_by,
  assigned_at,
  created_at,
  updated_at
)
values (
  '27052000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  '27050000-0000-4000-8000-000000000001',
  '27030000-0000-4000-8000-000000000001',
  'Maple 2027 Corn Program',
  'chemical',
  'active',
  1,
  '27000000-0000-4000-8000-000000000001',
  '2027-02-18 15:00:00+00',
  '2027-02-18 15:00:00+00',
  '2027-02-18 15:00:00+00'
);

insert into public.assigned_program_passes (
  id,
  farm_id,
  assignment_id,
  source_program_pass_id,
  source_revision,
  sequence,
  name,
  pass_type,
  activity_type,
  target_date,
  reminder_lead_days,
  due_on,
  due_source,
  is_field_override,
  status,
  created_by,
  updated_by,
  created_at,
  updated_at
)
values (
  '27053000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  '27052000-0000-4000-8000-000000000001',
  '27051000-0000-4000-8000-000000000001',
  1,
  1,
  'Post-emerge synthetic pass',
  'post',
  'spray',
  '2027-05-20',
  3,
  '2027-05-20',
  'template_date',
  false,
  'planned',
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '2027-02-18 15:00:00+00',
  '2027-02-18 15:00:00+00'
);

insert into public.assigned_program_pass_products (
  id,
  farm_id,
  assigned_pass_id,
  source_program_pass_product_id,
  sequence,
  product_name,
  rate_text,
  unit_text,
  estimated_cost_per_acre,
  catalog_product_id,
  is_active,
  created_by,
  updated_by,
  created_at,
  updated_at
)
values (
  '27053100-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000001',
  '27053000-0000-4000-8000-000000000001',
  '27051100-0000-4000-8000-000000000001',
  1,
  'Free-Typed Program Herbicide',
  '10.00',
  'gal total',
  7.0000,
  null,
  true,
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '2027-02-18 15:00:00+00',
  '2027-02-18 15:00:00+00'
);

commit;
