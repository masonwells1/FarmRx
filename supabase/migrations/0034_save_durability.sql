-- DRAFT ONLY.  This migration is intentionally not applied by this repair.
-- All per-budget writers take the same advisory lock first.  That ordering is
-- vital while old clients can still invoke the three-argument matrix RPC.
create or replace function public.replace_profitability_matrix_steps(
  p_farm_id uuid, p_budget_id uuid, p_steps jsonb, p_expected_steps jsonb
) returns setof public.profitability_matrix_steps
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_current jsonb; v_expected jsonb;
begin
  if auth.uid() is null then raise exception 'authentication is required'; end if;
  if not public.can_edit_farm(p_farm_id) or not public.can_read_private_financials(p_farm_id) then raise exception 'you do not have permission to edit this farm''s profitability'; end if;
  -- MUST remain before every row lock/read: the legacy overload takes this too.
  perform pg_advisory_xact_lock(hashtextextended(p_budget_id::text, 0));
  if not exists (select 1 from public.crop_budgets where id = p_budget_id and farm_id = p_farm_id for update) then raise exception 'budget does not belong to this farm'; end if;
  perform 1 from public.profitability_matrix_steps where farm_id = p_farm_id and budget_id = p_budget_id for update;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'budget_id', budget_id, 'axis', axis, 'value', value, 'sort_order', step_order) order by axis, step_order, id), '[]'::jsonb) into v_current from public.profitability_matrix_steps where farm_id = p_farm_id and budget_id = p_budget_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.value->>'id', 'budget_id', e.value->>'budget_id', 'axis', e.value->>'axis', 'value', (e.value->>'value')::numeric, 'sort_order', (e.value->>'sort_order')::integer) order by e.value->>'axis', (e.value->>'sort_order')::integer, e.value->>'id'), '[]'::jsonb) into v_expected from jsonb_array_elements(coalesce(p_expected_steps, '[]'::jsonb)) e;
  if p_expected_steps is not null and v_current <> v_expected then raise exception 'MATRIX_CHANGED_ON_ANOTHER_DEVICE'; end if;
  return query select * from public.replace_profitability_matrix_steps(p_farm_id, p_budget_id, p_steps);
end;
$$;
revoke all on function public.replace_profitability_matrix_steps(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.replace_profitability_matrix_steps(uuid, uuid, jsonb, jsonb) to authenticated;

-- The stable client id is the idempotency key.  A replay is success only when
-- the complete persisted operation is identical; it never re-runs replacement.
create or replace function public.create_crop_budget_with_matrix(
  p_farm_id uuid, p_budget jsonb, p_matrix_steps jsonb
) returns public.crop_budgets
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid := (p_budget->>'id')::uuid; v_existing public.crop_budgets%rowtype; v_current jsonb; v_expected jsonb;
begin
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) or not public.can_read_private_financials(p_farm_id) then raise exception 'you do not have permission to edit this farm''s profitability'; end if;
  if jsonb_typeof(p_budget) <> 'object' or jsonb_typeof(p_matrix_steps) <> 'array' or v_id is null or (p_budget->>'farm_id')::uuid <> p_farm_id then raise exception 'invalid create budget operation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_id::text, 0));
  select * into v_existing from public.crop_budgets where id = v_id for update;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'budget_id', budget_id::text, 'axis', axis, 'value', value, 'sort_order', step_order) order by axis, step_order, id), '[]'::jsonb) into v_current from public.profitability_matrix_steps where farm_id = p_farm_id and budget_id = v_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', e.value->>'id', 'budget_id', e.value->>'budget_id', 'axis', e.value->>'axis', 'value', (e.value->>'value')::numeric, 'sort_order', (e.value->>'sort_order')::integer) order by e.value->>'axis', (e.value->>'sort_order')::integer, e.value->>'id'), '[]'::jsonb) into v_expected from jsonb_array_elements(p_matrix_steps) e;
    if v_existing.farm_id = p_farm_id and jsonb_build_object('id',v_existing.id::text,'farm_id',v_existing.farm_id::text,'crop_year',v_existing.crop_year,'commodity_id',v_existing.commodity_id,'operating_entity_id',v_existing.operating_entity_id,'enterprise_label',v_existing.enterprise_label,'name',v_existing.name,'expected_yield_per_acre',v_existing.expected_yield_per_acre,'expected_price_per_bushel',v_existing.expected_price_per_bushel,'rp_coverage_pct',v_existing.rp_coverage_pct,'rp_aph_yield',v_existing.rp_aph_yield,'rp_projected_price',v_existing.rp_projected_price,'rp_premium_per_acre',v_existing.rp_premium_per_acre,'copied_from_budget_id',v_existing.copied_from_budget_id,'notes',v_existing.notes) = p_budget and v_current = v_expected then return v_existing; end if;
    raise exception 'CREATE_BUDGET_OPERATION_CONFLICT';
  end if;
  insert into public.crop_budgets (id,farm_id,crop_year,commodity_id,operating_entity_id,enterprise_label,name,expected_yield_per_acre,expected_price_per_bushel,rp_coverage_pct,rp_aph_yield,rp_projected_price,rp_premium_per_acre,copied_from_budget_id,notes)
  values (v_id,p_farm_id,(p_budget->>'crop_year')::integer,p_budget->>'commodity_id',nullif(p_budget->>'operating_entity_id','')::uuid,nullif(p_budget->>'enterprise_label',''),p_budget->>'name',(p_budget->>'expected_yield_per_acre')::numeric,(p_budget->>'expected_price_per_bushel')::numeric,nullif(p_budget->>'rp_coverage_pct','')::numeric,nullif(p_budget->>'rp_aph_yield','')::numeric,nullif(p_budget->>'rp_projected_price','')::numeric,nullif(p_budget->>'rp_premium_per_acre','')::numeric,nullif(p_budget->>'copied_from_budget_id','')::uuid,p_budget->>'notes') returning * into v_existing;
  perform public.replace_profitability_matrix_steps(p_farm_id, v_id, p_matrix_steps);
  return v_existing;
