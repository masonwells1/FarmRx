-- Grain Live tranche 1 (GL-1): the USDA AMS My Market News (MARS) basis feed.
--
-- 1. farms.market_region          the owner's explicit market state; no default,
--                                 never inferred; a farm without one gets no feed
-- 2. usda_market_reports          the verified mapping report id -> geography
-- 3. usda_market_report_runs      the service-only run log ("once per market day")
-- 4. cash_bids feed provenance    four columns set together on a feed row, a
--                                 per-farm unique key, and client policies that
--                                 can neither create nor alter a feed row
-- 5. ingest_usda_mars_observations the service-only transactional fan-out
--
-- Feed rows are display-and-history only for valuation: nothing here touches
-- contracts, marketing targets, bins, deliveries, or on-hand quantities, and the
-- browser's MARS fence (isMarsBid) keeps them out of position math. The alert
-- sweep's treatment of feed rows is GL-2's concern and is unchanged here.

-- ---------------------------------------------------------------------------
-- 1. The farm's market region (a two-letter US state code), set by an owner or
--    manager through the existing farms_update policy (can_manage_farm).
-- ---------------------------------------------------------------------------
alter table public.farms
  add column market_region text
  constraint farms_market_region_valid check (
    market_region is null
    or market_region = any (array[
      'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
      'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
      'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
    ])
  );

comment on column public.farms.market_region is
  'The state whose USDA cash-grain-bid reports this farm receives (GL-1). Null means no feed; set explicitly by an owner or manager, never inferred from fields or addresses.';

