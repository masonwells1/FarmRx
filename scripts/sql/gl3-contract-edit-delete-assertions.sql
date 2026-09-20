-- Disposable-backend assertions for Initiative GL-3b (contract edit and delete).
-- Runs after every migration on a fresh database, in the same database and after the
-- FS, FD, GL-1 and GL-2 assertion files, so every id here is distinct from theirs.
-- Every failure raises; the last line prints GL3_CONTRACT_EDIT_DELETE_DISPOSABLE_PASS.
--
-- What is proved: a contract with deliveries can be neither edited nor deleted; a reason
-- is required and is stored; an edit changes only the correctable fields and never the
-- crop year, commodity, contract type or pricing; an absent key keeps the stored value
-- while an explicit null clears a nullable one; an invalid edit changes nothing; a delete
-- writes its audit row BEFORE removing the contract, so the record outlives the row; a
-- repeated delete after a lost response reports the completed delete instead of failing;
-- a contract created from a firm offer returns that offer to open, or to expired when its
-- own expiry has passed; the audit is append-only and fenced to the farm that owns it; and
-- neither RPC can be driven by the service role.

\set ON_ERROR_STOP on
\set O9  '''00000000-0000-4000-8000-00000000000d'''
\set O10 '''00000000-0000-4000-8000-00000000000e'''
\set F3  '''00000000-0000-4000-8000-000000000072'''
\set F4  '''00000000-0000-4000-8000-000000000073'''
\set C1  '''00000000-0000-4000-8000-000000000090'''
\set C2  '''00000000-0000-4000-8000-000000000091'''
\set C3  '''00000000-0000-4000-8000-000000000092'''
\set C4  '''00000000-0000-4000-8000-000000000093'''
\set FO1 '''00000000-0000-4000-8000-000000000094'''
\set FO2 '''00000000-0000-4000-8000-000000000095'''
\set D1  '''00000000-0000-4000-8000-000000000096'''
\set W1  '''00000000-0000-4000-8000-00000000000f'''

-- ------------------------------------------------- fixtures
insert into auth.users(id,email) values (:O9,'gl3-owner-a@example.test'),(:O10,'gl3-owner-b@example.test'),(:W1,'gl3-worker@example.test');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000d"}',false);
insert into public.farms(id,name,created_by,time_zone) values (:F3,'Contract Repair Farm',:O9,'America/Chicago');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000e"}',false);
insert into public.farms(id,name,created_by,time_zone) values (:F4,'Other Farm',:O10,'America/Chicago');

select set_config('request.jwt.claims','{"role":"service_role"}',false);
insert into public.firm_offers(id,farm_id,crop_year,commodity_id,buyer,offer_type,bushels,price,expires_on,status)
values (:FO1,:F3,2026,'corn_yellow','Offer Buyer','cash',5000,4.90,'2027-12-31','filled'),
       (:FO2,:F3,2026,'soybeans','Expired Offer Buyer','cash',3000,11.10,'2020-01-01','filled');
insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,cash_price,delivery_start,delivery_end)
values (:C1,:F3,2026,'corn_yellow','forward_cash','Buyer Typo',10000,4.75,'2026-11-01','2026-11-30'),
       (:C2,:F3,2026,'soybeans','forward_cash','Delivered Buyer',8000,11.00,'2026-12-01','2026-12-31');
insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,cash_price,firm_offer_id)
values (:C3,:F3,2026,'corn_yellow','forward_cash','Offer Buyer',5000,4.90,:FO1),
       (:C4,:F3,2026,'soybeans','forward_cash','Expired Offer Buyer',3000,11.10,:FO2);
update public.firm_offers set filled_contract_id = :C3 where id = :FO1;
update public.firm_offers set filled_contract_id = :C4 where id = :FO2;
insert into public.grain_contract_deliveries(id,farm_id,grain_contract_id,bushels,delivered_on)
values (:D1,:F3,:C2,1000,'2026-12-05');

-- ------------------------------------------------- 1. the one eligibility test
do $$
begin
  if public.grain_contract_has_deliveries('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090')
    then raise exception 'a contract with no deliveries was reported as delivered against'; end if;
  if not public.grain_contract_has_deliveries('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000091')
    then raise exception 'a contract with a delivery was reported as having none'; end if;
end $$;

