-- Disposable-backend assertions for Initiative GL-2 (alert truth and feed
-- reconciliation). Runs after every migration on a fresh database, in the same
-- database and after the FS, FD, and GL-1 assertion files, so every id here is
-- distinct from theirs. Every failure raises; the last line prints
-- GL2_ALERT_ELIGIBILITY_DISPOSABLE_PASS.
--
-- What is proved: the marketing year is read from the commodity's configuration
-- and differs for wheat; a bid whose delivery window sits in another marketing
-- year is not eligible; a single delivery bound is read as a one-day window; a
-- bid with no window is spot and belongs to the crop year holding its bid date;
-- an unknown commodity is never eligible; the sweep picks the newest ELIGIBLE
-- bid, so an older eligible bid fires a rule that the newer ineligible bid would
-- have silenced; a USDA MARS feed row does satisfy a price-target rule; and the
-- only rows the sweep writes for that feed row are a notification and a rule
-- state -- no cash bid, contract, plan target, or bin movement.

\set ON_ERROR_STOP on
\set O7 '''00000000-0000-4000-8000-00000000000b'''
\set O8 '''00000000-0000-4000-8000-00000000000c'''
\set F1 '''00000000-0000-4000-8000-000000000070'''
\set F2 '''00000000-0000-4000-8000-000000000071'''
\set R1 '''00000000-0000-4000-8000-000000000080'''
\set R2 '''00000000-0000-4000-8000-000000000081'''

-- ------------------------------------------------- 1. configuration is read, not assumed
do $$
begin
  if (select marketing_year_start_month from public.commodities where id='corn_yellow') <> 9
    then raise exception 'corn marketing year does not start in September'; end if;
  if (select marketing_year_start_month from public.commodities where id='soybeans') <> 9
    then raise exception 'soybean marketing year does not start in September'; end if;
  if (select marketing_year_start_month from public.commodities where id='wheat') <> 6
    then raise exception 'wheat marketing year does not start in June'; end if;
  if public.commodity_marketing_year('corn_yellow',2026) <> daterange('2026-09-01','2027-09-01','[)')
    then raise exception 'corn 2026 marketing year is %', public.commodity_marketing_year('corn_yellow',2026); end if;
  if public.commodity_marketing_year('wheat',2026) <> daterange('2026-06-01','2027-06-01','[)')
    then raise exception 'wheat 2026 marketing year is %', public.commodity_marketing_year('wheat',2026); end if;
  if public.commodity_marketing_year('not_a_commodity',2026) is not null
    then raise exception 'an unknown commodity produced a marketing year'; end if;
end $$;

-- ------------------------------------------------- 2. the eligibility rule itself
do $$
begin
  -- A delivery window inside the crop's marketing year is eligible.
  if not public.cash_bid_eligible_for_crop_year('corn_yellow',2026,'2026-10-15','2026-11-01','2026-11-30')
    then raise exception 'a November 2026 window is not eligible for corn 2026'; end if;
  -- The next marketing year's window is not eligible for this crop year.
  if public.cash_bid_eligible_for_crop_year('corn_yellow',2026,'2026-10-15','2027-10-01','2027-10-31')
    then raise exception 'an October 2027 window is eligible for corn 2026'; end if;
  -- A window straddling the boundary is not wholly inside, so not eligible.
  if public.cash_bid_eligible_for_crop_year('corn_yellow',2026,'2026-10-15','2027-08-15','2027-09-15')
    then raise exception 'a window straddling the marketing-year end is eligible'; end if;
  -- The end bound is exclusive: delivery exactly on the next year's start is next year's.
  if public.cash_bid_eligible_for_crop_year('corn_yellow',2026,'2026-10-15','2027-09-01','2027-09-01')
    then raise exception 'a window starting on the next marketing year is eligible for this one'; end if;
  -- A single bound is read as a one-day window, not as open-ended.
  if not public.cash_bid_eligible_for_crop_year('corn_yellow',2026,'2026-10-15','2026-12-01',null)
    then raise exception 'a lone delivery start inside the year is not eligible'; end if;
  if public.cash_bid_eligible_for_crop_year('corn_yellow',2026,'2026-10-15',null,'2027-12-01')
    then raise exception 'a lone delivery end outside the year is eligible'; end if;
  -- No window at all is spot: it belongs to the crop year whose marketing year holds the bid date.
  if not public.cash_bid_eligible_for_crop_year('corn_yellow',2026,'2026-10-15',null,null)
    then raise exception 'an October 2026 spot bid is not eligible for corn 2026'; end if;
  if public.cash_bid_eligible_for_crop_year('corn_yellow',2026,'2026-08-15',null,null)
    then raise exception 'an August 2026 spot bid is eligible for corn 2026 (it is the 2025 crop)'; end if;
  if not public.cash_bid_eligible_for_crop_year('corn_yellow',2025,'2026-08-15',null,null)
    then raise exception 'an August 2026 spot bid is not eligible for corn 2025'; end if;
  -- Wheat's June boundary differs from corn's September boundary on the same date.
  if not public.cash_bid_eligible_for_crop_year('wheat',2026,'2026-08-15',null,null)
    then raise exception 'an August 2026 spot bid is not eligible for wheat 2026'; end if;
  -- Skip, never guess.
  if public.cash_bid_eligible_for_crop_year('not_a_commodity',2026,'2026-10-15',null,null)
    then raise exception 'an unknown commodity is eligible'; end if;
  if public.cash_bid_eligible_for_crop_year('corn_yellow',2026,null,null,null)
    then raise exception 'a bid with no date is eligible'; end if;