-- ---------------------------------------------------------------------------
-- 2. Verified report -> geography mapping. Signed-in users may read it so the
--    Grain page can name the reports covering a farm''s region; only the
--    service role writes it. verified_at is stamped by an owner-recorded live
--    action after the report''s coverage is confirmed on the USDA listing.
-- ---------------------------------------------------------------------------
create table public.usda_market_reports (
  report_id text primary key check (report_id ~ '^[0-9]{3,6}$'),
  name text not null check (length(btrim(name)) between 1 and 200),
  geography text not null check (geography ~ '^[A-Z]{2}$'),
  geography_label text not null check (length(btrim(geography_label)) between 1 and 80),
  verified_at timestamptz,
  verification_note text check (verification_note is null or length(verification_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger usda_market_reports_set_updated_at
before update on public.usda_market_reports
for each row execute function public.set_updated_at();

alter table public.usda_market_reports enable row level security;
revoke all on table public.usda_market_reports from public, anon, authenticated;
grant select on table public.usda_market_reports to authenticated;

create policy usda_market_reports_select
on public.usda_market_reports for select to authenticated
using (true);

insert into public.usda_market_reports (report_id, name, geography, geography_label, verified_at, verification_note)
values (
  '2850',
  'Iowa Daily Cash Grain Bids',
  'IA',
  'Iowa',
  null,
  'Recorded from docs/grain-live-design.md and docs/futures-feed-research.md. Confirm the report title and the geography it covers on the USDA MARS report listing, then stamp verified_at. Until then the feed writes no row for this report.'
);

-- ---------------------------------------------------------------------------
-- 3. Run log: service-only. One successful run per report and market day lets
--    the next scheduled run skip the fetch; failures are recorded without
--    secrets and leave existing history untouched.
-- ---------------------------------------------------------------------------
create table public.usda_market_report_runs (
  id uuid primary key default gen_random_uuid(),
  report_id text not null references public.usda_market_reports(report_id) on delete restrict,
  market_date date not null,
  report_date date,
  status text not null default 'started' check (status in ('started', 'ok', 'skipped', 'failed')),
  fetched_rows integer not null default 0 check (fetched_rows >= 0),
  written_rows integer not null default 0 check (written_rows >= 0),
  unchanged_rows integer not null default 0 check (unchanged_rows >= 0),
  skipped_rows integer not null default 0 check (skipped_rows >= 0),
  farms_written integer not null default 0 check (farms_written >= 0),
  detail jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index usda_market_report_runs_report_day_idx
  on public.usda_market_report_runs (report_id, market_date, status);

alter table public.usda_market_report_runs enable row level security;
revoke all on table public.usda_market_report_runs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Feed provenance on cash_bids. A farmer''s row keeps all four null; a feed
--    row sets all four. The unique index is the fan-out''s upsert key, per farm.
-- ---------------------------------------------------------------------------
alter table public.cash_bids
  add column feed_source text,
  add column feed_report_id text references public.usda_market_reports(report_id) on delete restrict,
  add column feed_geography text,
  add column feed_observation_key text,
  add constraint cash_bids_feed_columns_together check (
    (feed_source is null and feed_report_id is null and feed_geography is null and feed_observation_key is null)
    or (
      feed_source = 'usda_mars'
      and feed_report_id is not null
      and feed_geography ~ '^[A-Z]{2}$'
      and length(feed_observation_key) between 1 and 200
    )
  );

create unique index cash_bids_feed_observation_per_farm
  on public.cash_bids (farm_id, feed_observation_key)
  where feed_observation_key is not null;

-- Every public foreign key carries a covering index (advisor hardening, proof 0043).
create index cash_bids_feed_report_id_idx
  on public.cash_bids (feed_report_id);

comment on column public.cash_bids.feed_source is
  'Null for a farmer-entered bid. ''usda_mars'' for a row written by the GL-1 feed; such rows are display-and-history only and never enter position, revenue, or plan math.';

-- A signed-in client can neither create a feed row nor turn one into a manual
-- bid nor remove one from the farm''s history; the service role writes feed
-- rows only through ingest_usda_mars_observations below.
alter policy cash_bids_insert
on public.cash_bids
with check (public.can_edit_farm(farm_id) and feed_source is null);

alter policy cash_bids_update
on public.cash_bids
using (public.can_edit_farm(farm_id) and feed_source is null)
with check (public.can_edit_farm(farm_id) and feed_source is null);

alter policy cash_bids_delete
on public.cash_bids
using (public.can_edit_farm(farm_id) and feed_source is null);

-- ---------------------------------------------------------------------------
-- 5. The fan-out. Executable by the service role only. Refuses an unknown or
--    unverified report. Validates every observation and skips (counts) any it
--    cannot trust. Writes one private row per eligible farm (market_region =
--    the report''s geography) by upsert on (farm_id, feed_observation_key); an
--    unchanged row is left alone so its updated_at never moves and a retried
--    run cannot change which row the alert sweep sees as newest.
-- ---------------------------------------------------------------------------
create function public.ingest_usda_mars_observations(p_report_id text, p_run_id uuid, p_observations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report public.usda_market_reports%rowtype;
  v_farm_ids uuid[];
  v_farm_id uuid;
  v_row jsonb;
  v_index integer := 0;
  v_key text;
  v_elevator text;
  v_commodity text;
  v_bid_date date;
  v_basis numeric;
  v_cash_price numeric;
  v_delivery_start date;
  v_delivery_end date;
  v_source_note text;
  v_note text;
  v_existing public.cash_bids%rowtype;
  v_written integer := 0;
  v_unchanged integer := 0;
  v_skipped integer := 0;
  v_valid integer := 0;
  v_skips jsonb := '[]'::jsonb;
  v_reason text;
begin
  if p_report_id is null or p_observations is null or jsonb_typeof(p_observations) <> 'array' then
    raise exception using errcode = 'P0001', message = 'USDA_MARS_INGEST_BAD_INPUT';
  end if;

  select * into v_report from public.usda_market_reports where report_id = p_report_id;
  if not found then
    return jsonb_build_object('status', 'skipped', 'reason', 'report_unknown', 'report_id', p_report_id);
  end if;
  if v_report.verified_at is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'report_unverified', 'report_id', p_report_id);
  end if;

  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_farm_ids
  from public.farms
  where market_region = v_report.geography;

  for v_row in select value from jsonb_array_elements(p_observations) loop
    v_index := v_index + 1;
    v_reason := null;
    begin
      if jsonb_typeof(v_row) <> 'object' then
        v_reason := 'not_an_object';
      else
        v_key := v_row ->> 'observation_key';
        v_elevator := btrim(coalesce(v_row ->> 'elevator', ''));
        v_commodity := v_row ->> 'commodity_id';
        v_source_note := v_row ->> 'source_note';
        if v_key is null or length(v_key) not between 1 and 200 then v_reason := 'bad_key';
        elsif length(v_elevator) not between 1 and 200 then v_reason := 'bad_elevator';
        elsif v_commodity is null or not exists (select 1 from public.commodities c where c.id = v_commodity) then v_reason := 'unknown_commodity';
        elsif jsonb_typeof(v_row -> 'basis') <> 'number' then v_reason := 'bad_basis';
        elsif not (jsonb_typeof(v_row -> 'cash_price') in ('number', 'null') or v_row -> 'cash_price' is null) then v_reason := 'bad_cash_price';
        elsif v_source_note is not null and length(v_source_note) > 500 then v_reason := 'bad_note';
        end if;
        if v_reason is null then
          v_bid_date := (v_row ->> 'bid_date')::date;
          v_basis := (v_row ->> 'basis')::numeric;
          v_cash_price := case when jsonb_typeof(v_row -> 'cash_price') = 'number' then (v_row ->> 'cash_price')::numeric else null end;
          v_delivery_start := (v_row ->> 'delivery_start')::date;
          v_delivery_end := (v_row ->> 'delivery_end')::date;
          if v_cash_price is not null and v_cash_price < 0 then v_reason := 'negative_cash_price';
          elsif v_delivery_start is not null and v_delivery_end is not null and v_delivery_end < v_delivery_start then v_reason := 'delivery_order';
          end if;
        end if;
      end if;
    exception when others then
      v_reason := 'malformed';
    end;

    if v_reason is not null then
      v_skipped := v_skipped + 1;
      v_skips := v_skips || jsonb_build_object('index', v_index, 'reason', v_reason);
      continue;
    end if;

    v_valid := v_valid + 1;
    v_note := '[USDA MARS ' || v_report.report_id || ' · ' || v_report.geography_label || ']' || coalesce(' ' || v_source_note, '');

    foreach v_farm_id in array v_farm_ids loop
      select * into v_existing from public.cash_bids
      where farm_id = v_farm_id and feed_observation_key = v_key
      for update;
      if not found then
        begin
          insert into public.cash_bids (farm_id, elevator, commodity_id, bid_date, basis, cash_price, delivery_start, delivery_end, notes, feed_source, feed_report_id, feed_geography, feed_observation_key)
          values (v_farm_id, v_elevator, v_commodity, v_bid_date, v_basis, v_cash_price, v_delivery_start, v_delivery_end, v_note, 'usda_mars', v_report.report_id, v_report.geography, v_key);
          v_written := v_written + 1;
        exception when unique_violation then
          -- A concurrent run landed first; its row is the truth and this one is unchanged.
          v_unchanged := v_unchanged + 1;
        end;
      elsif (v_existing.elevator, v_existing.commodity_id, v_existing.bid_date, v_existing.basis, v_existing.cash_price, v_existing.delivery_start, v_existing.delivery_end, v_existing.notes)
            is distinct from (v_elevator, v_commodity, v_bid_date, v_basis, v_cash_price, v_delivery_start, v_delivery_end, v_note) then
        update public.cash_bids
        set elevator = v_elevator, commodity_id = v_commodity, bid_date = v_bid_date, basis = v_basis, cash_price = v_cash_price,
            delivery_start = v_delivery_start, delivery_end = v_delivery_end, notes = v_note, updated_at = now()
        where id = v_existing.id;
        v_written := v_written + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'report_id', v_report.report_id,
    'geography', v_report.geography,
    'run_id', p_run_id,
    'farms_eligible', coalesce(array_length(v_farm_ids, 1), 0),
    'observations', v_index,
    'valid_observations', v_valid,
    'written_rows', v_written,
    'unchanged_rows', v_unchanged,
    'skipped_observations', v_skipped,
    'skips', v_skips
  );
end;
$$;

revoke all on function public.ingest_usda_mars_observations(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_usda_mars_observations(text, uuid, jsonb) to service_role;

comment on function public.ingest_usda_mars_observations(text, uuid, jsonb) is
  'GL-1: service-only fan-out of validated USDA MARS observations into every farm whose market_region matches the verified report''s geography. Skips, never guesses; an unchanged row is never rewritten.';