end;
$$;
revoke all on function public.create_crop_budget_with_matrix(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_crop_budget_with_matrix(uuid, jsonb, jsonb) to authenticated;

create or replace function public.copy_crop_budget_durable(
  p_farm_id uuid, p_source_id uuid, p_budget jsonb, p_cost_lines jsonb, p_matrix_steps jsonb
) returns public.crop_budgets
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid := (p_budget->>'id')::uuid; v_existing public.crop_budgets%rowtype; v_current jsonb; v_expected jsonb; v_cost_current jsonb; v_cost_expected jsonb;
begin
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) or not public.can_read_private_financials(p_farm_id) then raise exception 'you do not have permission to edit this farm''s profitability'; end if;
  if v_id is null then raise exception 'invalid copy budget operation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_id::text, 0));
  select * into v_existing from public.crop_budgets where id = v_id for update;
  if found then
    -- Lock and compare cost lines too. A stable copy id is an idempotency key only
    -- when every persisted child row matches the original operation.
    perform 1 from public.budget_cost_lines where farm_id=p_farm_id and budget_id=v_id for update;
    select coalesce(jsonb_agg(jsonb_build_object('id',id::text,'farm_id',farm_id::text,'budget_id',budget_id::text,'category',category,'label',label,'amount_per_acre',amount_per_acre,'source_kind',source_kind,'source_record_id',source_record_id,'sort_order',sort_order,'notes',notes) order by id), '[]'::jsonb) into v_cost_current from public.budget_cost_lines where farm_id=p_farm_id and budget_id=v_id;
    select coalesce(jsonb_agg(jsonb_build_object('id',e.value->>'id','farm_id',e.value->>'farm_id','budget_id',e.value->>'budget_id','category',e.value->>'category','label',e.value->>'label','amount_per_acre',(e.value->>'amount_per_acre')::numeric,'source_kind',e.value->>'source_kind','source_record_id',nullif(e.value->>'source_record_id','')::uuid,'sort_order',(e.value->>'sort_order')::integer,'notes',e.value->'notes') order by e.value->>'id'), '[]'::jsonb) into v_cost_expected from jsonb_array_elements(p_cost_lines) e;
    select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'budget_id', budget_id::text, 'axis', axis, 'value', value, 'sort_order', step_order) order by axis, step_order, id), '[]'::jsonb) into v_current from public.profitability_matrix_steps where farm_id=p_farm_id and budget_id=v_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', e.value->>'id', 'budget_id', e.value->>'budget_id', 'axis', e.value->>'axis', 'value', (e.value->>'value')::numeric, 'sort_order', (e.value->>'sort_order')::integer) order by e.value->>'axis', (e.value->>'sort_order')::integer, e.value->>'id'), '[]'::jsonb) into v_expected from jsonb_array_elements(p_matrix_steps) e;
    if v_existing.farm_id=p_farm_id and v_existing.copied_from_budget_id=p_source_id and jsonb_build_object('id',v_existing.id::text,'farm_id',v_existing.farm_id::text,'crop_year',v_existing.crop_year,'commodity_id',v_existing.commodity_id,'operating_entity_id',v_existing.operating_entity_id,'enterprise_label',v_existing.enterprise_label,'name',v_existing.name,'expected_yield_per_acre',v_existing.expected_yield_per_acre,'expected_price_per_bushel',v_existing.expected_price_per_bushel,'rp_coverage_pct',v_existing.rp_coverage_pct,'rp_aph_yield',v_existing.rp_aph_yield,'rp_projected_price',v_existing.rp_projected_price,'rp_premium_per_acre',v_existing.rp_premium_per_acre,'copied_from_budget_id',v_existing.copied_from_budget_id,'notes',v_existing.notes)=p_budget and v_cost_current=v_cost_expected and v_current=v_expected then return v_existing; end if;
    raise exception 'COPY_BUDGET_OPERATION_CONFLICT';
  end if;
  v_existing := public.copy_crop_budget(p_farm_id,p_source_id,p_budget,p_cost_lines,p_matrix_steps);
  update public.crop_budgets set rp_coverage_pct=nullif(p_budget->>'rp_coverage_pct','')::numeric,rp_aph_yield=nullif(p_budget->>'rp_aph_yield','')::numeric,rp_projected_price=nullif(p_budget->>'rp_projected_price','')::numeric,rp_premium_per_acre=nullif(p_budget->>'rp_premium_per_acre','')::numeric where id=v_id and farm_id=p_farm_id returning * into v_existing;
  return v_existing;
end;
$$;
revoke all on function public.copy_crop_budget_durable(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.copy_crop_budget_durable(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
