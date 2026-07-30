-- Disposable local fixture for Scenario NF — North Fork permissions/privacy.
-- Synthetic-only. Browser actions own the two sharing changes and task lifecycle.
begin;

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at,
  phone,phone_change,phone_change_token,reauthentication_token,is_sso_user,is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','27000000-0000-4000-8000-000000000001','authenticated','authenticated','north.owner@farmrx.local.test',crypt(set_config('farmrx.season_owner_password', :'season_owner_password', true),gen_salt('bf',10)),'2027-02-09 13:55:00+00','','','','','{"provider":"email","providers":["email"]}','{"email_verified":true,"full_name":"North Owner","synthetic_local_fixture":true}',false,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00',null,'','','',false,false),
  ('00000000-0000-0000-0000-000000000000','27000000-0000-4000-8000-000000000002','authenticated','authenticated','north.manager@farmrx.local.test',crypt(current_setting('farmrx.season_owner_password'),gen_salt('bf',10)),'2027-02-09 13:55:00+00','','','','','{"provider":"email","providers":["email"]}','{"email_verified":true,"full_name":"North Manager","synthetic_local_fixture":true}',false,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00',null,'','','',false,false),
  ('00000000-0000-0000-0000-000000000000','27000000-0000-4000-8000-000000000003','authenticated','authenticated','north.worker@farmrx.local.test',crypt(current_setting('farmrx.season_owner_password'),gen_salt('bf',10)),'2027-02-09 13:55:00+00','','','','','{"provider":"email","providers":["email"]}','{"email_verified":true,"full_name":"North Worker","synthetic_local_fixture":true}',false,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00',null,'','','',false,false),
  ('00000000-0000-0000-0000-000000000000','27000000-0000-4000-8000-000000000004','authenticated','authenticated','north.readonly@farmrx.local.test',crypt(current_setting('farmrx.season_owner_password'),gen_salt('bf',10)),'2027-02-09 13:55:00+00','','','','','{"provider":"email","providers":["email"]}','{"email_verified":true,"full_name":"North Read Only","synthetic_local_fixture":true}',false,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00',null,'','','',false,false),
  ('00000000-0000-0000-0000-000000000000','27000000-0000-4000-8000-000000000005','authenticated','authenticated','north.rep@farmrx.local.test',crypt(current_setting('farmrx.season_owner_password'),gen_salt('bf',10)),'2027-02-09 13:55:00+00','','','','','{"provider":"email","providers":["email"]}','{"email_verified":true,"full_name":"North Named Rep","synthetic_local_fixture":true}',false,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00',null,'','','',false,false),
  ('00000000-0000-0000-0000-000000000000','27000000-0000-4000-8000-000000000006','authenticated','authenticated','north.outsider@farmrx.local.test',crypt(current_setting('farmrx.season_owner_password'),gen_salt('bf',10)),'2027-02-09 13:55:00+00','','','','','{"provider":"email","providers":["email"]}','{"email_verified":true,"full_name":"North Outsider","synthetic_local_fixture":true}',false,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00',null,'','','',false,false);

insert into auth.identities (id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values
  ('27000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001','{"sub":"27000000-0000-4000-8000-000000000001","email":"north.owner@farmrx.local.test","email_verified":true,"phone_verified":false}','email','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00'),
  ('27000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000002','{"sub":"27000000-0000-4000-8000-000000000002","email":"north.manager@farmrx.local.test","email_verified":true,"phone_verified":false}','email','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00'),
  ('27000000-0000-4000-8000-000000000003','27000000-0000-4000-8000-000000000003','27000000-0000-4000-8000-000000000003','{"sub":"27000000-0000-4000-8000-000000000003","email":"north.worker@farmrx.local.test","email_verified":true,"phone_verified":false}','email','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00'),
  ('27000000-0000-4000-8000-000000000004','27000000-0000-4000-8000-000000000004','27000000-0000-4000-8000-000000000004','{"sub":"27000000-0000-4000-8000-000000000004","email":"north.readonly@farmrx.local.test","email_verified":true,"phone_verified":false}','email','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00'),
  ('27000000-0000-4000-8000-000000000005','27000000-0000-4000-8000-000000000005','27000000-0000-4000-8000-000000000005','{"sub":"27000000-0000-4000-8000-000000000005","email":"north.rep@farmrx.local.test","email_verified":true,"phone_verified":false}','email','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00'),
  ('27000000-0000-4000-8000-000000000006','27000000-0000-4000-8000-000000000006','27000000-0000-4000-8000-000000000006','{"sub":"27000000-0000-4000-8000-000000000006","email":"north.outsider@farmrx.local.test","email_verified":true,"phone_verified":false}','email','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');

select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs',jsonb_build_object(
      '27010000-0000-4000-8000-000000000001',1,
      '27010000-0000-4000-8000-000000000002',1
    )::text
  )::text,
  true
);

insert into public.farms (id,name,share_with_rep,created_by,time_zone,created_at,updated_at) values
  ('27010000-0000-4000-8000-000000000002','North Fork',false,'27000000-0000-4000-8000-000000000001','America/Chicago','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00'),
  ('27010000-0000-4000-8000-000000000001','Maple Ridge',false,'27000000-0000-4000-8000-000000000001','America/Chicago','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');

insert into public.farm_memberships (farm_id,user_id,role,status,can_view_financials,created_at,updated_at) values
  ('27010000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000002','manager','active',false,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00'),
  ('27010000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000003','worker','active',false,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00'),
  ('27010000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000004','read_only','active',false,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');

insert into public.farm_rep_access (farm_id,rep_user_id,enabled,granted_by,granted_at,revoked_at,created_at,updated_at)
values ('27010000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000005',true,'27000000-0000-4000-8000-000000000001','2027-02-09 13:55:00+00',null,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');

insert into public.entities (id,farm_id,name,entity_type,is_active,created_at,updated_at)
values ('27011000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000002','North Fork','sole_proprietorship',true,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');
insert into public.fields (id,farm_id,operating_entity_id,name,legal_description,county,state,total_acres,is_active,created_at,updated_at)
values ('27020000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000002','27011000-0000-4000-8000-000000000002','North Home 80','Synthetic North Home 80','Synthetic County','IL',80,true,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');
insert into public.arrangements (id,farm_id,field_id,arrangement_type,effective_from,created_at,updated_at)
values ('27021000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000002','27020000-0000-4000-8000-000000000002','owned','2027-01-01','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');
insert into public.crop_assignments (id,farm_id,field_id,crop_year,commodity_id,planting_sequence,planted_acres,variety,planting_date,harvest_date,harvested_bushels,expected_yield_per_acre,expected_price_per_bu,actual_price_per_bu,notes,created_at,updated_at)
values ('27030000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000002','27020000-0000-4000-8000-000000000002',2027,'corn_yellow',1,80,null,'2027-04-20',null,null,190,4.20,null,null,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');

insert into public.production_estimates (id,farm_id,crop_year,commodity_id,operating_entity_id,enterprise_label,planted_acres,aph_yield,expected_bushels,actual_bushels,drives_math,notes,created_at,updated_at)
values ('27070000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000002',2027,'corn_yellow',null,null,80,190,15200,null,'projected','Synthetic North private Grain sentinel','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');
insert into public.crop_budgets (id,farm_id,crop_year,commodity_id,operating_entity_id,enterprise_label,name,expected_yield_per_acre,expected_price_per_bushel,copied_from_budget_id,notes,created_at,updated_at)
values ('27077000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000002',2027,'corn_yellow',null,null,'Synthetic North 2027 Base',190,4.20,null,'Synthetic North private financial sentinel','2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');
insert into public.budget_cost_lines (id,farm_id,budget_id,category,label,amount_per_acre,source_kind,source_record_id,sort_order,notes,created_at,updated_at)
values ('27077100-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000002','27077000-0000-4000-8000-000000000002','seed','Synthetic North seed',100,'manual',null,1,null,'2027-02-09 13:55:00+00','2027-02-09 13:55:00+00');

do $fixture$
declare
  role_matrix text;
begin
  select string_agg(user_id::text||':'||role::text||':'||status::text||':'||can_view_financials::text,',' order by user_id)
  into role_matrix from public.farm_memberships where farm_id='27010000-0000-4000-8000-000000000002';
  if role_matrix is distinct from
    '27000000-0000-4000-8000-000000000001:owner:active:false,'||
    '27000000-0000-4000-8000-000000000002:manager:active:false,'||
    '27000000-0000-4000-8000-000000000003:worker:active:false,'||
    '27000000-0000-4000-8000-000000000004:read_only:active:false' then
    raise exception 'North membership matrix is not exact: %', role_matrix;
  end if;
  if (select access_epoch from public.farm_access_epochs where farm_id='27010000-0000-4000-8000-000000000002' and user_id='27000000-0000-4000-8000-000000000005') is distinct from 1 then
    raise exception 'North rep did not start at epoch 1';
  end if;
  if exists(select 1 from public.farm_memberships where user_id in ('27000000-0000-4000-8000-000000000005','27000000-0000-4000-8000-000000000006'))
    or exists(select 1 from public.farm_tasks where farm_id='27010000-0000-4000-8000-000000000002') then
    raise exception 'North fixture started with forbidden access or task rows';
  end if;
end
$fixture$;
commit;
