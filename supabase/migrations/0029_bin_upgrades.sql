-- DRAFT ONLY — review before applying.
-- PostgreSQL 17 / Supabase. Do not apply without the human review gate.
-- Depends on 0004/0005 (grain bins, inventory, and RLS), 0008
-- (can_read_private_financials), and follows 0010/0011's append-only ledger
-- and derived-on-hand design. No existing bin writer changes in this draft.

alter table public.grain_bins
  add column moisture_pct numeric(5, 2),
  add column moisture_checked_on date,
  add constraint grain_bins_moisture_pct_range check (
    moisture_pct is null or moisture_pct between 0 and 40
  );

create type public.bin_transaction_direction as enum (
  'in',
  'out'
);

-- Immutable signed movements form the future source of truth for bin on-hand.
-- This additive draft does not change the current bin_inventory writers or
-- claim that pre-ledger inventory can already be derived from these rows.
create table public.bin_transactions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  grain_bin_id uuid not null,
  direction public.bin_transaction_direction not null,
  bushels numeric(16, 2) not null check (bushels > 0),
  commodity_id text not null references public.commodities(id) on delete restrict,
  occurred_on date not null,
  note text
    check (note is null or length(btrim(note)) between 1 and 4000),
  source_kind text
    check (source_kind is null or length(btrim(source_kind)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint bin_transactions_bin_same_farm_fk
    foreign key (grain_bin_id, farm_id)
    references public.grain_bins(id, farm_id)
    on delete restrict
);

create index bin_transactions_bin_history_idx
  on public.bin_transactions (grain_bin_id, farm_id, occurred_on desc, created_at desc);
create index bin_transactions_farm_commodity_idx
  on public.bin_transactions (farm_id, commodity_id, occurred_on desc);

create trigger bin_transactions_prevent_farm_move
before update on public.bin_transactions
for each row execute function public.prevent_farm_id_change();

alter table public.bin_transactions enable row level security;

revoke all on table public.bin_transactions from anon;

-- Append-only means authenticated clients may add or read movements, but may
-- not update or delete history. Corrections are new opposite-direction rows.
grant select, insert on table public.bin_transactions to authenticated;

create policy bin_transactions_select
on public.bin_transactions for select to authenticated
using (
  public.can_read_private_financials(farm_id)
  and exists (
    select 1 from public.grain_bins gb
    where gb.id = grain_bin_id
      and gb.farm_id = bin_transactions.farm_id
  )
);

create policy bin_transactions_insert
on public.bin_transactions for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.grain_bins gb
    where gb.id = grain_bin_id
      and gb.farm_id = bin_transactions.farm_id
  )
);
