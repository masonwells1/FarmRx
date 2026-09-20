-- GL-2: alert truth and feed reconciliation.
--
-- Two things are settled here, in one place each.
--
-- 1. A USDA MARS feed row MAY satisfy a marketing price-target rule. That is the decision, not an
--    oversight: the feed exists so a farmer learns a target was reached without typing a bid. The
--    browser continues to keep feed rows out of position and revenue VALUATION (basisMath.isMarsBid);
--    the sweep admits them for ALERTING. Those are the two halves of one split and they must stay
--    exactly that: a feed row may cause the sweep's own notifications and alert_rule_states rows (and
--    the push/email deliveries those produce) and nothing else. No contract, marketing target, manual
--    bid, bin, or on-hand quantity is ever written from feed data.
--
-- 2. A bid is eligible for a rule's crop year only when its delivery window sits inside that crop's
--    marketing year. Before this migration the sweep took the newest bid for the commodity whatever
--    its delivery window, so a new-crop bid could fire an old-crop target. The rule lives in exactly
--    one function, public.cash_bid_eligible_for_crop_year, used by the sweep and mirrored in the
--    browser by src/data/marketingYear.ts.

-- Marketing-year start, recorded once as configuration. USDA convention: corn and soybeans begin
-- September 1, wheat June 1. Days are capped at 28 so no marketing year can start on a date that
-- some year does not have.
alter table public.commodities
  add column if not exists marketing_year_start_month smallint not null default 9,
  add column if not exists marketing_year_start_day smallint not null default 1;

alter table public.commodities drop constraint if exists commodities_marketing_year_start_valid;
alter table public.commodities add constraint commodities_marketing_year_start_valid check (
  marketing_year_start_month between 1 and 12 and marketing_year_start_day between 1 and 28
);

update public.commodities set marketing_year_start_month = 6, marketing_year_start_day = 1, updated_at = now()
where crop_family = 'wheat'
  and (marketing_year_start_month, marketing_year_start_day) is distinct from (6::smallint, 1::smallint);

update public.commodities set marketing_year_start_month = 9, marketing_year_start_day = 1, updated_at = now()
where crop_family in ('corn', 'soybeans')
  and (marketing_year_start_month, marketing_year_start_day) is distinct from (9::smallint, 1::smallint);

-- The marketing year for one crop year: [start of that year, start of the next), so a window ending
-- exactly on the next year's start belongs to the next year, not this one.
create or replace function public.commodity_marketing_year(p_commodity_id text, p_crop_year integer)
returns daterange
language sql
stable
set search_path = pg_catalog
as $fn$
  select daterange(
    make_date(p_crop_year, c.marketing_year_start_month::integer, c.marketing_year_start_day::integer),
    make_date(p_crop_year + 1, c.marketing_year_start_month::integer, c.marketing_year_start_day::integer),
    '[)'
  )
  from public.commodities c
  where c.id = p_commodity_id;
$fn$;

comment on function public.commodity_marketing_year(text, integer) is
  'GL-2: the marketing year for a commodity and crop year, from the commodity''s configured start. Null for an unknown commodity.';

-- GL-2: the one place crop-year eligibility is decided.
--   * A bid carrying any delivery bound is eligible only when its whole window lies inside the
--     marketing year. cash_bids permits one bound to be null, so a single bound is read as a
--     one-day window rather than treated as open-ended.
--   * A bid with no delivery bounds is spot, and belongs to the crop year whose marketing year
--     contains its bid date.
--   * An unknown commodity is never eligible (skip, never guess).
create or replace function public.cash_bid_eligible_for_crop_year(
  p_commodity_id text,
  p_crop_year integer,
  p_bid_date date,
  p_delivery_start date default null,
  p_delivery_end date default null
)
returns boolean
language sql
stable
set search_path = pg_catalog
as $fn$
  select case
    when v.marketing_year is null or p_bid_date is null then false
    when p_delivery_start is null and p_delivery_end is null then v.marketing_year @> p_bid_date
    else v.marketing_year @> coalesce(p_delivery_start, p_delivery_end)
     and v.marketing_year @> coalesce(p_delivery_end, p_delivery_start)
  end
  from (select public.commodity_marketing_year(p_commodity_id, p_crop_year) as marketing_year) v;
