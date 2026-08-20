-- The original farm-first lookup index does not cover either composite FK
-- below.  These indexes match each referencing key's leading order so deletes
-- and updates of the referenced rows do not need to scan the match ledger.
create index program_inventory_matches_assigned_product_farm_idx
  on public.program_inventory_matches (assigned_product_id, farm_id);

create index program_inventory_matches_inventory_product_farm_idx
  on public.program_inventory_matches (inventory_product_id, farm_id);