-- ------------------------------------------------- 2. the service role cannot drive either RPC
-- Exercised under the role as well as the claim, the way an edge function reaches the database.
set role service_role;
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090','service role attempt','{"buyer":"Nope"}'::jsonb, now(), gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'the service role edited a contract'; end if;

  v_failed := false;
  begin perform public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090','service role attempt', now());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'the service role deleted a contract'; end if;
end $$;
reset role;

-- Everything from here to the append-only checks runs as the signed-in owner, under the
-- authenticated role, so execute grants and can_edit_farm are exercised rather than assumed.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000d"}',false);
-- The access-epoch fence applies to these writes exactly as it does to any other browser write,
-- so the owner presents the snapshot a signed-in client would. A farm created in this file is at
-- epoch 1.
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-00000000000d','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000072',1)::text)::text,false);
set role authenticated;

-- ------------------------------------------------- 3. a reason is not optional
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090',null,'{"buyer":"Corrected Buyer"}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000090'), gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a contract was edited with no reason'; end if;

  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090','   ','{"buyer":"Corrected Buyer"}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000090'), gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'whitespace passed as a reason'; end if;

  v_failed := false;
  begin perform public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090','ab', (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000090'));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a two-character reason was accepted'; end if;
end $$;

-- ------------------------------------------------- 4. an invalid edit changes nothing
do $$
declare v_failed boolean; v_buyer text; v_bushels numeric;
begin
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090','zero bushels','{"bushels":0}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000090'), gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'bushels of zero were accepted'; end if;

  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090','blank buyer','{"buyer":"  "}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000090'), gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a blank buyer was accepted'; end if;

  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090','backwards window','{"delivery_start":"2026-11-30","delivery_end":"2026-11-01"}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000090'), gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a delivery window ending before it starts was accepted'; end if;

  select buyer, bushels into v_buyer, v_bushels from public.grain_contracts where id='00000000-0000-4000-8000-000000000090';
  if v_buyer <> 'Buyer Typo' or v_bushels <> 10000 then raise exception 'a rejected edit still changed the contract'; end if;
  if exists (select 1 from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-000000000090')
    then raise exception 'a rejected edit wrote an audit row'; end if;
end $$;

-- ------------------------------------------------- 5. a contract with deliveries is history, not a draft
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000091','fix the buyer','{"buyer":"Too Late"}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000091'), gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a contract with deliveries was edited'; end if;

  v_failed := false;
  begin perform public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000091','remove it', (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000091'));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a contract with deliveries was deleted'; end if;

  if not exists (select 1 from public.grain_contracts where id='00000000-0000-4000-8000-000000000091')
    then raise exception 'the delivered contract is gone'; end if;
end $$;

-- ------------------------------------------------- 6. a real edit, and only the correctable fields
do $$
declare v_row public.grain_contracts%rowtype; v_audit public.grain_contract_audit%rowtype;
begin
  perform public.edit_grain_contract(
    '00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090',
    'buyer was typed wrong and the bushels were off by a truckload',
    '{"buyer":"Corrected Buyer","bushels":9250,"delivery_end":null,"contract_number":"CN-7781"}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000090'), gen_random_uuid());

  select * into v_row from public.grain_contracts where id='00000000-0000-4000-8000-000000000090';
  if v_row.buyer <> 'Corrected Buyer' then raise exception 'the buyer was not corrected'; end if;
  if v_row.bushels <> 9250 then raise exception 'the bushels were not corrected'; end if;
  if v_row.contract_number is distinct from 'CN-7781' then raise exception 'the contract number was not recorded'; end if;
  -- an explicit null clears; an absent key keeps
  if v_row.delivery_end is not null then raise exception 'an explicit null did not clear the delivery end'; end if;
  if v_row.delivery_start is distinct from date '2026-11-01' then raise exception 'an absent key did not keep the delivery start'; end if;
  -- identity and math are untouched
  if v_row.crop_year <> 2026 or v_row.commodity_id <> 'corn_yellow' or v_row.contract_type <> 'forward_cash'
    then raise exception 'an edit changed the contract identity'; end if;
  if v_row.cash_price <> 4.75 or v_row.premium_cents_per_bu <> 0
    then raise exception 'an edit changed contract pricing'; end if;

  select * into v_audit from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-000000000090';
  if not found then raise exception 'the edit wrote no audit row'; end if;
  if v_audit.action <> 'edit' then raise exception 'the audit row is not an edit'; end if;
  if v_audit.reason <> 'buyer was typed wrong and the bushels were off by a truckload' then raise exception 'the reason was not stored verbatim'; end if;
  if v_audit.before_row->>'buyer' <> 'Buyer Typo' then raise exception 'the audit row lost the value before the edit'; end if;
  if v_audit.after_row->>'buyer' <> 'Corrected Buyer' then raise exception 'the audit row lost the value after the edit'; end if;
  if v_audit.actor_id is distinct from '00000000-0000-4000-8000-00000000000d'::uuid then raise exception 'the audit row did not record who made the change'; end if;
