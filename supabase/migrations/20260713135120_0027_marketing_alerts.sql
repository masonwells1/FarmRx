-- APPLIED to the farm-rx Supabase project 2026-07-13 with Mason's explicit OK.
-- PostgreSQL 17 / Supabase.
-- Depends on 0004 (grain scope), 0005 (grain RLS), and 0008
-- (can_read_private_financials employee privacy).

create type public.grain_alert_rule_type as enum (
  'price_target',
  'pct_marketed_goal',
  'deadline'
);

create type public.grain_alert_direction as enum (
  'at_or_above',
  'at_or_below'
);

-- One private delivery-settings row per farm. An empty list keeps email
-- optional; up to three addresses allows the farmer, advisor, and spouse.
create table public.grain_alert_settings (
  farm_id uuid primary key references public.farms(id) on delete cascade,
  alert_emails text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  constraint grain_alert_settings_email_count check (
    cardinality(alert_emails) <= 3
  ),
  constraint grain_alert_settings_email_shape check (
    coalesce(array_ndims(alert_emails), 1) = 1
    and (cardinality(alert_emails) = 0 or array_lower(alert_emails, 1) = 1)
    and array_position(alert_emails, null) is null
    and (
      cardinality(alert_emails) < 1
      or (
        alert_emails[1] = btrim(alert_emails[1])
        and alert_emails[1] ~* '^[^[:space:]@,]+@[^[:space:]@,]+\.[^[:space:]@,]+$'
      )
    )
    and (
      cardinality(alert_emails) < 2
      or (
        alert_emails[2] = btrim(alert_emails[2])
        and alert_emails[2] ~* '^[^[:space:]@,]+@[^[:space:]@,]+\.[^[:space:]@,]+$'
      )
    )
    and (
      cardinality(alert_emails) < 3
      or (
        alert_emails[3] = btrim(alert_emails[3])
        and alert_emails[3] ~* '^[^[:space:]@,]+@[^[:space:]@,]+\.[^[:space:]@,]+$'
      )
    )
  )
);

-- Each rule uses the same five-part PositionScope as Module 2. The rule-type
-- check makes the overloaded threshold unambiguous and prevents stale fields
-- from one rule type surviving a switch to another.
create table public.marketing_alert_rules (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  crop_year integer not null check (crop_year between 1900 and 2200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  operating_entity_id uuid,
  enterprise_label text
    check (enterprise_label is null or length(btrim(enterprise_label)) between 1 and 160),
  rule_type public.grain_alert_rule_type not null,
  direction public.grain_alert_direction,
  threshold numeric(12, 6),
  remind_on date,
  message text
    check (message is null or length(btrim(message)) between 1 and 1000),
  active boolean not null default true,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint marketing_alert_rules_entity_same_farm_fk
    foreign key (operating_entity_id, farm_id)
    references public.entities(id, farm_id)
    on delete restrict,
  constraint marketing_alert_rules_fields_by_type check (
    (
      rule_type = 'price_target'
      and direction is not null
      and threshold > 0
      and threshold <= 1000
      and remind_on is null
    )
    or (
      rule_type = 'pct_marketed_goal'
      and direction is null
      and threshold > 0
      and threshold <= 100
      and remind_on is null
    )
    or (
      rule_type = 'deadline'
      and direction is null
      and threshold is null
      and remind_on is not null
    )
  )
);

create index marketing_alert_rules_farm_scope_idx
  on public.marketing_alert_rules (farm_id, crop_year, commodity_id);
create index marketing_alert_rules_entity_farm_idx
  on public.marketing_alert_rules (operating_entity_id, farm_id);
create index marketing_alert_rules_active_idx
  on public.marketing_alert_rules (farm_id, active, rule_type);

create trigger grain_alert_settings_set_updated_at
before update on public.grain_alert_settings
for each row execute function public.set_updated_at();

create trigger marketing_alert_rules_set_updated_at
before update on public.marketing_alert_rules
for each row execute function public.set_updated_at();

create trigger grain_alert_settings_prevent_farm_move
before update on public.grain_alert_settings
for each row execute function public.prevent_farm_id_change();

create trigger marketing_alert_rules_prevent_farm_move
before update on public.marketing_alert_rules
for each row execute function public.prevent_farm_id_change();

alter table public.grain_alert_settings enable row level security;
alter table public.marketing_alert_rules enable row level security;

revoke all on table public.grain_alert_settings from anon;
revoke all on table public.marketing_alert_rules from anon;

grant select, insert, update, delete on table public.grain_alert_settings to authenticated;
grant select, insert, update, delete on table public.marketing_alert_rules to authenticated;

create policy grain_alert_settings_select
on public.grain_alert_settings for select to authenticated
using (public.can_read_private_financials(farm_id));

create policy grain_alert_settings_insert
on public.grain_alert_settings for insert to authenticated
with check (public.can_edit_farm(farm_id));

create policy grain_alert_settings_update
on public.grain_alert_settings for update to authenticated
using (public.can_edit_farm(farm_id))
with check (public.can_edit_farm(farm_id));

create policy grain_alert_settings_delete
on public.grain_alert_settings for delete to authenticated
using (public.can_edit_farm(farm_id));

create policy marketing_alert_rules_select
on public.marketing_alert_rules for select to authenticated
using (
  public.can_read_private_financials(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_alert_rules.farm_id
    )
  )
);

create policy marketing_alert_rules_insert
on public.marketing_alert_rules for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_alert_rules.farm_id
    )
  )
);

create policy marketing_alert_rules_update
on public.marketing_alert_rules for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_alert_rules.farm_id
    )
  )
)
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_alert_rules.farm_id
    )
  )
);

create policy marketing_alert_rules_delete
on public.marketing_alert_rules for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_alert_rules.farm_id
    )
  )
);
