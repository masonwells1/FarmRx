# Programs Chunk 1 — TEST behavior proof plan

Run this only in the Supabase SQL editor for the disposable TEST project, after
an adversarial review and after `0024_programs.sql` has been applied there by
the owner. Never run it against production. The script wraps every fixture and
receipt in one transaction and ends with `rollback`, so a successful run leaves
no Programs rows behind.

## Required TEST seed

The TEST project must contain:

- one farm with active `owner`, `worker`, and `read_only` memberships;
- on that farm, one physical field with at least two `crop_assignments` (the
  double-crop proof uses the two exact crop rows);
- an explicitly enabled representative grant for that farm (the rep must be
  able to read shared rows but must not be able to write them);
- a second farm with an active owner and at least one crop assignment (for
  real cross-farm program/pass/product/assignment/application UUIDs).

The script fails immediately if those facts are missing. It impersonates users
by switching to the `authenticated` database role and setting the same JWT
claims that `auth.uid()` reads.

## One-shot SQL proof

```sql
begin;

create temp table programs_test_ctx (
  farm_a uuid not null,
  owner_a uuid not null,
  worker_a uuid not null,
  read_only_a uuid not null,
  rep_a uuid not null,
  crop_a uuid not null,
  crop_a_sibling uuid not null,
  farm_b uuid not null,
  owner_b uuid not null,
  crop_b uuid not null,
  program_a uuid,
  program_a2 uuid,
  pass_a uuid,
  assignment_a uuid,
  parallel_assignment uuid,
  sibling_assignment uuid,
  program_b uuid,
  pass_b uuid,
  product_b uuid,
  assignment_b uuid,
  assigned_pass_b uuid,
  assigned_product_b uuid,
  application_b uuid,
  replay_operation uuid,
  first_result jsonb
);

with candidate as (
  select
    f.id as farm_id,
    min(fm.user_id) filter (where fm.role = 'owner' and fm.status = 'active') as owner_id,
    min(fm.user_id) filter (where fm.role = 'worker' and fm.status = 'active') as worker_id,
    min(fm.user_id) filter (where fm.role = 'read_only' and fm.status = 'active') as read_only_id
  from public.farms f
  join public.farm_memberships fm on fm.farm_id = f.id
  group by f.id
  having min(fm.user_id) filter (where fm.role = 'owner' and fm.status = 'active') is not null
     and min(fm.user_id) filter (where fm.role = 'worker' and fm.status = 'active') is not null
     and min(fm.user_id) filter (where fm.role = 'read_only' and fm.status = 'active') is not null
), double_crop as (
  select ca.farm_id, ca.field_id, min(ca.id) as crop_1, max(ca.id) as crop_2
  from public.crop_assignments ca
  group by ca.farm_id, ca.field_id
  having count(*) >= 2
)
insert into programs_test_ctx (
  farm_a, owner_a, worker_a, read_only_a, rep_a, crop_a, crop_a_sibling,
  farm_b, owner_b, crop_b, replay_operation
)
select
  c.farm_id, c.owner_id, c.worker_id, c.read_only_id, rep.rep_user_id,
  dc.crop_1, dc.crop_2, fb.farm_id, fb.owner_id, fb.crop_id, gen_random_uuid()
from candidate c
join double_crop dc on dc.farm_id = c.farm_id
join public.farms fa on fa.id=c.farm_id and fa.share_with_rep=true
cross join lateral (
  select fra.rep_user_id
  from public.farm_rep_access fra
  where fra.farm_id=c.farm_id and fra.enabled=true and fra.revoked_at is null
  order by fra.rep_user_id limit 1
) rep
cross join lateral (
  select fm.farm_id, min(fm.user_id) as owner_id, min(ca.id) as crop_id
  from public.farm_memberships fm
  join public.crop_assignments ca on ca.farm_id=fm.farm_id
  where fm.farm_id <> c.farm_id and fm.role = 'owner' and fm.status = 'active'
  group by fm.farm_id
  order by fm.farm_id
  limit 1
) fb
where not exists (
  select 1 from public.program_assignments pa
  where pa.farm_id = c.farm_id
    and pa.crop_assignment_id in (dc.crop_1, dc.crop_2)
    and pa.status = 'active'
)
order by c.farm_id
limit 1;

do $$
begin
  if (select count(*) from programs_test_ctx) <> 1 then
    raise exception 'TEST seed is missing roles, enabled rep access, double-crop field, or second-farm crop';
  end if;
end
$$;

grant select, update on programs_test_ctx to authenticated;

-- A. Owner B creates a real foreign-farm program UUID.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select owner_b from programs_test_ctx),
    'role', 'authenticated'
  )::text,
  true
);
update programs_test_ctx
set program_b = (
  public.save_program(
    farm_b,
    gen_random_uuid(),
    jsonb_build_object(
      'id', null,
      'name', 'Chunk 1 cross-farm sentinel',
      'program_kind', 'other',
      'commodity_id', null,
      'crop_year', null,
      'notes', 'Rolled back proof fixture'
    )
  ) #>> '{program,id}'
)::uuid;
update programs_test_ctx
set first_result = public.save_program_pass(
  farm_b,gen_random_uuid(),program_b,
  jsonb_build_object('id',null,'name','Foreign pass','pass_type','custom',
    'activity_type','other','timing_label',null,'target_date',current_date::text,
    'planting_offset_days',null,'reminder_lead_days',0,'notes',null),
  jsonb_build_array(jsonb_build_object('id',null,'product_name','Foreign product',
    'rate_text','1','unit_text','unit/ac','estimated_cost_per_acre',1,'notes',null)),null
);
update programs_test_ctx
set pass_b=(first_result#>>'{pass,id}')::uuid,
    product_b=(first_result#>>'{products,0,id}')::uuid;
update programs_test_ctx
set assignment_b=(public.assign_program(farm_b,gen_random_uuid(),program_b,array[crop_b])
  #>>'{assignments,0,assignment_id}')::uuid;
update programs_test_ctx x
set assigned_pass_b=ap.id,
    assigned_product_b=(select app.id from public.assigned_program_pass_products app
      where app.farm_id=x.farm_b and app.assigned_pass_id=ap.id order by app.id limit 1)
from public.assigned_program_passes ap
where ap.farm_id=x.farm_b and ap.assignment_id=x.assignment_b
  and ap.source_program_pass_id=x.pass_b;
update programs_test_ctx set application_b=gen_random_uuid();
insert into public.application_records(
  id,farm_id,field_id,crop_assignment_id,status,application_date,applied_acres,
  created_by,notes
)
select x.application_b,x.farm_b,ca.field_id,x.crop_b,'draft',current_date,
  least(ca.planted_acres,1::numeric),x.owner_b,'Cross-farm rejection sentinel'
from programs_test_ctx x
join public.crop_assignments ca on ca.id=x.crop_b and ca.farm_id=x.farm_b;
reset role;

-- B. Worker creates a program and a pass with one free-typed product.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select worker_a from programs_test_ctx),
    'role', 'authenticated'
  )::text,
  true
);
update programs_test_ctx
set first_result =
  public.save_program(
    farm_a,
    replay_operation,
    jsonb_build_object(
      'id', null,
      'name', 'Chunk 1 Chemical',
      'program_kind', 'chemical',
      'commodity_id', null,
      'crop_year', null,
      'notes', 'Worker-created proof fixture'
    )
  );
update programs_test_ctx
set program_a = (first_result #>> '{program,id}')::uuid;

update programs_test_ctx
set pass_a = (
  public.save_program_pass(
    farm_a,
    gen_random_uuid(),
    program_a,
    jsonb_build_object(
      'id', null,
      'name', 'Post',
      'pass_type', 'post',
      'activity_type', 'spray',
      'timing_label', 'V4-V6',
      'target_date', (current_date + 7)::text,
      'planting_offset_days', null,
      'reminder_lead_days', 3,
      'notes', 'Exact-scope proof'
    ),
    jsonb_build_array(jsonb_build_object(
      'id', null,
      'product_name', 'Free-type product',
      'rate_text', '24',
      'unit_text', 'oz/ac',
      'estimated_cost_per_acre', 12.3456,
      'notes', null
    )),
    null
  ) #>> '{pass,id}'
)::uuid;

update programs_test_ctx
set assignment_a = (
  public.assign_program(
    farm_a,
    gen_random_uuid(),
    program_a,
    array[crop_a]
  ) #>> '{assignments,0,assignment_id}'
)::uuid;

do $$
begin
  if not exists (
    select 1 from public.programs p
    join programs_test_ctx x on x.program_a = p.id and x.farm_a = p.farm_id
    where p.created_by = x.worker_a
  ) or not exists (
    select 1 from public.program_passes pp
    join programs_test_ctx x on x.pass_a = pp.id and x.farm_a = pp.farm_id
    where pp.created_by = x.worker_a
  ) or not exists (
    select 1 from public.program_assignments pa
    join programs_test_ctx x on x.assignment_a = pa.id and x.farm_a = pa.farm_id
    where pa.assigned_by = x.worker_a
  ) then
    raise exception 'FAIL: worker did not create the program/pass/assignment graph';
  end if;
  raise notice 'PASS: worker can create program, pass, product, and assignment';
end
$$;

-- C. Same-caller receipt replay returns byte-for-byte equal JSON and no duplicate row.
do $$
declare
  v_first jsonb;
  v_replay jsonb;
  v_before bigint;
  v_after bigint;
begin
  select x.first_result into v_first from programs_test_ctx x;
  select count(*) into v_before from public.programs p
  join programs_test_ctx x on x.farm_a = p.farm_id
  where p.id = x.program_a;

  select public.save_program(
    x.farm_a,
    x.replay_operation,
    jsonb_build_object(
      'id', null,
      'name', 'payload is ignored on completed replay',
      'program_kind', null,
      'commodity_id', null,
      'crop_year', null,
      'notes', null
    )
  ) into v_replay
  from programs_test_ctx x;

  select count(*) into v_after from public.programs p
  join programs_test_ctx x on x.farm_a = p.farm_id
  where p.id = x.program_a;
  if v_replay is distinct from v_first or v_before <> 1 or v_after <> 1 then
    raise exception 'FAIL: receipt replay changed the result or duplicated a program';
  end if;
  raise notice 'PASS: replay returned identical canonical receipt and no duplicate row';
end
$$;

-- D. A different caller cannot claim the worker's operation ID.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', (select owner_a from programs_test_ctx), 'role', 'authenticated')::text,
  true
);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.save_program(
      x.farm_a, x.replay_operation,
      jsonb_build_object('id',null,'name','wrong caller','program_kind',null,
        'commodity_id',null,'crop_year',null,'notes',null)
    ) from programs_test_ctx x;
  exception when others then
    v_denied := sqlerrm like '%another user%';
  end;
  if not v_denied then raise exception 'FAIL: caller-bound receipt was not enforced'; end if;
  raise notice 'PASS: receipt operation ID is caller-bound';
end
$$;

-- E. read_only can SELECT but cannot mutate through the RPC.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', (select read_only_a from programs_test_ctx), 'role', 'authenticated')::text,
  true
);
do $$
declare v_visible bigint; v_denied boolean := false;
begin
  select count(*) into v_visible from public.programs p
  join programs_test_ctx x on x.farm_a = p.farm_id and x.program_a = p.id;
  if v_visible <> 1 then raise exception 'FAIL: read_only member could not read the program'; end if;
  begin
    perform public.save_program(
      x.farm_a, gen_random_uuid(),
      jsonb_build_object('id',null,'name','must fail','program_kind','other',
        'commodity_id',null,'crop_year',null,'notes',null)
    ) from programs_test_ctx x;
  exception when others then
    v_denied := sqlerrm like '%permission%';
  end;
  if not v_denied then raise exception 'FAIL: read_only member mutated Programs'; end if;
  raise notice 'PASS: read_only can read and cannot write';
end
$$;

-- F. Two DIFFERENT programs coexist; the SAME program twice is rejected.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', (select worker_a from programs_test_ctx), 'role', 'authenticated')::text,
  true
);
update programs_test_ctx
set program_a2 = (
  public.save_program(
    farm_a, gen_random_uuid(),
    jsonb_build_object('id',null,'name','Chunk 1 Fertility','program_kind','fertility',
      'commodity_id',null,'crop_year',null,'notes',null)
  ) #>> '{program,id}'
)::uuid;
update programs_test_ctx
set parallel_assignment = (
  public.assign_program(farm_a,gen_random_uuid(),program_a2,array[crop_a])
  #>> '{assignments,0,assignment_id}'
)::uuid;

do $$
declare v_active integer; v_denied boolean := false;
begin
  select count(*) into v_active from public.program_assignments pa
  join programs_test_ctx x on x.farm_a=pa.farm_id and x.crop_a=pa.crop_assignment_id
  where pa.status='active' and pa.program_id in (x.program_a,x.program_a2);
  if v_active<>2 then raise exception 'FAIL: two different programs did not coexist'; end if;
  begin
    perform public.assign_program(x.farm_a,gen_random_uuid(),x.program_a,array[x.crop_a])
    from programs_test_ctx x;
  exception when others then
    v_denied := sqlerrm like '%already active%';
  end;
  if not v_denied then raise exception 'FAIL: duplicate same-program assignment was accepted'; end if;
  raise notice 'PASS: different programs coexist and same-program duplicate is rejected';
end
$$;

-- G. Fill the crop from 2 to 12 active programs; the thirteenth must fail.
do $$
declare
  x programs_test_ctx%rowtype;
  v_program uuid;
  v_count integer;
  v_denied boolean := false;
begin
  select * into x from programs_test_ctx;
  for i in 3..12 loop
    v_program := (public.save_program(
      x.farm_a,gen_random_uuid(),
      jsonb_build_object('id',null,'name','Cap fixture '||i,'program_kind','other',
        'commodity_id',null,'crop_year',null,'notes',null)
    ) #>> '{program,id}')::uuid;
    perform public.assign_program(x.farm_a,gen_random_uuid(),v_program,array[x.crop_a]);
  end loop;
  select count(*) into v_count from public.program_assignments pa
  where pa.farm_id=x.farm_a and pa.crop_assignment_id=x.crop_a and pa.status='active';
  if v_count<>12 then raise exception 'FAIL: expected 12 active programs, got %',v_count; end if;

  v_program := (public.save_program(
    x.farm_a,gen_random_uuid(),
    jsonb_build_object('id',null,'name','Cap fixture 13','program_kind','other',
      'commodity_id',null,'crop_year',null,'notes',null)
  ) #>> '{program,id}')::uuid;
  begin
    perform public.assign_program(x.farm_a,gen_random_uuid(),v_program,array[x.crop_a]);
  exception when others then
    v_denied := sqlerrm like '%12 active programs%';
  end;
  if not v_denied then raise exception 'FAIL: thirteenth active program was accepted'; end if;
  raise notice 'PASS: 12 active programs succeed and the thirteenth is rejected';
end
$$;

-- H. The same template assigned to the sibling crop row materializes independent passes.
update programs_test_ctx
set sibling_assignment = (
  public.assign_program(farm_a,gen_random_uuid(),program_a,array[crop_a_sibling])
  #>> '{assignments,0,assignment_id}'
)::uuid;
do $$
declare v_first uuid; v_sibling uuid; v_sibling_due date; v_new_due date;
begin
  select ap.id into v_first from public.assigned_program_passes ap
  join programs_test_ctx x on x.assignment_a=ap.assignment_id and x.farm_a=ap.farm_id
  order by ap.sequence,ap.id limit 1;
  select ap.id,ap.due_on into v_sibling,v_sibling_due from public.assigned_program_passes ap
  join programs_test_ctx x on x.sibling_assignment=ap.assignment_id and x.farm_a=ap.farm_id
  order by ap.sequence,ap.id limit 1;
  if v_first=v_sibling then raise exception 'FAIL: double-crop assignments share a pass row'; end if;
  v_new_due:=current_date+30;
  perform public.reschedule_program_pass(
    (select farm_a from programs_test_ctx),gen_random_uuid(),v_first,v_new_due,'manual proof date'
  );
  if (select due_on from public.assigned_program_passes where id=v_sibling) is distinct from v_sibling_due then
    raise exception 'FAIL: rescheduling one crop changed its sibling crop pass';
  end if;
  raise notice 'PASS: two crop_assignments on one field have independent pass IDs and dates';
end
$$;

-- I. Refresh retires removed products and synchronizes the open due card.
do $$
declare
  x programs_test_ctx%rowtype;
  v_template_product_id uuid;
  v_assigned_pass_id uuid;
  v_retired_assigned_product_id uuid;
  v_new_template_product_id uuid;
  v_new_assigned_product_id uuid;
  v_expected_title text;
begin
  select * into x from programs_test_ctx;
  select ppp.id into strict v_template_product_id
  from public.program_pass_products ppp
  where ppp.farm_id=x.farm_a and ppp.program_pass_id=x.pass_a and not ppp.is_archived;
  select ap.id into strict v_assigned_pass_id
  from public.assigned_program_passes ap
  where ap.farm_id=x.farm_a and ap.assignment_id=x.assignment_a
    and ap.source_program_pass_id=x.pass_a;
  select app.id into strict v_retired_assigned_product_id
  from public.assigned_program_pass_products app
  where app.farm_id=x.farm_a and app.assigned_pass_id=v_assigned_pass_id
    and app.source_program_pass_product_id=v_template_product_id;

  -- First make the untouched pass due now and create its open board card.
  perform public.save_program_pass(
    x.farm_a,gen_random_uuid(),x.program_a,
    jsonb_build_object('id',x.pass_a,'name','Post','pass_type','post',
      'activity_type','spray','timing_label','V4-V6','target_date',current_date::text,
      'planting_offset_days',null,'reminder_lead_days',3,'notes','Exact-scope proof'),
    jsonb_build_array(jsonb_build_object('id',v_template_product_id,
      'product_name','Free-type product','rate_text','24','unit_text','oz/ac',
      'estimated_cost_per_acre',12.3456,'notes',null)),null
  );
  perform public.refresh_program_assignment(x.farm_a,gen_random_uuid(),x.assignment_a);
  perform public.generate_due_program_items(x.farm_a,gen_random_uuid(),current_date);

  -- Remove the old template product, add a replacement, and move the template date.
  perform public.save_program_pass(
    x.farm_a,gen_random_uuid(),x.program_a,
    jsonb_build_object('id',x.pass_a,'name','Post refreshed','pass_type','post',
      'activity_type','spray','timing_label','V5','target_date',(current_date+2)::text,
      'planting_offset_days',null,'reminder_lead_days',3,'notes','Refresh proof'),
    jsonb_build_array(jsonb_build_object('id',null,
      'product_name','Replacement product','rate_text','16','unit_text','oz/ac',
      'estimated_cost_per_acre',7.5000,'notes','New current-plan line')),null
  );
  select ppp.id into strict v_new_template_product_id
  from public.program_pass_products ppp
  where ppp.farm_id=x.farm_a and ppp.program_pass_id=x.pass_a and not ppp.is_archived;

  perform public.refresh_program_assignment(x.farm_a,gen_random_uuid(),x.assignment_a);
  select app.id into strict v_new_assigned_product_id
  from public.assigned_program_pass_products app
  where app.farm_id=x.farm_a and app.assigned_pass_id=v_assigned_pass_id
    and app.source_program_pass_product_id=v_new_template_product_id;
  select left(pa.program_name_snapshot||' — '||ap.name||' — '||f.name,500)
  into strict v_expected_title
  from public.assigned_program_passes ap
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
  join public.fields f on f.id=ca.field_id and f.farm_id=ca.farm_id
  where ap.id=v_assigned_pass_id and ap.farm_id=x.farm_a;

  if (select is_active from public.assigned_program_pass_products
      where id=v_retired_assigned_product_id) is distinct from false
    or (select is_active from public.assigned_program_pass_products
      where id=v_new_assigned_product_id) is distinct from true then
    raise exception 'FAIL: refresh did not retire/remove and activate/add product snapshots';
  end if;
  if (select count(*) from public.program_assignment_tracker pat,
      lateral jsonb_array_elements(pat.passes) pass,
      lateral jsonb_array_elements(pass->'products') product
      where pat.farm_id=x.farm_a and pat.assignment_id=x.assignment_a
        and (product->>'id')::uuid=v_retired_assigned_product_id) <> 0
    or (select planned_cost_per_acre from public.program_assignment_costs
      where farm_id=x.farm_a and assignment_id=x.assignment_a) is distinct from 7.5000::numeric
    or (select planned_cost_per_acre from public.program_crop_cost_rollups
      where farm_id=x.farm_a and crop_assignment_id=x.crop_a) is distinct from 7.5000::numeric
    or exists(select 1 from public.program_application_products pap
      where pap.farm_id=x.farm_a and pap.assigned_product_id=v_retired_assigned_product_id) then
    raise exception 'FAIL: an inactive product still appears in a current tracker/cost/application read model';
  end if;
  if exists (
    select 1 from public.farm_tasks t
    where t.farm_id=x.farm_a and t.program_assigned_pass_id=v_assigned_pass_id
      and t.source='program' and t.status in ('todo','doing')
      and (t.due_on is distinct from current_date+2
        or t.details is distinct from 'Program pass due '||(current_date+2)::text
        or t.program_cycle_key is distinct from 'due:'||v_assigned_pass_id::text||':'||(current_date+2)::text
        or t.title is distinct from v_expected_title)
  ) or (select count(*) from public.farm_tasks t
    where t.farm_id=x.farm_a and t.program_assigned_pass_id=v_assigned_pass_id
      and t.source='program' and t.status in ('todo','doing')) <> 1 then
    raise exception 'FAIL: refresh did not move exactly one open task to the refreshed cycle';
  end if;
  raise notice 'PASS: refresh archives removed product history, excludes it from current cost, and moves the open task';
end
$$;

-- J. Rescheduling onto a terminal task cycle preserves terminal history and closes the obsolete open card.
do $$
declare
  x programs_test_ctx%rowtype;
  v_pass_id uuid;
  v_terminal_id uuid:=gen_random_uuid();
  v_target date:=current_date+1;
  v_terminal_before jsonb;
begin
  select * into x from programs_test_ctx;
  select ap.id into strict v_pass_id from public.assigned_program_passes ap
  where ap.farm_id=x.farm_a and ap.assignment_id=x.assignment_a
    and ap.source_program_pass_id=x.pass_a;
  insert into public.farm_tasks(
    id,farm_id,title,details,status,priority,due_on,source,
    program_assigned_pass_id,program_cycle_key,created_by
  ) values (
    v_terminal_id,x.farm_a,'Historical terminal cycle','Must remain unchanged','done','normal',
    v_target,'program',v_pass_id,'due:'||v_pass_id::text||':'||v_target::text,x.worker_a
  );
  select to_jsonb(t) into strict v_terminal_before from public.farm_tasks t where t.id=v_terminal_id;
  perform public.reschedule_program_pass(x.farm_a,gen_random_uuid(),v_pass_id,v_target,'collision proof');
  if (select to_jsonb(t)-'updated_at' from public.farm_tasks t where t.id=v_terminal_id)
       is distinct from (v_terminal_before-'updated_at')
    or exists(select 1 from public.farm_tasks t where t.farm_id=x.farm_a
      and t.program_assigned_pass_id=v_pass_id and t.source='program'
      and t.status in ('todo','doing'))
    or (select due_on from public.assigned_program_passes where id=v_pass_id) is distinct from v_target then
    raise exception 'FAIL: cycle collision rewrote terminal history, left an obsolete open card, or lost the pass date';
  end if;
  raise notice 'PASS: terminal cycle remains canonical and the obsolete open card closes without unique violation';
end
$$;

-- K. Repeated due generation uses different receipts but creates one row per exact task/notification key.
do $$
declare x programs_test_ctx%rowtype; v_pass_id uuid; v_due date:=current_date+1;
begin
  select * into x from programs_test_ctx;
  select ap.id into strict v_pass_id from public.assigned_program_passes ap
  where ap.farm_id=x.farm_a and ap.assignment_id=x.assignment_a
    and ap.source_program_pass_id=x.pass_a;
  perform public.generate_due_program_items(x.farm_a,gen_random_uuid(),current_date);
  perform public.generate_due_program_items(x.farm_a,gen_random_uuid(),current_date);
  if (select count(*) from public.farm_tasks t where t.farm_id=x.farm_a
      and t.program_assigned_pass_id=v_pass_id
      and t.program_cycle_key='due:'||v_pass_id::text||':'||v_due::text) <> 1
    or (select count(*) from public.notifications n where n.farm_id=x.farm_a
      and n.dedupe_key='program:'||v_pass_id::text||':due:'||v_due::text) <> 1 then
    raise exception 'FAIL: repeated due generation duplicated or lost an exact-cycle row';
  end if;
  raise notice 'PASS: repeated due generation leaves exactly one task and one notification for the cycle';
end
$$;

-- L. Apply changes only status/application facts and ACTIVE actual product facts.
do $$
declare
  x programs_test_ctx%rowtype;
  v_pass_id uuid;
  v_target_before date;
  v_offset_before smallint;
  v_expected_yield_before numeric;
  v_expected_price_before numeric;
  v_planting_before date;
  v_actual jsonb;
  v_result jsonb;
  v_on_hand_before jsonb;
  v_on_hand_after jsonb;
begin
  select * into x from programs_test_ctx;
  select ap.id,ap.target_date,ap.planting_offset_days,
         ca.expected_yield_per_acre,ca.expected_price_per_bu,ca.planting_date
  into v_pass_id,v_target_before,v_offset_before,
       v_expected_yield_before,v_expected_price_before,v_planting_before
  from public.assigned_program_passes ap
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
  where ap.assignment_id=x.assignment_a and ap.farm_id=x.farm_a
  order by ap.sequence,ap.id limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',app.id,
    'actual_product_name',app.product_name,
    'actual_rate_text',app.rate_text,
    'actual_unit_text',app.unit_text,
    'actual_cost_per_acre',app.estimated_cost_per_acre
  ) order by app.sequence,app.id),'[]'::jsonb)
  into v_actual
  from public.assigned_program_pass_products app
  where app.farm_id=x.farm_a and app.assigned_pass_id=v_pass_id and app.is_active;

  select coalesce(jsonb_agg(to_jsonb(ioh) order by ioh.product_id),'[]'::jsonb)
  into v_on_hand_before
  from public.inventory_on_hand ioh
  where ioh.farm_id=x.farm_a;

  select public.mark_program_pass_applied(
    x.farm_a,gen_random_uuid(),v_pass_id,current_date,
    least(1::numeric,(select planted_acres from public.crop_assignments where id=x.crop_a and farm_id=x.farm_a)),
    v_actual,null,false
  ) into v_result;

  select coalesce(jsonb_agg(to_jsonb(ioh) order by ioh.product_id),'[]'::jsonb)
  into v_on_hand_after
  from public.inventory_on_hand ioh
  where ioh.farm_id=x.farm_a;

  if exists(select 1 from public.program_application_products pap
      where pap.farm_id=x.farm_a and pap.assigned_pass_id=v_pass_id) then
    raise exception 'FAIL: no-record Apply appeared in the linked application-product read model';
  end if;

  if exists (
    select 1
    from public.assigned_program_passes ap
    join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
    join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
    where ap.id=v_pass_id and ap.farm_id=x.farm_a
      and (ap.status<>'applied'
        or ap.application_record_id is not null
        or ap.target_date is distinct from v_target_before
        or ap.planting_offset_days is distinct from v_offset_before
        or ca.expected_yield_per_acre is distinct from v_expected_yield_before
        or ca.expected_price_per_bu is distinct from v_expected_price_before
        or ca.planting_date is distinct from v_planting_before)
  ) then
    raise exception 'FAIL: Apply overwrote expected/planting/template timing facts';
  end if;
  if v_on_hand_after is distinct from v_on_hand_before then
    raise exception 'FAIL: applying with no application record changed inventory on-hand';
  end if;
  if (v_result->>'inventory_matched')::boolean
    or (v_result->>'inventory_on_hand_changed')::boolean then
    raise exception 'FAIL: no-record Apply returned incorrect inventory flags';
  end if;
  raise notice 'PASS: Apply with no application record wrote only its owned facts and left on-hand unchanged';
end
$$;

-- M. Pass and product moves use collision-safe temporary sequences and finish contiguous.
do $$
declare
  x programs_test_ctx%rowtype;
  v_pass_1 uuid; v_pass_2 uuid; v_product_1 uuid; v_product_2 uuid;
  v_result jsonb;
begin
  select * into x from programs_test_ctx;
  v_result:=public.save_program_pass(
    x.farm_a,gen_random_uuid(),x.program_a2,
    jsonb_build_object('id',null,'name','Order one','pass_type','custom',
      'activity_type','other','timing_label',null,'target_date',null,
      'planting_offset_days',null,'reminder_lead_days',0,'notes',null),
    jsonb_build_array(
      jsonb_build_object('id',null,'product_name','Order product one','rate_text','1',
        'unit_text','unit/ac','estimated_cost_per_acre',1,'notes',null),
      jsonb_build_object('id',null,'product_name','Order product two','rate_text','2',
        'unit_text','unit/ac','estimated_cost_per_acre',2,'notes',null)
    ),null
  );
  v_pass_1:=(v_result#>>'{pass,id}')::uuid;
  v_product_1:=(v_result#>>'{products,0,id}')::uuid;
  v_product_2:=(v_result#>>'{products,1,id}')::uuid;
  v_pass_2:=(public.save_program_pass(
    x.farm_a,gen_random_uuid(),x.program_a2,
    jsonb_build_object('id',null,'name','Order two','pass_type','custom',
      'activity_type','other','timing_label',null,'target_date',null,
      'planting_offset_days',null,'reminder_lead_days',0,'notes',null),
    '[]'::jsonb,v_pass_1
  )#>>'{pass,id}')::uuid;

  -- One save simultaneously moves the pass and reverses both product IDs.
  perform public.save_program_pass(
    x.farm_a,gen_random_uuid(),x.program_a2,
    jsonb_build_object('id',v_pass_1,'name','Order one','pass_type','custom',
      'activity_type','other','timing_label',null,'target_date',null,
      'planting_offset_days',null,'reminder_lead_days',0,'notes',null),
    jsonb_build_array(
      jsonb_build_object('id',v_product_2,'product_name','Order product two','rate_text','2',
        'unit_text','unit/ac','estimated_cost_per_acre',2,'notes',null),
      jsonb_build_object('id',v_product_1,'product_name','Order product one','rate_text','1',
        'unit_text','unit/ac','estimated_cost_per_acre',1,'notes',null)
    ),v_pass_2
  );
  if (select array_agg(pp.id order by pp.sequence) from public.program_passes pp
      where pp.farm_id=x.farm_a and pp.program_id=x.program_a2 and not pp.is_archived)
       is distinct from array[v_pass_2,v_pass_1]
    or (select array_agg(ppp.id order by ppp.sequence) from public.program_pass_products ppp
      where ppp.farm_id=x.farm_a and ppp.program_pass_id=v_pass_1 and not ppp.is_archived)
       is distinct from array[v_product_2,v_product_1] then
    raise exception 'FAIL: pass/product move collided or did not finish in exact requested order';
  end if;
  perform public.reorder_program_passes(
    x.farm_a,gen_random_uuid(),x.program_a2,array[v_pass_1,v_pass_2]
  );
  if exists(select 1 from public.program_passes pp where pp.farm_id=x.farm_a
      and pp.program_id=x.program_a2 and not pp.is_archived and pp.sequence not between 1 and 2)
    or (select array_agg(pp.sequence order by pp.sequence) from public.program_passes pp
      where pp.farm_id=x.farm_a and pp.program_id=x.program_a2 and not pp.is_archived)
       is distinct from array[1::smallint,2::smallint] then
    raise exception 'FAIL: reordered pass sequences are not exactly contiguous';
  end if;
  perform public.refresh_program_assignment(x.farm_a,gen_random_uuid(),x.parallel_assignment);
  raise notice 'PASS: pass and product reorder paths avoid unique collisions and finish contiguous';
end
$$;

-- N. Create makes a product-less draft; link accepts an existing non-voided draft.
-- Neither path posts inventory, and one parallel pass remains planned for later rejection proofs.
do $$
declare
  x programs_test_ctx%rowtype;
  v_create_pass_id uuid;
  v_link_pass_id uuid;
  v_created_application_id uuid:=gen_random_uuid();
  v_existing_application_id uuid:=gen_random_uuid();
  v_actual jsonb;
  v_result jsonb;
  v_on_hand_before jsonb;
  v_on_hand_after jsonb;
  v_link_date date:=current_date-1;
  v_link_acres numeric;
begin
  select * into x from programs_test_ctx;
  select coalesce(jsonb_agg(to_jsonb(ioh) order by ioh.product_id),'[]'::jsonb)
  into v_on_hand_before
  from public.inventory_on_hand ioh
  where ioh.farm_id=x.farm_a;

  select ap.id into strict v_create_pass_id
  from public.assigned_program_passes ap
  where ap.farm_id=x.farm_a and ap.assignment_id=x.sibling_assignment
    and ap.status='planned'
  order by ap.sequence,ap.id limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',app.id,'actual_product_name',app.product_name,
    'actual_rate_text',app.rate_text,'actual_unit_text',app.unit_text,
    'actual_cost_per_acre',app.estimated_cost_per_acre
  ) order by app.sequence,app.id),'[]'::jsonb)
  into v_actual
  from public.assigned_program_pass_products app
  where app.farm_id=x.farm_a and app.assigned_pass_id=v_create_pass_id and app.is_active;
  select public.mark_program_pass_applied(
    x.farm_a,gen_random_uuid(),v_create_pass_id,current_date,
    least(1::numeric,(select planted_acres from public.crop_assignments
      where id=x.crop_a_sibling and farm_id=x.farm_a)),
    v_actual,v_created_application_id,true
  ) into v_result;
  if not exists (
      select 1 from public.application_records ar
      where ar.id=v_created_application_id and ar.farm_id=x.farm_a
        and ar.crop_assignment_id=x.crop_a_sibling and ar.status='draft'
        and ar.completed_at is null
    ) or exists (
      select 1 from public.application_products ap
      where ap.application_id=v_created_application_id and ap.farm_id=x.farm_a
    ) or not exists (
      select 1 from public.assigned_program_passes ap
      where ap.id=v_create_pass_id and ap.farm_id=x.farm_a and ap.status='applied'
        and ap.application_record_id=v_created_application_id
    ) or (v_result->>'inventory_matched')::boolean
      or (v_result->>'inventory_on_hand_changed')::boolean then
    raise exception 'FAIL: create path did not leave a linked product-less draft with inventory flags false';
  end if;

  select least(ca.planted_acres,1::numeric) into strict v_link_acres
  from public.crop_assignments ca
  where ca.id=x.crop_a and ca.farm_id=x.farm_a;
  insert into public.application_records(
    id,farm_id,field_id,crop_assignment_id,status,application_date,applied_acres,
    created_by,notes
  )
  select v_existing_application_id,x.farm_a,ca.field_id,x.crop_a,'draft',
    v_link_date,v_link_acres,x.worker_a,'Existing draft link proof'
  from public.crop_assignments ca
  where ca.id=x.crop_a and ca.farm_id=x.farm_a;

  select ap.id into strict v_link_pass_id
  from public.assigned_program_passes ap
  where ap.farm_id=x.farm_a and ap.assignment_id=x.parallel_assignment
    and ap.status='planned'
  order by ap.sequence,ap.id limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',app.id,'actual_product_name',app.product_name,
    'actual_rate_text',app.rate_text,'actual_unit_text',app.unit_text,
    'actual_cost_per_acre',app.estimated_cost_per_acre
  ) order by app.sequence,app.id),'[]'::jsonb)
  into v_actual
  from public.assigned_program_pass_products app
  where app.farm_id=x.farm_a and app.assigned_pass_id=v_link_pass_id and app.is_active;
  perform public.mark_program_pass_applied(
    x.farm_a,gen_random_uuid(),v_link_pass_id,current_date,v_link_acres,
    v_actual,v_existing_application_id,false
  );
  if not exists (
      select 1 from public.assigned_program_passes ap
      where ap.id=v_link_pass_id and ap.farm_id=x.farm_a and ap.status='applied'
        and ap.application_record_id=v_existing_application_id
        and ap.applied_on=v_link_date and ap.applied_acres=v_link_acres
    ) or not exists (
      select 1 from public.assigned_program_passes ap
      where ap.farm_id=x.farm_a and ap.assignment_id=x.parallel_assignment
        and ap.status='planned'
    ) then
    raise exception 'FAIL: existing non-voided same-farm/same-crop draft was not linked canonically';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ioh) order by ioh.product_id),'[]'::jsonb)
  into v_on_hand_after
  from public.inventory_on_hand ioh
  where ioh.farm_id=x.farm_a;
  if v_on_hand_after is distinct from v_on_hand_before then
    raise exception 'FAIL: create-draft or link-existing path changed inventory on-hand';
  end if;
  if (select count(*) from public.program_application_products pap
      where pap.farm_id=x.farm_a and pap.assigned_pass_id=v_create_pass_id)
       <> (select count(*) from public.assigned_program_pass_products app
      where app.farm_id=x.farm_a and app.assigned_pass_id=v_create_pass_id and app.is_active)
    or (select count(*) from public.program_application_products pap
      where pap.farm_id=x.farm_a and pap.assigned_pass_id=v_link_pass_id)
       <> (select count(*) from public.assigned_program_pass_products app
      where app.farm_id=x.farm_a and app.assigned_pass_id=v_link_pass_id and app.is_active)
    or exists (
      select 1 from public.program_application_products pap
      where pap.farm_id=x.farm_a
        and pap.assigned_pass_id in (v_create_pass_id,v_link_pass_id)
        and pap.inventory_matched
    ) then
    raise exception 'FAIL: linked application-product view lost actual lines or claimed an inventory match';
  end if;
  raise notice 'PASS: create path links a product-less draft, existing draft link works, and on-hand is unchanged';
end
$$;

-- O. Reassign and unassign mutate only the named track; the parallel program is byte-stable.
do $$
declare
  x programs_test_ctx%rowtype;
  v_parallel_before jsonb;
  v_parallel_after jsonb;
  v_replacement_program uuid;
  v_new_assignment uuid;
  v_reassign_result jsonb;
begin
  select * into x from programs_test_ctx;
  select to_jsonb(pa) || jsonb_build_object('passes',(
    select jsonb_agg(to_jsonb(ap) order by ap.id) from public.assigned_program_passes ap
    where ap.farm_id=x.farm_a and ap.assignment_id=x.parallel_assignment
  )) into strict v_parallel_before
  from public.program_assignments pa
  where pa.id=x.parallel_assignment and pa.farm_id=x.farm_a;
  v_replacement_program:=(public.save_program(
    x.farm_a,gen_random_uuid(),jsonb_build_object('id',null,'name','Isolation replacement',
      'program_kind','other','commodity_id',null,'crop_year',null,'notes',null)
  )#>>'{program,id}')::uuid;
  v_reassign_result:=public.reassign_program_assignment(
    x.farm_a,gen_random_uuid(),x.assignment_a,v_replacement_program,'isolation proof'
  );
  v_new_assignment:=(v_reassign_result#>>'{new_assignment,assignment_id}')::uuid;
  select to_jsonb(pa) || jsonb_build_object('passes',(
    select jsonb_agg(to_jsonb(ap) order by ap.id) from public.assigned_program_passes ap
    where ap.farm_id=x.farm_a and ap.assignment_id=x.parallel_assignment
  )) into strict v_parallel_after
  from public.program_assignments pa
  where pa.id=x.parallel_assignment and pa.farm_id=x.farm_a;
  if v_parallel_after is distinct from v_parallel_before then
    raise exception 'FAIL: reassign changed the sibling program track';
  end if;
  perform public.unassign_program(x.farm_a,gen_random_uuid(),v_new_assignment,'isolation proof');
  select to_jsonb(pa) || jsonb_build_object('passes',(
    select jsonb_agg(to_jsonb(ap) order by ap.id) from public.assigned_program_passes ap
    where ap.farm_id=x.farm_a and ap.assignment_id=x.parallel_assignment
  )) into strict v_parallel_after
  from public.program_assignments pa
  where pa.id=x.parallel_assignment and pa.farm_id=x.farm_a;
  if v_parallel_after is distinct from v_parallel_before
    or not exists(select 1 from public.program_assignments pa
      where pa.id=x.parallel_assignment and pa.farm_id=x.farm_a and pa.status='active') then
    raise exception 'FAIL: unassign changed or archived the sibling program track';
  end if;
  raise notice 'PASS: reassign and unassign leave the sibling program track byte-stable';
end
$$;

-- P. Every caller-supplied entity-ID position rejects a real cross-farm UUID.
-- Each dynamic statement runs in its own exception subtransaction, so rejection
-- must leave every farm-A Programs table at the exact before-count.
create function pg_temp.expect_programs_rejection(p_label text,p_sql text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS: % rejected (%).',p_label,sqlerrm;
    return;
  end;
  raise exception 'FAIL: % accepted a cross-farm ID',p_label;
end
$$;

do $$
declare x programs_test_ctx%rowtype; v_before jsonb; v_after jsonb;
begin
  select * into x from programs_test_ctx;
  select jsonb_build_object(
    'programs',(select count(*) from public.programs where farm_id=x.farm_a),
    'passes',(select count(*) from public.program_passes where farm_id=x.farm_a),
    'products',(select count(*) from public.program_pass_products where farm_id=x.farm_a),
    'assignments',(select count(*) from public.program_assignments where farm_id=x.farm_a),
    'assigned_passes',(select count(*) from public.assigned_program_passes where farm_id=x.farm_a),
    'assigned_products',(select count(*) from public.assigned_program_pass_products where farm_id=x.farm_a)
  ) into v_before;

  perform pg_temp.expect_programs_rejection('p_farm_id',format(
    'select public.save_program(%L::uuid,gen_random_uuid(),jsonb_build_object(''id'',null,''name'',''x'',''program_kind'',''other'',''commodity_id'',null,''crop_year'',null,''notes'',null))',x.farm_b));
  perform pg_temp.expect_programs_rejection('save_program program.id',format(
    'select public.save_program(%L::uuid,gen_random_uuid(),jsonb_build_object(''id'',%L::uuid,''name'',''x'',''program_kind'',''other'',''commodity_id'',null,''crop_year'',null,''notes'',null))',x.farm_a,x.program_b));
  perform pg_temp.expect_programs_rejection('save_program_pass p_program_id',format(
    'select public.save_program_pass(%L::uuid,gen_random_uuid(),%L::uuid,jsonb_build_object(''id'',null,''name'',''x'',''pass_type'',''custom'',''activity_type'',''other'',''timing_label'',null,''target_date'',null,''planting_offset_days'',null,''reminder_lead_days'',0,''notes'',null),''[]''::jsonb,null)',x.farm_a,x.program_b));
  perform pg_temp.expect_programs_rejection('save_program_pass pass.id',format(
    'select public.save_program_pass(%L::uuid,gen_random_uuid(),%L::uuid,jsonb_build_object(''id'',%L::uuid,''name'',''x'',''pass_type'',''custom'',''activity_type'',''other'',''timing_label'',null,''target_date'',null,''planting_offset_days'',null,''reminder_lead_days'',0,''notes'',null),''[]''::jsonb,null)',x.farm_a,x.program_a,x.pass_b));
  perform pg_temp.expect_programs_rejection('save_program_pass product.id',format(
    'select public.save_program_pass(%L::uuid,gen_random_uuid(),%L::uuid,jsonb_build_object(''id'',%L::uuid,''name'',''Post refreshed'',''pass_type'',''post'',''activity_type'',''spray'',''timing_label'',''V5'',''target_date'',%L,''planting_offset_days'',null,''reminder_lead_days'',3,''notes'',null),jsonb_build_array(jsonb_build_object(''id'',%L::uuid,''product_name'',''x'',''rate_text'',''1'',''unit_text'',''unit/ac'',''estimated_cost_per_acre'',1,''notes'',null)),null)',x.farm_a,x.program_a,x.pass_a,(current_date+2)::text,x.product_b));
  perform pg_temp.expect_programs_rejection('save_program_pass p_place_after_pass_id',format(
    'select public.save_program_pass(%L::uuid,gen_random_uuid(),%L::uuid,jsonb_build_object(''id'',%L::uuid,''name'',''Post refreshed'',''pass_type'',''post'',''activity_type'',''spray'',''timing_label'',''V5'',''target_date'',%L,''planting_offset_days'',null,''reminder_lead_days'',3,''notes'',null),''[]''::jsonb,%L::uuid)',x.farm_a,x.program_a,x.pass_a,(current_date+2)::text,x.pass_b));
  perform pg_temp.expect_programs_rejection('reorder p_program_id',format(
    'select public.reorder_program_passes(%L::uuid,gen_random_uuid(),%L::uuid,array[%L::uuid])',x.farm_a,x.program_b,x.pass_b));
  perform pg_temp.expect_programs_rejection('reorder pass IDs',format(
    'select public.reorder_program_passes(%L::uuid,gen_random_uuid(),%L::uuid,array[%L::uuid])',x.farm_a,x.program_a,x.pass_b));
  perform pg_temp.expect_programs_rejection('delete_program_pass p_program_id',format(
    'select public.delete_program_pass(%L::uuid,gen_random_uuid(),%L::uuid,%L::uuid)',x.farm_a,x.program_b,x.pass_b));
  perform pg_temp.expect_programs_rejection('delete_program_pass p_pass_id',format(
    'select public.delete_program_pass(%L::uuid,gen_random_uuid(),%L::uuid,%L::uuid)',x.farm_a,x.program_a,x.pass_b));
  perform pg_temp.expect_programs_rejection('delete_program p_program_id',format(
    'select public.delete_program(%L::uuid,gen_random_uuid(),%L::uuid)',x.farm_a,x.program_b));
  perform pg_temp.expect_programs_rejection('assign p_program_id',format(
    'select public.assign_program(%L::uuid,gen_random_uuid(),%L::uuid,array[%L::uuid])',x.farm_a,x.program_b,x.crop_a));
  perform pg_temp.expect_programs_rejection('assign crop-assignment IDs',format(
    'select public.assign_program(%L::uuid,gen_random_uuid(),%L::uuid,array[%L::uuid])',x.farm_a,x.program_a,x.crop_b));
  perform pg_temp.expect_programs_rejection('reassign p_assignment_id',format(
    'select public.reassign_program_assignment(%L::uuid,gen_random_uuid(),%L::uuid,%L::uuid,''x'')',x.farm_a,x.assignment_b,x.program_a));
  perform pg_temp.expect_programs_rejection('reassign p_new_program_id',format(
    'select public.reassign_program_assignment(%L::uuid,gen_random_uuid(),%L::uuid,%L::uuid,''x'')',x.farm_a,x.parallel_assignment,x.program_b));
  perform pg_temp.expect_programs_rejection('refresh p_assignment_id',format(
    'select public.refresh_program_assignment(%L::uuid,gen_random_uuid(),%L::uuid)',x.farm_a,x.assignment_b));
  perform pg_temp.expect_programs_rejection('reschedule p_assigned_pass_id',format(
    'select public.reschedule_program_pass(%L::uuid,gen_random_uuid(),%L::uuid,current_date,''x'')',x.farm_a,x.assigned_pass_b));
  perform pg_temp.expect_programs_rejection('skip p_assigned_pass_id',format(
    'select public.skip_program_pass(%L::uuid,gen_random_uuid(),%L::uuid,current_date,''x'')',x.farm_a,x.assigned_pass_b));
  perform pg_temp.expect_programs_rejection('unassign p_assignment_id',format(
    'select public.unassign_program(%L::uuid,gen_random_uuid(),%L::uuid,''x'')',x.farm_a,x.assignment_b));
  perform pg_temp.expect_programs_rejection('apply p_assigned_pass_id',format(
    'select public.mark_program_pass_applied(%L::uuid,gen_random_uuid(),%L::uuid,current_date,1,''[]''::jsonb,null,false)',x.farm_a,x.assigned_pass_b));
  perform pg_temp.expect_programs_rejection('apply actual_products[].id',format(
    $sql$select public.mark_program_pass_applied(x.farm_a,gen_random_uuid(),ap.id,current_date,
      least(ca.planted_acres,1::numeric),(select jsonb_agg(jsonb_build_object(
        'id',case when lines.rn=1 then %L::uuid else lines.id end,
        'actual_product_name',lines.product_name,'actual_rate_text',lines.rate_text,
        'actual_unit_text',lines.unit_text,'actual_cost_per_acre',lines.estimated_cost_per_acre)
        order by lines.rn) from (select app.*,row_number() over(order by app.id) rn
          from public.assigned_program_pass_products app where app.farm_id=x.farm_a
            and app.assigned_pass_id=ap.id and app.is_active) lines),null,false)
      from programs_test_ctx x
      join public.program_assignments pa on pa.id=x.parallel_assignment and pa.farm_id=x.farm_a
      join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
      join lateral (select ap2.id from public.assigned_program_passes ap2
        where ap2.farm_id=x.farm_a and ap2.assignment_id=x.parallel_assignment
          and ap2.status='planned' and exists(select 1 from public.assigned_program_pass_products app2
            where app2.farm_id=x.farm_a and app2.assigned_pass_id=ap2.id and app2.is_active)
        order by ap2.id limit 1) ap on true$sql$,x.assigned_product_b));
  perform pg_temp.expect_programs_rejection('apply p_application_record_id',format(
    $sql$select public.mark_program_pass_applied(x.farm_a,gen_random_uuid(),ap.id,current_date,
      least(ca.planted_acres,1::numeric),coalesce((select jsonb_agg(jsonb_build_object(
        'id',app.id,'actual_product_name',app.product_name,'actual_rate_text',app.rate_text,
        'actual_unit_text',app.unit_text,'actual_cost_per_acre',app.estimated_cost_per_acre))
        from public.assigned_program_pass_products app where app.farm_id=x.farm_a
          and app.assigned_pass_id=ap.id and app.is_active),'[]'::jsonb),%L::uuid,false)
      from programs_test_ctx x
      join public.program_assignments pa on pa.id=x.parallel_assignment and pa.farm_id=x.farm_a
      join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
      join lateral (select ap2.id from public.assigned_program_passes ap2
        where ap2.farm_id=x.farm_a and ap2.assignment_id=x.parallel_assignment
          and ap2.status='planned' order by ap2.id limit 1) ap on true$sql$,x.application_b));

  select jsonb_build_object(
    'programs',(select count(*) from public.programs where farm_id=x.farm_a),
    'passes',(select count(*) from public.program_passes where farm_id=x.farm_a),
    'products',(select count(*) from public.program_pass_products where farm_id=x.farm_a),
    'assignments',(select count(*) from public.program_assignments where farm_id=x.farm_a),
    'assigned_passes',(select count(*) from public.assigned_program_passes where farm_id=x.farm_a),
    'assigned_products',(select count(*) from public.assigned_program_pass_products where farm_id=x.farm_a)
  ) into v_after;
  if v_after is distinct from v_before then
    raise exception 'FAIL: a rejected cross-farm call changed farm-A row counts: % -> %',v_before,v_after;
  end if;
  raise notice 'PASS: every caller-supplied entity ID position fails closed with zero row-count change';
end
$$;

-- Q. Full grants/RLS matrix: authenticated can only read base rows directly;
-- authenticated writes are RPC-only; worker can write, read_only/rep cannot;
-- anon and PUBLIC have neither row access nor RPC execution.
reset role;
do $$
declare v_name text;
begin
  foreach v_name in array array[
    'programs','program_passes','program_pass_products','program_assignments',
    'assigned_program_passes','assigned_program_pass_products'
  ] loop
    if not has_table_privilege('authenticated','public.'||v_name,'select')
      or has_table_privilege('authenticated','public.'||v_name,'insert')
      or has_table_privilege('authenticated','public.'||v_name,'update')
      or has_table_privilege('authenticated','public.'||v_name,'delete')
      or has_table_privilege('anon','public.'||v_name,'select,insert,update,delete')
      or exists(select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where c.oid=('public.'||v_name)::regclass and a.grantee=0) then
      raise exception 'FAIL: base-table grant matrix is wrong for %',v_name;
    end if;
  end loop;
  foreach v_name in array array[
    'program_assignment_tracker','program_assignment_costs',
    'program_crop_cost_rollups','program_application_products'
  ] loop
    if not has_table_privilege('authenticated','public.'||v_name,'select')
      or has_table_privilege('anon','public.'||v_name,'select')
      or exists(select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where c.oid=('public.'||v_name)::regclass and a.grantee=0) then
      raise exception 'FAIL: view grant matrix is wrong for %',v_name;
    end if;
  end loop;
  foreach v_name in array array[
    'save_program(uuid,uuid,jsonb)',
    'save_program_pass(uuid,uuid,uuid,jsonb,jsonb,uuid)',
    'reorder_program_passes(uuid,uuid,uuid,uuid[])',
    'delete_program_pass(uuid,uuid,uuid,uuid)',
    'delete_program(uuid,uuid,uuid)',
    'assign_program(uuid,uuid,uuid,uuid[])',
    'reassign_program_assignment(uuid,uuid,uuid,uuid,text)',
    'refresh_program_assignment(uuid,uuid,uuid)',
    'reschedule_program_pass(uuid,uuid,uuid,date,text)',
    'mark_program_pass_applied(uuid,uuid,uuid,date,numeric,jsonb,uuid,boolean)',
    'skip_program_pass(uuid,uuid,uuid,date,text)',
    'unassign_program(uuid,uuid,uuid,text)',
    'generate_due_program_items(uuid,uuid,date)'
  ] loop
    if not has_function_privilege('authenticated','public.'||v_name,'execute')
      or has_function_privilege('anon','public.'||v_name,'execute')
      or exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=('public.'||v_name)::regprocedure and a.grantee=0) then
      raise exception 'FAIL: RPC execute matrix is wrong for %',v_name;
    end if;
  end loop;
  if has_function_privilege('authenticated',
      'public.sync_open_program_task_due(uuid,uuid,date,text)','execute')
    or has_function_privilege('anon',
      'public.sync_open_program_task_due(uuid,uuid,date,text)','execute') then
    raise exception 'FAIL: internal task-sync helper is externally executable';
  end if;
  raise notice 'PASS: complete table/view/RPC/PUBLIC/anon grant catalog matches the contract';
end
$$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select rep_a from programs_test_ctx),'role','authenticated')::text,true);
do $$
declare v_visible integer; v_denied boolean:=false;
begin
  select count(*) into v_visible from public.programs p
  join programs_test_ctx x on x.program_a=p.id and x.farm_a=p.farm_id;
  if v_visible<>1 then raise exception 'FAIL: enabled rep cannot read the shared program row'; end if;
  begin
    perform public.save_program(x.farm_a,gen_random_uuid(),jsonb_build_object(
      'id',null,'name','rep must fail','program_kind','other',
      'commodity_id',null,'crop_year',null,'notes',null)) from programs_test_ctx x;
  exception when others then v_denied:=sqlerrm like '%permission%';
  end;
  if not v_denied then raise exception 'FAIL: rep wrote through a Programs RPC'; end if;
  raise notice 'PASS: explicitly shared rep can read and cannot write';
end
$$;

reset role;
select set_config('programs.proof_farm',(select farm_a::text from programs_test_ctx),true);
set local role anon;
select set_config('request.jwt.claims',jsonb_build_object('role','anon')::text,true);
do $$
declare v_select_denied boolean:=false; v_rpc_denied boolean:=false;
begin
  begin
    perform count(*) from public.programs;
  exception when insufficient_privilege then v_select_denied:=true;
  end;
  begin
    perform public.save_program(current_setting('programs.proof_farm')::uuid,
      gen_random_uuid(),jsonb_build_object(
      'id',null,'name','anon must fail','program_kind','other',
      'commodity_id',null,'crop_year',null,'notes',null));
  exception when insufficient_privilege then v_rpc_denied:=true;
  end;
  if not v_select_denied or not v_rpc_denied then
    raise exception 'FAIL: anon retained table SELECT or RPC EXECUTE';
  end if;
  raise notice 'PASS: anon cannot select Programs tables or execute Programs RPCs';
end
$$;

reset role;
rollback;
```