end $$;

-- ------------------------------------------------- 7. the audit outlives the contract, and repeats are safe
do $$
declare v_result jsonb; v_audit public.grain_contract_audit%rowtype;
begin
  v_result := public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090','entered twice by mistake', (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000090'));
  if v_result->>'deleted' <> 'true' then raise exception 'the delete did not report success'; end if;
  if (v_result->>'already_deleted')::boolean then raise exception 'a first delete reported itself as a repeat'; end if;
  if exists (select 1 from public.grain_contracts where id='00000000-0000-4000-8000-000000000090')
    then raise exception 'the contract is still there'; end if;

  select * into v_audit from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-000000000090' and action='delete';
  if not found then raise exception 'the delete left no record'; end if;
  if v_audit.after_row is not null then raise exception 'a delete recorded an after state'; end if;
  if v_audit.before_row->>'buyer' <> 'Corrected Buyer' then raise exception 'the delete record lost the contract it removed'; end if;
  if (select count(*) from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-000000000090') <> 2
    then raise exception 'the edit record did not survive the delete'; end if;

  -- a retry after a lost response must not read as a failure the farmer tries again
  v_result := public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000090','entered twice by mistake', (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000090'));
  if not (v_result->>'already_deleted')::boolean then raise exception 'a repeated delete did not report the completed delete'; end if;
  if (select count(*) from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-000000000090') <> 2
    then raise exception 'a repeated delete wrote another audit row'; end if;
end $$;

-- ------------------------------------------------- 8. a filled offer is no longer filled
do $$
declare v_result jsonb; v_offer public.firm_offers%rowtype;
begin
  v_result := public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000092','the elevator never confirmed this fill', (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000092'));
  if v_result->>'reopened_firm_offer_id' <> '00000000-0000-4000-8000-000000000094'
    then raise exception 'the delete did not name the offer it reopened'; end if;
  select * into v_offer from public.firm_offers where id='00000000-0000-4000-8000-000000000094';
  if v_offer.status <> 'open' then raise exception 'an unexpired offer did not return to open, it is %', v_offer.status; end if;
  if v_offer.filled_contract_id is not null then raise exception 'the offer still points at a contract that is gone'; end if;
  if (select reopened_firm_offer_id from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-000000000092')
     is distinct from '00000000-0000-4000-8000-000000000094'::uuid
    then raise exception 'the audit row did not record the reopened offer'; end if;

  -- and an offer whose own expiry has passed must not come back as live
  perform public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000093','wrong offer filled', (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000093'));
  select * into v_offer from public.firm_offers where id='00000000-0000-4000-8000-000000000095';
  if v_offer.status <> 'expired' then raise exception 'an expired offer came back as %', v_offer.status; end if;
  if v_offer.filled_contract_id is not null then raise exception 'the expired offer still points at a contract that is gone'; end if;
end $$;