end $$;

-- ------------------------------------------------- fixtures for the sweep
insert into auth.users(id,email) values (:O7,'gl2-owner-a@example.test'),(:O8,'gl2-owner-b@example.test');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000b"}',false);
insert into public.farms(id,name,created_by,time_zone) values (:F1,'Eligibility Farm',:O7,'America/Chicago');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000c"}',false);
insert into public.farms(id,name,created_by,time_zone) values (:F2,'Feed Alert Farm',:O8,'America/Chicago');

-- The fixtures below are written with the service-role claim, the same way the GL-1 fan-out and the
-- sweep reach these tables. assert_current_farm_access_epoch exempts that role by design (migration
-- 0040), and a signed-in client could not insert a feed row at all: the GL-1 cash_bids_insert policy
-- requires feed_source to be null.
select set_config('request.jwt.claims','{"role":"service_role"}',false);

-- F1: the newest bid is INELIGIBLE and below the target; an older ELIGIBLE bid is above it.
-- Before GL-2 the sweep took the newest bid of any window and stayed silent.
insert into public.marketing_alert_rules(id,farm_id,crop_year,commodity_id,rule_type,direction,threshold)
values (:R1,:F1,2026,'corn_yellow','price_target','at_or_above',4.00);
insert into public.cash_bids(farm_id,elevator,commodity_id,bid_date,basis,cash_price,delivery_start,delivery_end)
values
 (:F1,'Newer New-Crop Bid','corn_yellow','2026-10-15',-0.30,3.00,'2027-10-01','2027-10-31'),
 (:F1,'Older Old-Crop Bid','corn_yellow','2026-10-14',-0.20,4.50,'2026-11-01','2026-11-30');

-- F2: one USDA MARS feed row, spot, above the target. Nothing farmer-entered.
insert into public.marketing_alert_rules(id,farm_id,crop_year,commodity_id,rule_type,direction,threshold)
values (:R2,:F2,2026,'corn_yellow','price_target','at_or_above',4.00);
insert into public.cash_bids(farm_id,elevator,commodity_id,bid_date,basis,cash_price,notes,feed_source,feed_report_id,feed_geography,feed_observation_key)
values (:F2,'Iowa Interior','corn_yellow','2026-10-15',-0.25,4.75,'[USDA MARS 2850 · Iowa]','usda_mars','2850','IA','gl2-assert-key-1');

-- The newest row for F1 really is the ineligible one, so the assertion below tests the filter
-- and not some accident of ordering.
do $$
begin
  if (select b.cash_price from public.cash_bids b where b.farm_id='00000000-0000-4000-8000-000000000070'
      order by b.bid_date desc, b.updated_at desc, b.id desc limit 1) <> 3.00
    then raise exception 'the newest F1 bid is not the ineligible one; the test proves nothing'; end if;
end $$;

-- ------------------------------------------------- 3. the sweep
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.run_scheduled_alert_sweep('2026-10-15 18:00:00+00'::timestamptz) as sweep;

do $$
declare
  v_count integer;
  v_body text;