Expected outcome: every labeled case emits its `PASS:` notice, no uncaught
exception occurs, every rejected call leaves the stated row counts unchanged,
and the final `rollback` removes all fixture programs, passes, assignments,
application state, tasks, notifications, and receipts.

## Required two-session cap race

This is the one case that cannot be proved by a one-session transaction. Run
it only on disposable TEST. Execute Setup once, start Session A, and while A is
inside `pg_sleep`, execute Session B. Whichever candidate obtains the crop lock
first must become the 12th active program; the other must fail. A result of 13,
11, or both/neither candidates active is a failure.

### Setup (TEST SQL editor)

```sql
begin;
drop table if exists public.programs_chunk1_cap_proof_ctx;
create table public.programs_chunk1_cap_proof_ctx(
  farm_id uuid primary key,
  worker_id uuid not null,
  crop_id uuid not null,
  program_ids uuid[] not null default '{}',
  candidate_a uuid,
  candidate_b uuid
);
revoke all on public.programs_chunk1_cap_proof_ctx from public,anon,authenticated;
grant select,update on public.programs_chunk1_cap_proof_ctx to authenticated;

insert into public.programs_chunk1_cap_proof_ctx(farm_id,worker_id,crop_id)
select fm.farm_id,fm.user_id,ca.id
from public.farm_memberships fm
join public.crop_assignments ca on ca.farm_id=fm.farm_id
where fm.role='worker' and fm.status='active'
  and not exists(select 1 from public.program_assignments pa
    where pa.farm_id=ca.farm_id and pa.crop_assignment_id=ca.id and pa.status='active')
order by fm.farm_id,ca.id limit 1;
do $$ begin
  if (select count(*) from public.programs_chunk1_cap_proof_ctx)<>1 then
    raise exception 'TEST needs a worker-owned crop with zero active programs';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select worker_id from public.programs_chunk1_cap_proof_ctx),
  'role','authenticated')::text,true);
do $$
declare x public.programs_chunk1_cap_proof_ctx%rowtype; v_id uuid;
begin
  select * into x from public.programs_chunk1_cap_proof_ctx;
  for i in 1..13 loop
    v_id:=(public.save_program(x.farm_id,gen_random_uuid(),jsonb_build_object(
      'id',null,'name','CAP-RACE-'||i,'program_kind','other',
      'commodity_id',null,'crop_year',null,'notes','delete after cap proof'))
      #>>'{program,id}')::uuid;
    update public.programs_chunk1_cap_proof_ctx
    set program_ids=array_append(program_ids,v_id) where farm_id=x.farm_id;
    if i<=11 then
      perform public.assign_program(x.farm_id,gen_random_uuid(),v_id,array[x.crop_id]);
    end if;
  end loop;
  update public.programs_chunk1_cap_proof_ctx
  set candidate_a=program_ids[12],candidate_b=program_ids[13]
  where farm_id=x.farm_id;
end $$;
reset role;
commit;
```