-- ------------------------------------------------- 8b. the delete reports the offer's real state
-- The id alone is not enough for the screen: an offer whose expiry had passed is marked expired, not
-- reopened, and telling the farmer to go and refill it sends them after something that is not there.
-- A retry after a lost response owes the same answer, or the farmer loses that guidance entirely.
do $$
declare v_result jsonb; v_status text;
begin
  select (public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000092','x', now()))::text into v_status;
exception when others then null; -- already deleted above; the assertions below read the retry path
end $$;
do $$
declare v_result jsonb;
begin
  -- the unexpired offer's contract, deleted earlier: its retry must still name the offer AND its state
  v_result := public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000092','the elevator never confirmed this fill', null);
  if not (v_result->>'already_deleted')::boolean then raise exception 'the retry did not report the completed delete'; end if;
  if v_result->>'reopened_firm_offer_id' <> '00000000-0000-4000-8000-000000000094'
    then raise exception 'the retry lost the offer the delete reopened'; end if;
  if v_result->>'reopened_firm_offer_status' <> 'open'
    then raise exception 'the retry reported the reopened offer as %', coalesce(v_result->>'reopened_firm_offer_status','nothing'); end if;

  -- and the expired offer's contract must report expired, not open
  v_result := public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000093','wrong offer filled', null);
  if v_result->>'reopened_firm_offer_status' <> 'expired'
    then raise exception 'an expired offer was reported as %', coalesce(v_result->>'reopened_firm_offer_status','nothing'); end if;
end $$;

-- ------------------------------------------------- 9. the audit is append-only and fenced
-- Back to the owning role on purpose: as authenticated the update below would fail on the
-- missing grant, which proves nothing about the trigger.
reset role;
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin update public.grain_contract_audit set reason='rewritten' where grain_contract_id='00000000-0000-4000-8000-000000000092';
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'an audit reason was rewritten after the fact'; end if;

  if has_table_privilege('authenticated','public.grain_contract_audit','insert') then raise exception 'a signed-in client can insert its own audit rows'; end if;
  if has_table_privilege('authenticated','public.grain_contract_audit','update') then raise exception 'a signed-in client can update audit rows'; end if;
  if has_table_privilege('authenticated','public.grain_contract_audit','delete') then raise exception 'a signed-in client can delete audit rows'; end if;
  if has_table_privilege('anon','public.grain_contract_audit','select') then raise exception 'an anonymous caller can read audit rows'; end if;
  if has_function_privilege('anon','public.edit_grain_contract(uuid,uuid,text,jsonb,timestamptz,uuid)','execute') then raise exception 'an anonymous caller can edit a contract'; end if;
  if has_function_privilege('anon','public.delete_grain_contract(uuid,uuid,text,timestamptz)','execute') then raise exception 'an anonymous caller can delete a contract'; end if;
  if not (select relrowsecurity from pg_class where oid='public.grain_contract_audit'::regclass) then raise exception 'the audit table has no row-level security'; end if;
end $$;

-- ------------------------------------------------- 10. another farm's owner sees none of it
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000e"}',false);
set role authenticated;
do $$
declare v_failed boolean;
begin
  if (select count(*) from public.grain_contract_audit where farm_id='00000000-0000-4000-8000-000000000072') <> 0
    then raise exception 'another farm''s owner can read these audit rows'; end if;
  v_failed := false;
  begin perform public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000091','not my farm', (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000091'));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'another farm''s owner deleted a contract'; end if;
end $$;