$fn$;

comment on function public.cash_bid_eligible_for_crop_year(text, integer, date, date, date) is
  'GL-2: whether a cash bid may satisfy a rule for this crop year. Delivery window inside the marketing year, or a spot bid dated inside it. The sweep and src/data/marketingYear.ts must agree.';

-- GL-2 repair (Codex P1 on 97ad961): the newest bid that may satisfy a rule, as ONE selection.
-- The sweep and deliver-grain-alert's email re-check both call this. They must never disagree: the
-- browser records the rule transition as true the moment its own evaluation says so, and if the email
-- re-check then judges the rule by a different bid it returns 409 while alert_rule_states is already
-- true -- so the next sweep sees no transition and the alert is lost with nothing sent.
-- Feed rows are admitted here, exactly as in the sweep: that is GL-2's decision.
create or replace function public.latest_eligible_cash_bid(
  p_farm_id uuid,
  p_commodity_id text,
  p_crop_year integer,
  p_as_of date,
  p_max_age_days integer default 2
)
returns table (id uuid, cash_price numeric, bid_date date)
language sql
stable
set search_path = pg_catalog
as $fn$
  select b.id, b.cash_price, b.bid_date
  from public.cash_bids b
  where b.farm_id = p_farm_id
    and b.commodity_id = p_commodity_id
    and b.cash_price is not null
    and b.bid_date between p_as_of - p_max_age_days and p_as_of
    and public.cash_bid_eligible_for_crop_year(p_commodity_id, p_crop_year, b.bid_date, b.delivery_start, b.delivery_end)
  order by b.bid_date desc, b.updated_at desc, b.id desc
  limit 1;
$fn$;

comment on function public.latest_eligible_cash_bid(uuid, text, integer, date, integer) is
  'GL-2: the one selection of the bid that may satisfy a price-target rule. Used by run_scheduled_alert_sweep and by deliver-grain-alert, so the sweep and the email can never judge a rule by different bids.';

-- Server-owned. It reads one farm's private bids by id, so it is not offered to a signed-in client.
revoke all on function public.latest_eligible_cash_bid(uuid, text, integer, date, integer) from public, anon, authenticated;
grant execute on function public.latest_eligible_cash_bid(uuid, text, integer, date, integer) to service_role;