Expected setup row outcome: exactly 11 active assignments exist on the chosen
crop, and both candidate program IDs exist but are unassigned.

### Session A

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select worker_id from public.programs_chunk1_cap_proof_ctx),
  'role','authenticated')::text,true);
select public.assign_program(farm_id,gen_random_uuid(),candidate_a,array[crop_id])
from public.programs_chunk1_cap_proof_ctx;
select pg_sleep(10);
commit;
```

### Session B (start while Session A is sleeping)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select worker_id from public.programs_chunk1_cap_proof_ctx),
  'role','authenticated')::text,true);
select public.assign_program(farm_id,gen_random_uuid(),candidate_b,array[crop_id])
from public.programs_chunk1_cap_proof_ctx;
commit;
```

Expected Session B outcome when A won the lock: it waits, then raises
`a selected crop assignment already has 12 active programs`; run `rollback`
in B after the expected error. If B won the lock instead, reverse A/B in this
expectation. Exactly one call must succeed.

### Verify and clean up

```sql
do $$
declare v_active integer; v_candidates integer;
begin
  select count(*) into v_active
  from public.program_assignments pa
  join public.programs_chunk1_cap_proof_ctx x
    on x.farm_id=pa.farm_id and x.crop_id=pa.crop_assignment_id
  where pa.status='active';
  select count(*) into v_candidates
  from public.program_assignments pa
  join public.programs_chunk1_cap_proof_ctx x
    on x.farm_id=pa.farm_id and x.crop_id=pa.crop_assignment_id
  where pa.status='active' and pa.program_id in (x.candidate_a,x.candidate_b);
  if v_active<>12 or v_candidates<>1 then
    raise exception 'FAIL: cap race ended with % active and % candidate winners',v_active,v_candidates;
  end if;
  raise notice 'PASS: concurrent 12th-program race produced exactly one winner and 12 active rows';
end $$;

begin;
delete from public.assigned_program_pass_products app using public.assigned_program_passes ap,
  public.program_assignments pa,public.programs_chunk1_cap_proof_ctx x
where app.assigned_pass_id=ap.id and app.farm_id=ap.farm_id
  and ap.assignment_id=pa.id and ap.farm_id=pa.farm_id
  and pa.farm_id=x.farm_id and pa.program_id=any(x.program_ids);
delete from public.assigned_program_passes ap using public.program_assignments pa,
  public.programs_chunk1_cap_proof_ctx x
where ap.assignment_id=pa.id and ap.farm_id=pa.farm_id
  and pa.farm_id=x.farm_id and pa.program_id=any(x.program_ids);
delete from public.program_assignments pa using public.programs_chunk1_cap_proof_ctx x
where pa.farm_id=x.farm_id and pa.program_id=any(x.program_ids);
delete from public.program_pass_products ppp using public.program_passes pp,
  public.programs_chunk1_cap_proof_ctx x
where ppp.program_pass_id=pp.id and ppp.farm_id=pp.farm_id
  and pp.farm_id=x.farm_id and pp.program_id=any(x.program_ids);
delete from public.program_passes pp using public.programs_chunk1_cap_proof_ctx x
where pp.farm_id=x.farm_id and pp.program_id=any(x.program_ids);
delete from public.repository_write_receipts r using public.programs_chunk1_cap_proof_ctx x
where r.farm_id=x.farm_id and exists(select 1 from unnest(x.program_ids) id
  where r.result::text like '%'||id::text||'%');
delete from public.programs p using public.programs_chunk1_cap_proof_ctx x
where p.farm_id=x.farm_id and p.id=any(x.program_ids);
drop table public.programs_chunk1_cap_proof_ctx;
commit;
```

Expected cleanup outcome: no `CAP-RACE-%` programs, assignments, assigned
passes/products, or related receipts remain, and the temporary proof table is
dropped.