-- ------------------------------------------------- 11. a stale page cannot silently undo a correction
-- Two members can have the same contract open. Without a compare-and-swap the second save reverses
-- the first, and the audit records both as deliberate. This is the same fence optimisticSave applies
-- to every other mutable farm row.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000d"}',false);
set role authenticated;
do $$
declare v_failed boolean; v_buyer text; v_audit_rows integer;
begin
  v_audit_rows := (select count(*) from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-000000000091');
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000091','from a stale page','{"buyer":"Stale Overwrite"}'::jsonb, now() - interval '1 day', gen_random_uuid());
  exception when others then v_failed := sqlerrm = 'FARM_RX_STALE_WRITE'; end;
  if not v_failed then raise exception 'a stale expected version was accepted, or refused for the wrong reason'; end if;

  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000091','no version at all','{"buyer":"Stale Overwrite"}'::jsonb, null, gen_random_uuid());
  exception when others then v_failed := sqlerrm = 'FARM_RX_STALE_WRITE'; end;
  if not v_failed then raise exception 'a missing expected version was accepted'; end if;

  v_failed := false;
  begin perform public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000091','from a stale page', now() - interval '1 day');
  exception when others then v_failed := sqlerrm = 'FARM_RX_STALE_WRITE'; end;
  if not v_failed then raise exception 'a stale delete was accepted'; end if;

  select buyer into v_buyer from public.grain_contracts where id='00000000-0000-4000-8000-000000000091';
  if v_buyer <> 'Delivered Buyer' then raise exception 'a refused stale write still changed the contract'; end if;
  if (select count(*) from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-000000000091') <> v_audit_rows
    then raise exception 'a refused stale write wrote an audit row'; end if;
end $$;
reset role;

-- ------------------------------------------------- 12. offer expiry is read on the farm's calendar
-- After UTC midnight an Illinois farm is still on the previous evening, and an offer expiring on the
-- farm's today is still fillable there. current_date would retire it hours early.
-- The fixture farm's zone is chosen so its local date is GUARANTEED to differ from the database's
-- today, in one direction or the other, whatever hour this file runs at -- so one of the two cases
-- below always discriminates between the farm's date and current_date, and both are correct either way.
do $$
declare
  v_zone text := case when extract(hour from now() at time zone 'UTC') < 12 then 'Etc/GMT+12' else 'Etc/GMT-12' end;
  v_local date;
  v_offer public.firm_offers%rowtype;
begin
  update public.farms set time_zone = v_zone where id = '00000000-0000-4000-8000-000000000072';
  v_local := (now() at time zone v_zone)::date;
  if v_local = current_date then raise exception 'the fixture zone no longer differs from the database date; this assertion proves nothing'; end if;

  insert into public.firm_offers(id,farm_id,crop_year,commodity_id,buyer,offer_type,bushels,price,expires_on,status)
  values ('00000000-0000-4000-8000-000000000097','00000000-0000-4000-8000-000000000072',2026,'corn_yellow','Expires Today','cash',1000,4.5,v_local,'filled'),
         ('00000000-0000-4000-8000-000000000098','00000000-0000-4000-8000-000000000072',2026,'corn_yellow','Expired Yesterday','cash',1000,4.5,v_local - 1,'filled');
  insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,cash_price,firm_offer_id)
  values ('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000072',2026,'corn_yellow','forward_cash','Today Buyer',1000,4.5,'00000000-0000-4000-8000-000000000097'),
         ('00000000-0000-4000-8000-00000000009a','00000000-0000-4000-8000-000000000072',2026,'corn_yellow','forward_cash','Yesterday Buyer',1000,4.5,'00000000-0000-4000-8000-000000000098');
  update public.firm_offers set filled_contract_id='00000000-0000-4000-8000-000000000099' where id='00000000-0000-4000-8000-000000000097';
  update public.firm_offers set filled_contract_id='00000000-0000-4000-8000-00000000009a' where id='00000000-0000-4000-8000-000000000098';

  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000d"}',false);
  perform public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000099','not filled after all', (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000099'));
  perform public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-00000000009a','not filled after all', (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-00000000009a'));

  select * into v_offer from public.firm_offers where id='00000000-0000-4000-8000-000000000097';
  if v_offer.status <> 'open' then raise exception 'an offer expiring on the farm''s own today came back as %', v_offer.status; end if;
  select * into v_offer from public.firm_offers where id='00000000-0000-4000-8000-000000000098';
  if v_offer.status <> 'expired' then raise exception 'an offer that expired on the farm''s yesterday came back as %', v_offer.status; end if;
end $$;

-- ------------------------------------------------- 12b. a lost response is not a lost correction
-- The write commits, the HTTP response never arrives, and the form still holds the old version. The
-- farmer presses Save again. Without an operation id the second call is refused as stale, and there
-- is no way to tell that apart from a correction that never happened.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000d"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-00000000000d','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000072',1)::text)::text,false);
set role authenticated;
-- Each top-level statement below is its own transaction on purpose. now() is the TRANSACTION
-- timestamp, so an insert and an edit inside one do-block would share it, updated_at would not move,
-- and the stale check at the end would pass for the wrong reason. Splitting them is what makes the
-- difference between "the retry was recognised" and "nothing changed" observable at all.
create temporary table gl3_retry_state(operation uuid, stamp timestamptz);

insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,cash_price)
values ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000072',2026,'corn_yellow','forward_cash','Retry Buyer',4000,4.5);

insert into gl3_retry_state(operation, stamp)
select gen_random_uuid(), updated_at from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a1';

do $$
declare v_first jsonb; v_state gl3_retry_state%rowtype;
begin
  select * into v_state from gl3_retry_state;
  v_first := public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','buyer typed wrong','{"buyer":"Retry Buyer Fixed"}'::jsonb, v_state.stamp, v_state.operation);
  if v_first->>'buyer' <> 'Retry Buyer Fixed' then raise exception 'the first correction did not land'; end if;
