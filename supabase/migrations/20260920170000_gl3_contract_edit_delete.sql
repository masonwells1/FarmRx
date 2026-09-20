-- DRAFT ONLY. Never applied by this repair; it is revalidated in disposable Postgres.
--
-- GL-3b: a contract entered wrong is a dead end today. There is no edit and no delete, so a
-- typo in the buyer or the bushels stays in the farm's marketing position forever, and the
-- only workaround is a second contract that makes the position wrong twice.
--
-- Both actions are server-owned RPCs rather than a direct table write, for three reasons the
-- browser cannot be trusted with:
--   * "no deliveries" has to be decided under a row lock, or a delivery recorded between the
--     browser's read and its write is silently orphaned;
--   * the reason is not optional, and an optional column with a browser-side check is optional;
--   * the audit row and the change must be one transaction, or a correction can lose its record.
--
-- What an edit may change is deliberately narrow: buyer, bushels, the delivery window, the
-- contract number and the notes. Crop year, commodity, contract type and every pricing column
-- are NOT editable here. Those are the contract's identity and its math, and pricing on a
-- basis or HTA contract is owned by the one-shot finalization rule in 0033, which this
-- migration does not touch. A farmer who got one of those wrong deletes the contract with a
-- reason and enters it again -- which is exactly what the delete below is for.

create table public.grain_contract_audit (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  -- Deliberately NOT a foreign key. A delete removes the contract; the record of that delete
  -- has to outlive it, which is the whole point of this table.
  grain_contract_id uuid not null,
  action text not null check (action in ('edit', 'delete')),
  reason text not null check (length(btrim(reason)) between 3 and 2000),
  before_row jsonb not null,
  after_row jsonb,
  -- What the caller asked for, kept so a repeat carrying the same operation id can be checked
  -- against it. Recognising a retry by id alone would let a changed draft reuse the id and be
  -- answered with the earlier correction while the new one is silently dropped.
  requested_changes jsonb,
  reopened_firm_offer_id uuid,
  -- The browser's own id for one correction attempt. A retry after a lost response carries the same
  -- one, so the second call can recognise the first and report what it already did instead of a
  -- stale-write error the farmer cannot interpret. Null on a delete, which is idempotent by its own
  -- audit row instead; Postgres treats nulls as distinct, so the unique index below allows many.
  operation_id uuid,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint grain_contract_audit_after_row_by_action check (
    (action = 'edit' and after_row is not null) or (action = 'delete' and after_row is null)
  )
);
create index grain_contract_audit_contract_idx
  on public.grain_contract_audit (farm_id, grain_contract_id, created_at desc);
create unique index grain_contract_audit_operation_idx
  on public.grain_contract_audit (farm_id, operation_id);

alter table public.grain_contract_audit enable row level security;
revoke all on public.grain_contract_audit from public, anon;
grant select on public.grain_contract_audit to authenticated;
-- Contract money is private financial data, and so is the reason someone changed it.
create policy grain_contract_audit_select on public.grain_contract_audit
  for select to authenticated using (public.can_read_private_financials(farm_id));
-- No insert, update or delete grant: the only writer is the definer RPCs below.

-- Access-epoch fencing (migration 0040): a request whose farm access epoch is stale can never write
-- a farm-scoped row, exactly like every other farm table. The RPCs below are security definer and
-- already check can_edit_farm, but that is a different question from "is this browser's view of its
-- own access still current", and 0040 requires every farm-scoped table to answer it.
create trigger farm_access_epoch_guard
before insert or update or delete on public.grain_contract_audit
for each row execute function public.guard_row_farm_access_epoch();

-- Append-only is enforced the way bin_transactions already enforces it: authenticated holds
-- SELECT and nothing else, so no browser can rewrite a reason after the fact. The trigger adds
-- a hard stop on rewriting a row in place even from an owner connection. It deliberately does
-- NOT cover DELETE: farm_id cascades from farms, and a BEFORE DELETE trigger that raised would
-- make deleting a farm impossible rather than making the audit safer.
create or replace function public.grain_contract_audit_is_append_only()
returns trigger language plpgsql set search_path = pg_catalog as $fn$
begin
  raise exception 'grain_contract_audit is append-only';