begin
  -- The older ELIGIBLE bid fired the rule the newer ineligible bid would have silenced.
  select count(*), min(n.body) into v_count, v_body from public.notifications n
   where n.farm_id='00000000-0000-4000-8000-000000000070' and n.dedupe_key like 'marketing-rule:%';
  if v_count <> 1 then raise exception 'F1 produced % marketing notifications, expected 1', v_count; end if;
  if v_body not like '%4.50%' then raise exception 'F1 notification did not name the eligible bid: %', v_body; end if;
  if not (select is_condition_true from public.alert_rule_states where rule_id='00000000-0000-4000-8000-000000000080')
    then raise exception 'F1 rule state is not true'; end if;

  -- A USDA MARS feed row satisfied a price-target rule. This is the GL-2 decision.
  select count(*), min(n.body) into v_count, v_body from public.notifications n
   where n.farm_id='00000000-0000-4000-8000-000000000071' and n.dedupe_key like 'marketing-rule:%';
  if v_count <> 1 then raise exception 'the MARS feed row produced % notifications, expected 1', v_count; end if;
  if v_body not like '%4.75%' then raise exception 'the MARS notification did not name the feed price: %', v_body; end if;
  if not (select is_condition_true from public.alert_rule_states where rule_id='00000000-0000-4000-8000-000000000081')
    then raise exception 'the MARS-fired rule state is not true'; end if;

  -- and it wrote nothing else.
  select count(*) into v_count from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000071';
  if v_count <> 1 then raise exception 'the sweep changed the feed farm''s cash bids (% rows)', v_count; end if;
  select count(*) into v_count from public.grain_contracts where farm_id='00000000-0000-4000-8000-000000000071';
  if v_count <> 0 then raise exception 'the sweep wrote % contracts from a feed row', v_count; end if;
  select count(*) into v_count from public.marketing_plan_targets where farm_id='00000000-0000-4000-8000-000000000071';
  if v_count <> 0 then raise exception 'the sweep wrote % plan targets from a feed row', v_count; end if;
  select count(*) into v_count from public.bin_transactions where farm_id='00000000-0000-4000-8000-000000000071';
  if v_count <> 0 then raise exception 'the sweep wrote % bin movements from a feed row', v_count; end if;
end $$;

-- ------------------------------------------------- 4. an out-of-year bid alone fires nothing
update public.cash_bids set cash_price = 9.99
 where farm_id='00000000-0000-4000-8000-000000000070' and elevator='Older Old-Crop Bid';
update public.cash_bids set delivery_start='2027-10-01', delivery_end='2027-10-31'
 where farm_id='00000000-0000-4000-8000-000000000070' and elevator='Older Old-Crop Bid';
update public.alert_rule_states set is_condition_true=false where rule_id='00000000-0000-4000-8000-000000000080';
delete from public.notifications where farm_id='00000000-0000-4000-8000-000000000070';

select public.run_scheduled_alert_sweep('2026-10-15 18:00:00+00'::timestamptz) as sweep_again;

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.notifications
   where farm_id='00000000-0000-4000-8000-000000000070' and dedupe_key like 'marketing-rule:%';
  if v_count <> 0 then raise exception 'a $9.99 next-crop-year bid fired a 2026 rule (% notifications)', v_count; end if;
  if (select is_condition_true from public.alert_rule_states where rule_id='00000000-0000-4000-8000-000000000080')
    then raise exception 'a next-crop-year bid left the 2026 rule condition true'; end if;
end $$;

-- ------------------------------------------------- 5. one selection, shared by the sweep and the email
-- Codex P1 on 97ad961: the browser marks alert_rule_states true as soon as its own evaluation says so.
-- If deliver-grain-alert then judged the rule by a different bid it would 409, and the next sweep,
-- seeing no transition, would send nothing at all. Both now call latest_eligible_cash_bid.
do $$
declare
  v_price numeric;
  v_id uuid;
begin
  -- The MARS feed row is what the farm's rule is reached by, and the shared selection returns it.
  select cash_price into v_price from public.latest_eligible_cash_bid('00000000-0000-4000-8000-000000000071','corn_yellow',2026,'2026-10-15'::date);
  if v_price is distinct from 4.75 then raise exception 'the shared selection did not return the MARS bid (got %)', v_price; end if;

  -- Section 4 moved both of F1's bids into the next marketing year, so nothing is eligible for 2026 and
  -- the selection returns no row at all rather than falling back to the newest bid of any year.
  if exists (select 1 from public.latest_eligible_cash_bid('00000000-0000-4000-8000-000000000070','corn_yellow',2026,'2026-10-15'::date))
    then raise exception 'the shared selection returned a next-crop-year bid for a 2026 rule'; end if;

  -- With an eligible bid put back, the older ELIGIBLE row wins over the newer ineligible one. This is
  -- exactly the case where a re-check reading "newest manual bid" would disagree with the sweep, 409,
  -- and leave alert_rule_states true with nothing sent.
  insert into public.cash_bids(farm_id,elevator,commodity_id,bid_date,basis,cash_price,delivery_start,delivery_end)
  values ('00000000-0000-4000-8000-000000000070','Older Eligible','corn_yellow','2026-10-14',-0.20,4.50,'2026-11-01','2026-11-30');
  select id, cash_price into v_id, v_price from public.latest_eligible_cash_bid('00000000-0000-4000-8000-000000000070','corn_yellow',2026,'2026-10-15'::date);
  if v_price is distinct from 4.50 then raise exception 'the shared selection did not return the older eligible bid (got %)', v_price; end if;
  if (select elevator from public.cash_bids where id = v_id) <> 'Older Eligible' then raise exception 'the selection returned the wrong row'; end if;

  -- Outside the freshness window it returns nothing rather than an old bid.
  if exists (select 1 from public.latest_eligible_cash_bid('00000000-0000-4000-8000-000000000071','corn_yellow',2026,'2026-10-30'::date))
    then raise exception 'the shared selection returned a bid past its freshness window'; end if;

  -- A crop year the bids do not belong to yields nothing.
  if exists (select 1 from public.latest_eligible_cash_bid('00000000-0000-4000-8000-000000000071','corn_yellow',2030,'2026-10-15'::date))
    then raise exception 'the shared selection returned a bid for a crop year it cannot satisfy'; end if;
