-- Disposable local fixture for Scenario PH — Pine Hill offline custody.
-- Synthetic-only. Browser actions own every product write; the fixture
-- controller owns only the one worker-membership revocation in PH-4.
begin;

select set_config('farmrx.season_owner_password', :'season_owner_password', true);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at,
  phone,phone_change,phone_change_token,reauthentication_token,is_sso_user,is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','27000000-0000-4000-8000-000000000001','authenticated','authenticated','pine.owner@farmrx.local.test',crypt(current_setting('farmrx.season_owner_password'),gen_salt('bf',10)),'2027-08-04 18:55:00+00','','','','','{"provider":"email","providers":["email"]}','{"email_verified":true,"synthetic_local_fixture":true}',false,'2027-08-04 18:55:00+00','2027-08-04 18:55:00+00',null,'','','',false,false),
  ('00000000-0000-0000-0000-000000000000','27000000-0000-4000-8000-000000000002','authenticated','authenticated','pine.control@farmrx.local.test',crypt(current_setting('farmrx.season_owner_password'),gen_salt('bf',10)),'2027-08-04 18:55:00+00','','','','','{"provider":"email","providers":["email"]}','{"email_verified":true,"synthetic_local_fixture":true}',false,'2027-08-04 18:55:00+00','2027-08-04 18:55:00+00',null,'','','',false,false),
  ('00000000-0000-0000-0000-000000000000','27000000-0000-4000-8000-000000000003','authenticated','authenticated','pine.worker@farmrx.local.test',crypt(current_setting('farmrx.season_owner_password'),gen_salt('bf',10)),'2027-08-04 18:55:00+00','','','','','{"provider":"email","providers":["email"]}','{"email_verified":true,"synthetic_local_fixture":true}',false,'2027-08-04 18:55:00+00','2027-08-04 18:55:00+00',null,'','','',false,false);

insert into auth.identities (id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values
  ('27000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001','{"sub":"27000000-0000-4000-8000-000000000001","email":"pine.owner@farmrx.local.test","email_verified":true,"phone_verified":false}','email','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00'),
  ('27000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000002','{"sub":"27000000-0000-4000-8000-000000000002","email":"pine.control@farmrx.local.test","email_verified":true,"phone_verified":false}','email','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00'),
  ('27000000-0000-4000-8000-000000000003','27000000-0000-4000-8000-000000000003','27000000-0000-4000-8000-000000000003','{"sub":"27000000-0000-4000-8000-000000000003","email":"pine.worker@farmrx.local.test","email_verified":true,"phone_verified":false}','email','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00');

select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs',jsonb_build_object(
      '27010000-0000-4000-8000-000000000006',1,
      '27010000-0000-4000-8000-000000000001',1
    )::text
  )::text,
  true
);

insert into public.farms (id,name,share_with_rep,created_by,time_zone,created_at,updated_at) values
  ('27010000-0000-4000-8000-000000000006','Pine Hill',false,'27000000-0000-4000-8000-000000000001','America/Chicago','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00'),
  ('27010000-0000-4000-8000-000000000001','Maple Ridge',false,'27000000-0000-4000-8000-000000000001','America/Chicago','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00');

-- Each farm insert creates its owner membership and epoch. Add the Pine worker
-- and a Maple-only control account explicitly; both inserts are fenced by the
-- fixture owner's exact farm epochs.
insert into public.farm_memberships (farm_id,user_id,role,status,created_at,updated_at)
values
  ('27010000-0000-4000-8000-000000000006','27000000-0000-4000-8000-000000000003','worker','active','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00'),
  ('27010000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000002','worker','active','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00');

insert into public.entities (id,farm_id,name,entity_type,is_active,created_at,updated_at)
values ('27011000-0000-4000-8000-000000000006','27010000-0000-4000-8000-000000000006','Pine Hill','sole_proprietorship',true,'2027-08-04 18:55:00+00','2027-08-04 18:55:00+00');
insert into public.fields (id,farm_id,operating_entity_id,name,legal_description,county,state,total_acres,is_active,created_at,updated_at)
values ('27020000-0000-4000-8000-000000000006','27010000-0000-4000-8000-000000000006','27011000-0000-4000-8000-000000000006','Pine North 60','Synthetic Pine North 60','Synthetic County','IL',60,true,'2027-08-04 18:55:00+00','2027-08-04 18:55:00+00');
insert into public.arrangements (id,farm_id,field_id,arrangement_type,effective_from,created_at,updated_at)
values ('27021000-0000-4000-8000-000000000006','27010000-0000-4000-8000-000000000006','27020000-0000-4000-8000-000000000006','owned','2027-01-01','2027-08-04 18:55:00+00','2027-08-04 18:55:00+00');
insert into public.crop_assignments (id,farm_id,field_id,crop_year,commodity_id,planting_sequence,planted_acres,variety,planting_date,harvest_date,harvested_bushels,expected_yield_per_acre,expected_price_per_bu,actual_price_per_bu,notes,created_at,updated_at)
values ('27030000-0000-4000-8000-000000000006','27010000-0000-4000-8000-000000000006','27020000-0000-4000-8000-000000000006',2027,'corn_yellow',1,60,null,'2027-04-20',null,null,180,4.25,null,null,'2027-08-04 18:55:00+00','2027-08-04 18:55:00+00');

do $fixture$
begin
  if (select access_epoch from public.farm_access_epochs where farm_id='27010000-0000-4000-8000-000000000006' and user_id='27000000-0000-4000-8000-000000000003') is distinct from 1 then
    raise exception 'Pine worker did not start at epoch 1';
  end if;
  if exists(select 1 from public.field_log_entries) or exists(select 1 from public.repository_write_receipts) then
    raise exception 'Pine fixture started with product writes';
  end if;
end
$fixture$;
commit;
