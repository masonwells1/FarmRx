-- 0025 — Hard guard: a Program-sourced task card MUST carry both program linkage fields.
-- Prevents the Tasks board from being bricked by a program task saved without its
-- program_assigned_pass_id / program_cycle_key (Chunk 4 Sol review P1). Additive; safe.
alter table public.farm_tasks
  add constraint farm_tasks_program_linkage_check
  check (
    source <> 'program'
    or (program_assigned_pass_id is not null and program_cycle_key is not null)
  );