end $$;

do $$
declare v_retry jsonb; v_state gl3_retry_state%rowtype; v_failed boolean;
begin
  select * into v_state from gl3_retry_state;
  if (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a1') = v_state.stamp
    then raise exception 'updated_at did not move, so this block cannot tell a recognised retry from a no-op'; end if;

  -- the retry the farmer makes: same operation id, the version the page still holds
  v_retry := public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','buyer typed wrong','{"buyer":"Retry Buyer Fixed"}'::jsonb, v_state.stamp, v_state.operation);
  if v_retry->>'buyer' <> 'Retry Buyer Fixed' then raise exception 'the retry did not report the correction that had already landed'; end if;
  if (select count(*) from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-0000000000a1') <> 1
    then raise exception 'the retry wrote a second audit row for one correction'; end if;

  -- a DIFFERENT correction from the same stale page is still refused; idempotency is not a bypass
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','something else','{"buyer":"Third Buyer"}'::jsonb, v_state.stamp, gen_random_uuid());
  exception when others then v_failed := sqlerrm = 'FARM_RX_STALE_WRITE'; end;
  if not v_failed then raise exception 'a new correction from a stale page was accepted'; end if;

  -- and a correction with no operation id at all is refused outright
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','no operation id','{"buyer":"Fourth Buyer"}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a1'), null);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a correction with no operation id was accepted'; end if;

  -- Reusing the id with DIFFERENT content is not a retry. Answering it with the earlier row would
  -- report success while dropping what the farmer just typed, so it must say what really happened.
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','buyer typed wrong','{"buyer":"Different Buyer Entirely"}'::jsonb, v_state.stamp, v_state.operation);
  exception when others then v_failed := sqlerrm = 'FARM_RX_CORRECTION_ALREADY_SAVED'; end;
  if not v_failed then raise exception 'a changed draft reusing an operation id was answered as a retry'; end if;
  if (select buyer from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a1') <> 'Retry Buyer Fixed'
    then raise exception 'the mismatched replay changed the contract'; end if;
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','a different reason this time','{"buyer":"Retry Buyer Fixed"}'::jsonb, v_state.stamp, v_state.operation);
  exception when others then v_failed := sqlerrm = 'FARM_RX_CORRECTION_ALREADY_SAVED'; end;
  if not v_failed then raise exception 'a changed REASON reusing an operation id was answered as a retry'; end if;

  -- A replay must hand back the row THIS operation produced, not whatever the row is now. If it
  -- returned a later member's version, the browser would record that as the version its own save
  -- wrote, skip rebasing, and then overwrite their work with the values it still holds. The other
  -- member's change goes through the RPC, the way a real one would -- a direct UPDATE is revoked.
  perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','another member corrects it','{"buyer":"Someone Else Corrected This"}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a1'), gen_random_uuid());
  v_retry := public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','buyer typed wrong','{"buyer":"Retry Buyer Fixed"}'::jsonb, v_state.stamp, v_state.operation);
  if v_retry->>'buyer' <> 'Retry Buyer Fixed'
    then raise exception 'the replay handed back a later version (%) instead of what this operation produced', v_retry->>'buyer'; end if;
  -- put it back so the blocks below read the contract they were written against
  perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','restore for the next block','{"buyer":"Retry Buyer Fixed"}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a1'), gen_random_uuid());

  -- The contract is part of the identity too. An id spent on one contract must not answer for
  -- another, even when the reason and the requested change are word for word the same.
  insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,cash_price)
  values ('00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-000000000072',2026,'corn_yellow','forward_cash','Other Contract',2000,4.5);
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a2','buyer typed wrong','{"buyer":"Retry Buyer Fixed"}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a2'), v_state.operation);
  exception when others then v_failed := sqlerrm = 'FARM_RX_CORRECTION_ALREADY_SAVED'; end;
  if not v_failed then raise exception 'an operation id spent on one contract answered for another'; end if;
  if (select buyer from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a2') <> 'Other Contract'
    then raise exception 'the cross-contract replay changed the second contract'; end if;
end $$;

-- ------------------------------------------------- 12c. a correction has to correct something
-- The browser refuses an empty change, but this function is reachable without the browser. A no-op
-- would write an audit row for nothing and move updated_at, turning every other open draft stale.
set role authenticated;
do $$
declare v_failed boolean; v_stamp timestamptz; v_rows integer;
begin
  select updated_at into v_stamp from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a1';
  v_rows := (select count(*) from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-0000000000a1');

  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','empty payload','{}'::jsonb, v_stamp, gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'an empty correction was accepted'; end if;

  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','null payload', null, v_stamp, gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a null correction was accepted'; end if;

  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','unknown keys only','{"crop_year":2027,"cash_price":9.99}'::jsonb, v_stamp, gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a payload of unsupported keys was accepted'; end if;

  -- naming a field is not changing it
  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-0000000000a1','same value again','{"buyer":"Retry Buyer Fixed"}'::jsonb, v_stamp, gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a correction that changes nothing was accepted'; end if;

  if (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a1') <> v_stamp
    then raise exception 'a refused no-op still moved updated_at and made other drafts stale'; end if;
  if (select count(*) from public.grain_contract_audit where grain_contract_id='00000000-0000-4000-8000-0000000000a1') <> v_rows
    then raise exception 'a refused no-op still wrote an audit row'; end if;
  if (select crop_year from public.grain_contracts where id='00000000-0000-4000-8000-0000000000a1') <> 2026
    then raise exception 'an unsupported key reached the contract'; end if;
end $$;
reset role;

drop table gl3_retry_state;

-- ------------------------------------------------- 13. a worker without financial access is refused
-- can_edit_farm admits a worker, but Grain is behind can_read_private_financials and these functions
-- are security definer, so one fence alone would let a worker who kept a contract id reach past
-- row-level security and rewrite private money.
insert into public.farm_memberships(farm_id,user_id,role,status,can_view_financials)
values ('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-00000000000f','worker','active',false);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000f"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-00000000000f','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000072',1)::text)::text,false);
set role authenticated;
do $$
declare v_failed boolean; v_buyer text;
begin
  if not public.can_edit_farm('00000000-0000-4000-8000-000000000072')
    then raise exception 'the worker fixture cannot edit the farm at all; this assertion proves nothing'; end if;
  if public.can_read_private_financials('00000000-0000-4000-8000-000000000072')
    then raise exception 'the worker fixture has financial access; this assertion proves nothing'; end if;

  v_failed := false;
  begin perform public.edit_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000091','worker attempt','{"buyer":"Worker Edit"}'::jsonb, (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000091'), gen_random_uuid());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a worker without financial access edited a contract'; end if;

  v_failed := false;
  begin perform public.delete_grain_contract('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000091','worker attempt', (select updated_at from public.grain_contracts where id='00000000-0000-4000-8000-000000000091'));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a worker without financial access deleted a contract'; end if;

  select buyer into v_buyer from public.grain_contracts where id='00000000-0000-4000-8000-000000000091';
  if v_buyer <> 'Delivered Buyer' then raise exception 'a refused worker still changed the contract'; end if;
end $$;
reset role;

-- ------------------------------------------------- 14. the audited actions are the only way in
-- An audited action is pointless while the direct path stays open: module 2 granted authenticated
-- UPDATE and DELETE on grain_contracts, so an editor could change or remove one straight through
-- PostgREST with no reason, no audit row and no deliveries check.
do $$
begin
  if has_table_privilege('authenticated','public.grain_contracts','update')
    then raise exception 'a contract can still be updated directly, bypassing the audited correction'; end if;
  if has_table_privilege('authenticated','public.grain_contracts','delete')
    then raise exception 'a contract can still be deleted directly, bypassing the audited delete'; end if;
  -- insert stays: a new contract has nothing to correct yet, and the form creates one directly.
  if not has_table_privilege('authenticated','public.grain_contracts','insert')
    then raise exception 'a new contract can no longer be created'; end if;
  if not has_table_privilege('authenticated','public.grain_contracts','select')
    then raise exception 'contracts can no longer be read'; end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='grain_contracts' and policyname in ('grain_contracts_update','grain_contracts_delete'))
    then raise exception 'the direct mutation policies are still in place'; end if;
end $$;

-- The same two probes the 0033 PowerShell lane makes, run here because that lane cannot run on a
-- development machine and its expectations changed with this revoke. Privilege is now the outer
-- fence for a signed-in client; the 0033 trigger still guards any caller that does hold the
-- privilege, and losing either would be a real regression.
insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,futures_price)
values ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-000000000072',2026,'corn_yellow','hta','Pricing Fence Buyer',100,5);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000d"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-00000000000d','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000072',1)::text)::text,false);
set role authenticated;
do $$
begin
  begin
    update public.grain_contracts set basis = -0.20, cash_price = 4.80 where id = '00000000-0000-4000-8000-0000000000b1';
    raise exception 'a signed-in client updated a contract directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  begin
    update public.grain_contracts set basis = -0.20, cash_price = 4.80 where id = '00000000-0000-4000-8000-0000000000b1';
    raise exception 'a privileged caller changed basis and HTA pricing outside the finalization rule';
  exception when others then
    if position('only be finalized through the price-finalization action' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- ------------------------------------------------- 14b. the 0043 definer allowlist still matches
-- 0043 keeps an exact allowlist of SECURITY DEFINER functions that `authenticated` may execute, by
-- name AND identity arguments, plus a total count. Adding an RPC without updating it turns Foundation
-- red -- which is how this tranche learned the lane exists. That lane is PowerShell and cannot run on
-- a development machine, so the two things most likely to be wrong are checked here: the exact
-- argument text the allowlist has to carry, and the total the count has to be raised to.
do $$
declare v_args text; v_total integer;
begin
  select pg_catalog.pg_get_function_identity_arguments(p.oid) into v_args
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'edit_grain_contract';
  if v_args is distinct from 'p_farm_id uuid, p_contract_id uuid, p_reason text, p_changes jsonb, p_expected_updated_at timestamp with time zone, p_operation_id uuid'
    then raise exception 'edit_grain_contract identity arguments are %, which is not what the 0043 allowlist carries', v_args; end if;

  select pg_catalog.pg_get_function_identity_arguments(p.oid) into v_args
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'delete_grain_contract';
  if v_args is distinct from 'p_farm_id uuid, p_contract_id uuid, p_reason text, p_expected_updated_at timestamp with time zone'
    then raise exception 'delete_grain_contract identity arguments are %, which is not what the 0043 allowlist carries', v_args; end if;

  select count(*) into v_total
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute');
  if v_total <> 58 then raise exception 'authenticated can execute % security definer functions; the 0043 lane expects 58', v_total; end if;

  -- neither may be reachable anonymously, which the allowlist join also requires
  if has_function_privilege('anon', 'public.edit_grain_contract(uuid,uuid,text,jsonb,timestamptz,uuid)', 'execute')
     or has_function_privilege('anon', 'public.delete_grain_contract(uuid,uuid,text,timestamptz)', 'execute')
    then raise exception 'a contract repair function is executable anonymously'; end if;
end $$;

-- ------------------------------------------------- 15. every farm-scoped table is epoch-fenced
-- Migration 0040 requires the farm_access_epoch_guard trigger on EVERY public table carrying a
-- farm_id. The PowerShell 0040 lane already checks this, but only in CI -- which is how GL-3b's new
-- audit table reached a pull request red. The same query runs here so a missing guard on any future
-- farm-scoped table is caught on this machine, before the push, not twenty minutes later.
do $$
declare v_missing text;
begin
  select string_agg(column_row.table_name, ', ' order by column_row.table_name) into v_missing
  from information_schema.columns column_row
  where column_row.table_schema = 'public' and column_row.column_name = 'farm_id'
    and column_row.table_name <> 'farm_access_epochs'
    and exists (
      select 1 from pg_catalog.pg_class base_relation
      join pg_catalog.pg_namespace base_namespace on base_namespace.oid = base_relation.relnamespace
      where base_namespace.nspname = 'public' and base_relation.relname = column_row.table_name
        and base_relation.relkind in ('r', 'p')
    )
    and not exists (
      select 1 from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and relation.relname = column_row.table_name
        and trigger_row.tgname = 'farm_access_epoch_guard' and not trigger_row.tgisinternal
    );
  if v_missing is not null then raise exception 'farm-scoped tables without the access epoch guard: %', v_missing; end if;
end $$;

reset role;
select set_config('request.headers','',false);
select set_config('request.jwt.claims','',false);
select 'GL3_CONTRACT_EDIT_DELETE_DISPOSABLE_PASS' as result;