-- GL-2 repair (Codex P2 on e480051): a bounded read cannot promise what each consumer needs.
-- The browser loads cash_bids as two capped windows. That keeps the newest rows, but a farm with more
-- manual bids than the manual cap can still lose the latest bid for ONE commodity behind newer bids for
-- another, and valuation (latestBasis), the counterparty suggestions and the Today grain line would then
-- read no bid or an older one. The rows that must never be missing are few and knowable: for each
-- commodity, the newest farmer-entered bid and the newest feed bid. That is at most two rows per
-- commodity, so it is fetched exactly rather than hoped for inside a cap.
--
-- Security-invoker on purpose: this returns cash_bids rows to a signed-in client, so row-level security
-- must apply to it exactly as it does to a direct select.
-- GL-2 repair (Codex P2 on 4365c17): what counts as a feed row, in one SQL place.
-- A row written before GL-1 added feed_source carries its provenance in the note instead, and the
-- browser's isMarsBid has always honoured both. SQL that reads only feed_source would hand back such a
-- legacy row as a farm's newest MANUAL bid; the browser would then discard it as feed, and the farm
-- would show no manual valuation at all while a real manual bid sat just outside the loaded window.
-- The pattern below is the exact SQL twin of `marsNote` in src/data/basisMath.ts, pinned to it by a
-- static guard: an opening bracket, the report id, an optional middle dot and geography, a closing
-- bracket, anchored at the start of the note.
create or replace function public.cash_bid_is_feed(p_feed_source text, p_notes text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $fn$
  select p_feed_source is not null or coalesce(p_notes, '') ~ '^\[USDA MARS \S+( · [^]]+)?\]';
$fn$;

comment on function public.cash_bid_is_feed(text, text) is
  'GL-2: whether a cash bid is USDA MARS feed history, by provenance column or by the legacy note marker. The SQL twin of isMarsBid in src/data/basisMath.ts; the two must agree.';

create or replace function public.latest_cash_bids_per_commodity(p_farm_id uuid)
returns setof public.cash_bids
language sql
stable
security invoker
set search_path = pg_catalog
as $fn$
  (
    select distinct on (b.commodity_id) b.*
    from public.cash_bids b
    where b.farm_id = p_farm_id and not public.cash_bid_is_feed(b.feed_source, b.notes)
    order by b.commodity_id, b.bid_date desc, b.updated_at desc, b.id desc
  )
  union all
  (
    select distinct on (b.commodity_id) b.*
    from public.cash_bids b
    where b.farm_id = p_farm_id and public.cash_bid_is_feed(b.feed_source, b.notes)
    order by b.commodity_id, b.bid_date desc, b.updated_at desc, b.id desc
  );
$fn$;

comment on function public.latest_cash_bids_per_commodity(uuid) is
  'GL-2: the newest farmer-entered bid and the newest feed bid for each commodity on a farm. Row-level security applies. The browser merges these into its bounded windows so a capped read can never silently drop the bid a calculation depends on.';

revoke all on function public.latest_cash_bids_per_commodity(uuid) from public, anon;
grant execute on function public.latest_cash_bids_per_commodity(uuid) to authenticated, service_role;

-- The sweep, replaced whole from migration 20260716122213_0039 with one change: its price_target
-- select becomes a call to latest_eligible_cash_bid above, so the newest ELIGIBLE bid decides the rule
-- instead of the newest bid of any delivery window, and the sweep and the email re-check read one
-- expression rather than two that can drift. Feed rows are deliberately not excluded (see the note at
-- the top of this file).
create or replace function public.run_scheduled_alert_sweep(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_farm public.farms%rowtype;
  v_rule public.marketing_alert_rules%rowtype;
  v_owner uuid;
  v_local_date date;
  v_condition boolean;
  v_previous boolean;
  v_price numeric;
  v_bid_date date;
  v_production numeric;
  v_contracts numeric;
  v_pct numeric;
  v_notification_id uuid;
  v_created integer := 0;
  v_program_created integer := 0;
  v_program_result jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_title text;
  v_body text;
  v_processed integer := 0;
  v_failed integer := 0;
  v_failed_farm_ids jsonb := '[]'::jsonb;
  v_farm_created integer;
  v_farm_program_created integer;
  v_farm_ids jsonb;
begin
  if not public.request_uses_service_role() then raise exception 'server scheduler only'; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('farm-rx-scheduled-alert-sweep')) then
    return pg_catalog.jsonb_build_object('skipped','already_running');
  end if;

  for v_farm in select * from public.farms order by id loop
    begin
      v_farm_created := 0;
      v_farm_program_created := 0;
      v_farm_ids := '[]'::jsonb;
      v_local_date := (p_now at time zone v_farm.time_zone)::date;
      v_program_result := public.generate_due_program_notifications(v_farm.id, v_local_date);
      v_farm_program_created := coalesce((v_program_result->>'created_count')::integer, 0);
      select user_id into v_owner from public.farm_memberships
      where farm_id=v_farm.id and role='owner' and status='active'
      order by user_id limit 1;

      if v_owner is not null then
        for v_rule in select * from public.marketing_alert_rules where farm_id=v_farm.id and active order by id loop
          v_condition:=false; v_price:=null; v_bid_date:=null; v_pct:=null;
          v_title:='Farm Rx marketing reminder';
          v_body:=coalesce(v_rule.message,'A saved grain item needs your review.');
          if v_rule.rule_type='price_target' then
            select b.cash_price,b.bid_date into v_price,v_bid_date
            from public.latest_eligible_cash_bid(v_farm.id,v_rule.commodity_id,v_rule.crop_year,v_local_date) b;
            v_condition:=v_price is not null and ((v_rule.direction='at_or_above' and v_price>=v_rule.threshold) or (v_rule.direction='at_or_below' and v_price<=v_rule.threshold));
            v_title:='Farm Rx price target reached';
            if v_condition then v_body:=v_rule.crop_year||' '||v_rule.commodity_id||' cash price is $'||trim(to_char(v_price,'FM999999990.00'))||' from the '||v_bid_date||' bid.'; end if;
          elsif v_rule.rule_type='pct_marketed_goal' then
            select coalesce(sum(case when pe.drives_math='actual' and pe.actual_bushels is not null then pe.actual_bushels else pe.expected_bushels end),0) into v_production
            from public.production_estimates pe where pe.farm_id=v_farm.id and pe.crop_year=v_rule.crop_year and pe.commodity_id=v_rule.commodity_id
              and pe.operating_entity_id is not distinct from v_rule.operating_entity_id and pe.enterprise_label is not distinct from v_rule.enterprise_label;
            select coalesce(sum(gc.bushels),0) into v_contracts from public.grain_contracts gc
            where gc.farm_id=v_farm.id and gc.crop_year=v_rule.crop_year and gc.commodity_id=v_rule.commodity_id
              and gc.operating_entity_id is not distinct from v_rule.operating_entity_id and gc.enterprise_label is not distinct from v_rule.enterprise_label;
            v_pct:=case when v_production>0 then v_contracts/v_production*100 else null end;
            v_condition:=v_pct is not null and v_pct<v_rule.threshold;
            v_title:='Farm Rx marketed goal reminder';
            if v_condition then v_body:=v_rule.crop_year||' '||v_rule.commodity_id||' is '||trim(to_char(v_pct,'FM990.0'))||'% marketed; your goal is '||trim(to_char(v_rule.threshold,'FM990.0'))||'%.'; end if;
          elsif v_rule.rule_type='deadline' then
            v_condition:=v_rule.remind_on between v_local_date and v_local_date+7;
            v_title:='Farm Rx marketing deadline';
            if v_condition then v_body:=v_rule.crop_year||' '||v_rule.commodity_id||' reminder is due '||v_rule.remind_on||'.'; end if;
          end if;

          perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_rule.id::text,0));
          insert into public.alert_rule_states(rule_id,is_condition_true) values(v_rule.id,false) on conflict(rule_id) do nothing;
          select is_condition_true into v_previous from public.alert_rule_states where rule_id=v_rule.id for update;
          v_notification_id:=null;
          if not v_previous and v_condition then
            insert into public.notifications(farm_id,user_id,category,title,body,link,dedupe_key,created_by)
            values(v_farm.id,v_owner,'general',left(v_title,160),left(v_body,500),'/grain','marketing-rule:'||v_rule.id||':'||v_local_date,v_owner)
            on conflict(farm_id,user_id,dedupe_key) where dedupe_key is not null do nothing returning id into v_notification_id;
            if v_notification_id is not null then
              v_farm_created:=v_farm_created+1;
              v_farm_ids:=v_farm_ids||pg_catalog.to_jsonb(v_notification_id);
              update public.marketing_alert_rules set last_triggered_at=p_now where id=v_rule.id and farm_id=v_farm.id;
            end if;
          end if;
          update public.alert_rule_states set is_condition_true=v_condition,
            fired_at=case when not v_previous and v_condition then p_now else fired_at end,
            updated_at=p_now where rule_id=v_rule.id;
        end loop;
      end if;
      v_created := v_created + v_farm_created;
      v_program_created := v_program_created + v_farm_program_created;
      v_ids := v_ids || v_farm_ids;
      v_processed := v_processed + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_failed_farm_ids := v_failed_farm_ids || pg_catalog.to_jsonb(v_farm.id);
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'marketing_created',v_created,
    'program_created',v_program_created,
    'notification_ids',v_ids,
    'processed_farm_count',v_processed,
    'farm_failure_count',v_failed,
    'failed_farm_ids',v_failed_farm_ids
  );
end;
$$;