end $fn$;
create trigger grain_contract_audit_immutable
  before update on public.grain_contract_audit
  for each row execute function public.grain_contract_audit_is_append_only();

-- One test of "this contract can still be corrected", used by both RPCs and by the assertions,
-- so the edit path and the delete path can never disagree about which contracts are eligible.
create or replace function public.grain_contract_has_deliveries(p_farm_id uuid, p_contract_id uuid)
returns boolean language sql stable set search_path = pg_catalog as $fn$
  select exists (
    select 1 from public.grain_contract_deliveries d
    where d.farm_id = p_farm_id and d.grain_contract_id = p_contract_id
  );
$fn$;

comment on function public.grain_contract_has_deliveries(uuid, uuid) is
  'GL-3b: whether a contract has delivered bushels against it. A contract with deliveries is history, not a draft, and is neither editable nor deletable.';

create or replace function public.edit_grain_contract(p_farm_id uuid, p_contract_id uuid, p_reason text, p_changes jsonb, p_expected_updated_at timestamptz, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_before public.grain_contracts%rowtype;
  v_after public.grain_contracts%rowtype;
  v_replay public.grain_contract_audit%rowtype;
  v_changes jsonb := case when jsonb_typeof(p_changes) = 'object' then p_changes else null end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_buyer text; v_bushels numeric; v_start date; v_end date; v_number text; v_notes text;
begin
  -- Both fences, not either. can_edit_farm admits a worker; Grain itself is behind
  -- can_read_private_financials, and these functions are security definer, so a worker without
  -- financial access who still had a contract's id from earlier access or a cached page could
  -- otherwise reach past row-level security and rewrite it. Requiring both leaves exactly the people
  -- who may already see the contract AND may change farm records: an owner, a manager, or a worker
  -- the owner gave financial access to. A named rep passes the financial test and fails can_edit_farm,
  -- which is right -- a rep reads, and does not correct.
  if auth.uid() is null or public.request_uses_service_role()
     or not public.can_edit_farm(p_farm_id) or not public.can_read_private_financials(p_farm_id) then
    raise exception 'you do not have permission to change this contract';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 2000 then
    raise exception 'a reason of 3 to 2000 characters is required to change a contract';
  end if;

  if p_operation_id is null then raise exception 'a correction must carry its own operation id'; end if;
  -- The browser already refuses an empty correction, but this function is reachable without it. An
  -- empty or unrecognised payload would otherwise write an audit row for nothing and move updated_at,
  -- which turns every other member's open draft stale for a change that never happened.
  if v_changes is null or not (v_changes ?| array['buyer','bushels','delivery_start','delivery_end','contract_number','notes']) then
    raise exception 'a correction must name at least one field to change';
  end if;

  select * into v_before from public.grain_contracts where id = p_contract_id and farm_id = p_farm_id for update;
  if not found then raise exception 'contract does not belong to this farm'; end if;
  -- This exact correction already landed; the response to it was lost, not the write. Report the
  -- contract as it now stands rather than the stale-write error the check below would raise, which a
  -- farmer reading "try again" cannot tell apart from a correction that never happened.
  -- Deliberately before the compare-and-swap: a committed edit has already moved updated_at.
  select * into v_replay from public.grain_contract_audit a where a.farm_id = p_farm_id and a.operation_id = p_operation_id;
  if found then
    -- Same id, same correction, SAME CONTRACT: answer with the contract as it stands. The contract is
    -- part of that identity, not context around it -- an id spent on contract A answering for
    -- contract B would report "Contract corrected" for a row nothing ever touched.
    if v_replay.grain_contract_id = p_contract_id
       and v_replay.reason is not distinct from v_reason
       and v_replay.requested_changes is not distinct from v_changes then
      return to_jsonb(v_before);
    end if;
    -- Same id, DIFFERENT correction. The farmer edited the draft after a lost response and pressed
    -- Save again, or the id was spent on another contract. Returning the earlier row here would
    -- report "Contract corrected" while dropping what they just typed, so this says plainly that the
    -- earlier one landed and this one did not.
    raise exception using errcode = 'P0001', message = 'FARM_RX_CORRECTION_ALREADY_SAVED';
  end if;
  -- Compare-and-swap, the same fence optimisticSave applies to every other mutable farm row. Two
  -- members can have this contract open at once; without it the second save silently reverses the
  -- first correction, and the audit would record both as deliberate.
  if p_expected_updated_at is null or v_before.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'FARM_RX_STALE_WRITE';
  end if;
  if public.grain_contract_has_deliveries(p_farm_id, p_contract_id) then
    raise exception 'this contract already has delivered bushels and can no longer be changed';
  end if;

  -- Absent keys keep the stored value; an explicit null clears a nullable column. That
  -- distinction matters: clearing a delivery window is a real edit, not a no-op.
  v_buyer   := case when p_changes ? 'buyer'           then nullif(btrim(p_changes->>'buyer'), '')          else v_before.buyer end;
  v_bushels := case when p_changes ? 'bushels'         then (p_changes->>'bushels')::numeric               else v_before.bushels end;
  v_start   := case when p_changes ? 'delivery_start'  then (p_changes->>'delivery_start')::date           else v_before.delivery_start end;
  v_end     := case when p_changes ? 'delivery_end'    then (p_changes->>'delivery_end')::date             else v_before.delivery_end end;
  v_number  := case when p_changes ? 'contract_number' then nullif(btrim(p_changes->>'contract_number'),'') else v_before.contract_number end;
  v_notes   := case when p_changes ? 'notes'           then nullif(btrim(p_changes->>'notes'), '')          else v_before.notes end;

  -- Naming a field is not the same as changing it. A payload that sets every field to what it already
  -- holds is a no-op, and a no-op must not advance updated_at or leave a correction in the record.
  if v_buyer is not distinct from v_before.buyer and v_bushels is not distinct from v_before.bushels
     and v_start is not distinct from v_before.delivery_start and v_end is not distinct from v_before.delivery_end
     and v_number is not distinct from v_before.contract_number and v_notes is not distinct from v_before.notes then
    raise exception 'a correction must change something';
  end if;

  if v_buyer is null or length(v_buyer) > 200 then raise exception 'buyer is required and must be 200 characters or fewer'; end if;
  if v_bushels is null or v_bushels::text in ('NaN', 'Infinity', '-Infinity') or v_bushels <= 0 then raise exception 'bushels must be greater than zero'; end if;
  if v_start is not null and v_end is not null and v_end < v_start then raise exception 'delivery end must be on or after delivery start'; end if;

  update public.grain_contracts
     set buyer = v_buyer, bushels = v_bushels, delivery_start = v_start, delivery_end = v_end,
         contract_number = v_number, notes = v_notes, updated_at = now()
   where id = p_contract_id and farm_id = p_farm_id
  returning * into v_after;

  insert into public.grain_contract_audit (farm_id, grain_contract_id, action, reason, before_row, after_row, requested_changes, operation_id, actor_id)
  values (p_farm_id, p_contract_id, 'edit', v_reason, to_jsonb(v_before), to_jsonb(v_after), v_changes, p_operation_id, auth.uid());

  return to_jsonb(v_after);
end $fn$;
revoke all on function public.edit_grain_contract(uuid, uuid, text, jsonb, timestamptz, uuid) from public, anon;
grant execute on function public.edit_grain_contract(uuid, uuid, text, jsonb, timestamptz, uuid) to authenticated;

comment on function public.edit_grain_contract(uuid, uuid, text, jsonb, timestamptz, uuid) is
  'GL-3b: correct a contract that has no deliveries, with a required reason recorded in grain_contract_audit. Crop year, commodity, contract type and pricing are not editable here; 0033 owns pricing.';

create or replace function public.delete_grain_contract(p_farm_id uuid, p_contract_id uuid, p_reason text, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_before public.grain_contracts%rowtype;
  v_offer public.firm_offers%rowtype;
  v_reopened uuid := null;
  v_local_date date;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or public.request_uses_service_role()
     or not public.can_edit_farm(p_farm_id) or not public.can_read_private_financials(p_farm_id) then
    raise exception 'you do not have permission to delete this contract';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 2000 then
    raise exception 'a reason of 3 to 2000 characters is required to delete a contract';
  end if;

  select * into v_before from public.grain_contracts where id = p_contract_id and farm_id = p_farm_id for update;
  if not found then
    -- Idempotent on a retry after a lost response: the row is already gone and the audit row
    -- for that delete already exists, so report the completed delete rather than an error the
    -- farmer would read as "it failed" and try again.
    if exists (select 1 from public.grain_contract_audit a where a.farm_id = p_farm_id and a.grain_contract_id = p_contract_id and a.action = 'delete') then
      return jsonb_build_object('deleted', true, 'reopened_firm_offer_id', null, 'already_deleted', true);
    end if;
    raise exception 'contract does not belong to this farm';
  end if;
  if p_expected_updated_at is null or v_before.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'FARM_RX_STALE_WRITE';
  end if;
  if public.grain_contract_has_deliveries(p_farm_id, p_contract_id) then
    raise exception 'this contract already has delivered bushels and can no longer be deleted';
  end if;

  -- A contract created from a firm offer IS the record that the offer was filled. Once it is
  -- deleted with a reason, the offer demonstrably was not filled, and the foreign key would
  -- otherwise leave it marked 'filled' pointing at nothing -- a state no screen can explain and
  -- that blocks the offer from ever being filled again. It returns to 'open', or to 'expired'
  -- if its own expiry has already passed, so the delete never resurrects a stale offer as live.
  -- The farm's own calendar day, not the database's. After UTC midnight an Illinois farm is still on
  -- the previous evening, and an offer that expires today is still fillable there; current_date would
  -- retire it hours early. Offer expiry is read against the farmer's local day everywhere else.
  select (now() at time zone coalesce(f.time_zone, 'UTC'))::date into v_local_date
  from public.farms f where f.id = p_farm_id;
  if v_before.firm_offer_id is not null then
    select * into v_offer from public.firm_offers where id = v_before.firm_offer_id and farm_id = p_farm_id for update;
    if found then
      update public.firm_offers
         set status = case when v_offer.expires_on is not null and v_offer.expires_on < v_local_date then 'expired'::public.firm_offer_status else 'open'::public.firm_offer_status end,
             filled_contract_id = null, updated_at = now()
       where id = v_offer.id and farm_id = p_farm_id;
      v_reopened := v_offer.id;
    end if;
  end if;

  insert into public.grain_contract_audit (farm_id, grain_contract_id, action, reason, before_row, after_row, reopened_firm_offer_id, actor_id)
  values (p_farm_id, p_contract_id, 'delete', v_reason, to_jsonb(v_before), null, v_reopened, auth.uid());

  delete from public.grain_contracts where id = p_contract_id and farm_id = p_farm_id;

  return jsonb_build_object('deleted', true, 'reopened_firm_offer_id', v_reopened, 'already_deleted', false);
end $fn$;
revoke all on function public.delete_grain_contract(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.delete_grain_contract(uuid, uuid, text, timestamptz) to authenticated;

comment on function public.delete_grain_contract(uuid, uuid, text, timestamptz) is
  'GL-3b: delete a contract that has no deliveries, with a required reason recorded in grain_contract_audit before the row is removed. A contract created from a firm offer returns that offer to open, or expired if its expiry has passed.';

-- The audited actions above are pointless while the old direct paths are still open. Module 2 granted
-- authenticated UPDATE and DELETE on grain_contracts with matching row-level policies, so anyone who
-- may edit the farm could change or remove a contract straight through PostgREST: no reason, no audit
-- row, no deliveries check. A direct delete is worse still -- the foreign key clears the firm offer's
-- filled_contract_id and leaves the offer marked 'filled' pointing at nothing, which is exactly the
-- state delete_grain_contract exists to prevent.
--
-- INSERT stays: a new contract is created directly and has nothing to correct yet. Nothing in the app
-- updates or deletes a contract row any other way -- price finalization (0033) and both functions
-- above are security definer and unaffected by these grants.
revoke update, delete on public.grain_contracts from authenticated;
drop policy if exists grain_contracts_update on public.grain_contracts;
drop policy if exists grain_contracts_delete on public.grain_contracts;