end $$;

-- It reads one farm's private bids by id, so it is server-owned and not offered to a signed-in client.
do $$
begin
  if has_function_privilege('authenticated','public.latest_eligible_cash_bid(uuid,text,integer,date,integer)','execute')
    then raise exception 'a signed-in client can call latest_eligible_cash_bid'; end if;
  if has_function_privilege('anon','public.latest_eligible_cash_bid(uuid,text,integer,date,integer)','execute')
    then raise exception 'an anonymous caller can call latest_eligible_cash_bid'; end if;
  if not has_function_privilege('service_role','public.latest_eligible_cash_bid(uuid,text,integer,date,integer)','execute')
    then raise exception 'the service role cannot call latest_eligible_cash_bid'; end if;
end $$;

-- ------------------------------------------------- 6. a legacy feed row is not a manual bid
-- Before GL-1 added feed_source a feed row carried its provenance in the note, and isMarsBid has always
-- honoured both. SQL that read only the column would return such a row as a farm's newest MANUAL bid,
-- the browser would discard it as feed, and the farm would show no manual valuation at all.
insert into public.cash_bids(farm_id,elevator,commodity_id,bid_date,basis,cash_price,notes)
values
 ('00000000-0000-4000-8000-000000000071','Legacy Feed Row','soybeans','2026-10-15',-0.40,11.00,'[USDA MARS 2850 · Iowa] pre-column row'),
 ('00000000-0000-4000-8000-000000000071','Real Manual Bid','soybeans','2026-10-14',-0.35,10.90,'typed by the farmer');

do $$
declare v_elevator text;
begin
  if not public.cash_bid_is_feed('usda_mars', null) then raise exception 'the provenance column must mark a feed row'; end if;
  if not public.cash_bid_is_feed(null, '[USDA MARS 2850 · Iowa]') then raise exception 'the legacy note must mark a feed row'; end if;
  if not public.cash_bid_is_feed(null, '[USDA MARS 2850]') then raise exception 'a legacy note without a geography must mark a feed row'; end if;
  if public.cash_bid_is_feed(null, 'Cargill quoted this by phone') then raise exception 'an ordinary note must not mark a feed row'; end if;
  if public.cash_bid_is_feed(null, 'see [USDA MARS 2850] for context') then raise exception 'the marker is anchored at the start; a mention mid-note is not provenance'; end if;
  if public.cash_bid_is_feed(null, null) then raise exception 'a row with no provenance at all must not be a feed row'; end if;

  -- The per-commodity selection must reach past the legacy row to the farmer's own bid.
  select b.elevator into v_elevator
  from public.latest_cash_bids_per_commodity('00000000-0000-4000-8000-000000000071') b
  where b.commodity_id = 'soybeans' and not public.cash_bid_is_feed(b.feed_source, b.notes);
  if v_elevator is distinct from 'Real Manual Bid' then raise exception 'the manual selection returned % instead of the farmer''s own bid', coalesce(v_elevator, 'nothing'); end if;

  -- and it must still surface the legacy row on the feed side, where the basis history shows it.
  select b.elevator into v_elevator
  from public.latest_cash_bids_per_commodity('00000000-0000-4000-8000-000000000071') b
  where b.commodity_id = 'soybeans' and public.cash_bid_is_feed(b.feed_source, b.notes);
  if v_elevator is distinct from 'Legacy Feed Row' then raise exception 'the legacy feed row was lost instead of being classified as feed'; end if;
end $$;

select set_config('request.jwt.claims','',false);
select 'GL2_ALERT_ELIGIBILITY_DISPOSABLE_PASS' as result;
