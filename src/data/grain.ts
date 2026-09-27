import { farmCalendarDate } from './farmDates'
import type { Commodity, FieldsData, ReadOnlySnapshot } from './fields'
import type { FarmOperationContext } from './farmOperationContext'
import type { ProfitabilityRepository } from './profitability'
import { binLotsOnHand, deriveBinLots, type BinLotOnHand } from './committedFree'

export type ProductionMathBasis = 'projected' | 'actual'
export type GrainContractType = 'cash_spot' | 'forward_cash' | 'basis' | 'hta'
export type GrainStorageLocationType = 'on_farm' | 'commercial'
export type MarketingAlertRuleType = 'price_target' | 'pct_marketed_goal' | 'deadline'
export type MarketingAlertDirection = 'at_or_above' | 'at_or_below'
export type FirmOfferType = 'cash' | 'basis' | 'hta'
export type FirmOfferStatus = 'open' | 'filled' | 'expired' | 'canceled'
export type BinTransactionDirection = 'in' | 'out'
/** Matches the tiny rounding allowance enforced by the plan RPC. */
export const MARKETING_PLAN_PERCENT_TOLERANCE = 100.000001

export interface PositionScope {
  farm_id: string
  crop_year: number
  commodity_id: string
  operating_entity_id: string | null
  enterprise_label: string | null
}

/** The one join identity for every crop-year grain record. */
export function scopeKey(scope: PositionScope): string {
  return [scope.farm_id, scope.crop_year, scope.commodity_id, scope.operating_entity_id ?? '', scope.enterprise_label ?? ''].join('|')
}

export function scopeOf(row: PositionScope): PositionScope {
  return { farm_id: row.farm_id, crop_year: row.crop_year, commodity_id: row.commodity_id, operating_entity_id: row.operating_entity_id, enterprise_label: row.enterprise_label }
}

export const sameScope = (row: PositionScope, scope: PositionScope) => scopeKey(row) === scopeKey(scope)

export interface ProductionEstimate extends PositionScope {
  id: string
  planted_acres: number | null
  aph_yield: number
  expected_bushels: number
  actual_bushels: number | null
  drives_math: ProductionMathBasis
  notes: string | null
  created_at: string
  updated_at: string
}

export interface GrainContract extends PositionScope {
  id: string
  contract_type: GrainContractType
  buyer: string
  bushels: number
  futures_price: number | null
  basis: number | null
  cash_price: number | null
  delivery_start: string | null
  delivery_end: string | null
  contract_number: string | null
  premium_cents_per_bu: number
  notes: string | null
  created_at: string
  updated_at: string
}
export interface GrainContractDelivery { id: string; farm_id: string; grain_contract_id: string; bushels: number; delivered_on: string; note: string | null; created_at: string; allow_overdelivery?: boolean; /** LD-2: set when a saved load recorded this delivery as a confirmed effect. */ grain_load_id?: string | null }
export interface GrainCapabilities { bin_movements: boolean; contract_price_finalization: boolean; contract_deliveries: boolean; /** False until the slice-3 tables exist on the live database; the screens then keep their session-only behavior. */ persisted_settings?: boolean;
  /** GL-2: false until the live database carries the crop-year eligibility rule. A merge deploys this
   * client to production on its own, while applying the migration is a separate owner action, so the
   * two are guaranteed to be out of step for a while. In that window the browser and the sweep judge a
   * bid by different rules, and both write alert_rule_states -- which re-fires or suppresses the same
   * alert over and over. While this is false the browser records no transition at all and leaves the
   * rule state entirely to the sweep, which is exactly what the pre-GL-2 sweep expects. */
  gl2_alert_eligibility?: boolean;
  /** GL-3b: false until the live database carries the contract-repair RPCs and their audit table.
   * The same merge-before-migration window as above: while this is false the Contracts tab offers no
   * Correct or Delete control at all, rather than offering one that fails on the farmer's first try. */
  contract_edit_delete?: boolean;
  /** LD-1: false until the live database carries grain_loads and its two RPCs. Same merge-before-
   * migration window: while this is false the Loads tab says the feature is arriving rather than
   * offering a form whose save cannot land. */
  grain_loads?: boolean;
  /** LD-2: false until the live database carries the effect columns and the lot-aware guards. The
   * merge-before-migration window again, and a worse one than LD-1's: the table exists, so the
   * Loads tab opens, and a farmer would tick effects the save cannot honour and be shown a
   * database error. While this is false the form offers no effects and says the rest is arriving. */
  grain_load_effects?: boolean;
  /** LD-4: false until the live database carries public.bin_lots and the save_grain_load that reads
   * it. The merge-before-migration window once more, and LD-006 finding 1 is the reason this exists
   * rather than being assumed: while this is false the form offers no lot choice and falls back to
   * the bin's baseline year, which is exactly what the installed RPC will accept. Offering a picker
   * against the old RPC would let a farmer choose a year and be refused on save. */
  grain_load_bin_lot?: boolean }

/** GL-3b: the fields a contract correction may change. An absent key keeps the stored value; an
 * explicit null clears a nullable one. Crop year, commodity, contract type and every pricing column
 * are absent by design -- they are the contract's identity and its math, and pricing on a basis or
 * HTA contract belongs to the one-shot finalization rule. A farmer who got one of those wrong
 * deletes the contract with a reason and enters it again. */
export interface GrainContractCorrection {
  buyer?: string
  bushels?: number
  delivery_start?: string | null
  delivery_end?: string | null
  contract_number?: string | null
  notes?: string | null
}

/** The one message for "the GL-3b migration is not applied yet". The screens hide the controls when
 * the capability is false, so a farmer should never see it; it exists for the window between that
 * read and a click, and for a client that loaded before the capability was known. */
/** GL-3b: what a delete did beyond removing the row. A contract created from a firm offer sends that
 * offer back to open, and the farmer has to know: the correction panel tells them to enter the
 * contract again, and doing that without refilling the offer leaves the offer counted as pending and
 * still fillable into a second contract. */
export interface ContractDeleteResult { reopenedFirmOfferId: string | null; reopenedFirmOfferStatus: string | null }

export const CONTRACT_REPAIR_PENDING = 'Correcting a contract arrives with the next database update.'

/** GL-3b: a contract with any delivery recorded against it is history, not a draft. The same test the
 * server applies under a row lock, so the screen offers a control the database will honour. */
export function contractIsCorrectable(workspace: Pick<GrainWorkspace, 'grain_contract_deliveries'>, contractId: string): boolean {
  return !workspace.grain_contract_deliveries.some((delivery) => delivery.grain_contract_id === contractId)
}

/** GL-3b: what the farmer actually changed, and nothing else. Sending every field the form holds
 * would make a buyer correction also rewrite the bushels this page loaded -- so a second member
 * correcting the buyer from a stale page silently reverses a bushels correction someone else just
 * made, and the audit would record both as deliberate. An empty result means nothing changed. */
export function contractCorrectionDiff(contract: GrainContract, draft: { buyer: string; bushels: string; delivery_start: string; delivery_end: string; contract_number: string; notes: string }): GrainContractCorrection {
  const changes: GrainContractCorrection = {}
  const bushels = Number(draft.bushels)
  if (draft.buyer.trim() !== contract.buyer) changes.buyer = draft.buyer.trim()
  if (Number.isFinite(bushels) && bushels !== contract.bushels) changes.bushels = bushels
  if ((draft.delivery_start || null) !== contract.delivery_start) changes.delivery_start = draft.delivery_start || null
  if ((draft.delivery_end || null) !== contract.delivery_end) changes.delivery_end = draft.delivery_end || null
  if ((draft.contract_number.trim() || null) !== contract.contract_number) changes.contract_number = draft.contract_number.trim() || null
  if ((draft.notes.trim() || null) !== contract.notes) changes.notes = draft.notes.trim() || null
  return changes
}

/** The reason is the farmer's own record of why the number changed, so it is required and is stored
 * verbatim. The bounds match the column's check constraint exactly. */
export function validateContractCorrectionReason(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed.length < 3) return 'Say why you are changing this contract, in at least three characters.'
  if (trimmed.length > 2000) return 'Keep the reason to 2000 characters or fewer.'
  return null
}

export interface MarketingPlanTarget extends PositionScope {
  id: string
  target_month: string
  target_pct_of_production: number
  target_price: number | null
  breakeven_relative_pct: number | null
  deadline: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface InsuranceUnit extends PositionScope {
  id: string
  unit_name: string
  insured_acres: number
  aph: number
  coverage_level_pct: number
  revenue_guarantee_per_acre: number
  guarantee_per_bu: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface GrainBin { id: string; farm_id: string; name: string; capacity_bu: number; location_type: GrainStorageLocationType; location_name: string | null; notes: string | null; moisture_pct: number | null; moisture_checked_on: string | null; created_at: string; updated_at: string }
export interface BinInventory { id: string; farm_id: string; grain_bin_id: string; crop_year: number; commodity_id: string; bushels: number; committed_bushels: number; measured_at: string; notes: string | null; created_at: string; updated_at: string }
/** Immutable record. Fixes are represented by a new movement in the other direction. */
/** LD-2: `crop_year` is the lot this movement moved. It is null on every row written before LD-2;
 * those rows are an explicit "crop year unknown" bucket that no year-specific figure may count.
 * `grain_load_id` names the load that created the row, which is how a void finds what to reverse. */
export interface BinTransaction { id: string; farm_id: string; grain_bin_id: string; direction: BinTransactionDirection; bushels: number; commodity_id: string; crop_year: number | null; occurred_on: string; note: string | null; source_kind: string | null; grain_load_id: string | null; created_at: string }
/** A farmer's bid keeps the three feed columns null; a GL-1 USDA MARS feed row sets them (display-and-history only, never position math). */
export interface CashBid { id: string; farm_id: string; elevator: string; commodity_id: string; bid_date: string; basis: number; cash_price: number | null; delivery_start: string | null; delivery_end: string | null; notes: string | null; feed_source: string | null; feed_report_id: string | null; feed_geography: string | null; created_at: string; updated_at: string }
export interface MarketingAlertRule extends PositionScope { id: string; rule_type: MarketingAlertRuleType; direction: MarketingAlertDirection | null; threshold: number | null; remind_on: string | null; message: string | null; active: boolean; last_triggered_at: string | null; created_at: string; updated_at: string }
export interface FirmOffer extends PositionScope { id: string; buyer: string; offer_type: FirmOfferType; bushels: number; price: number | null; basis: number | null; contract_month: string | null; expires_on: string | null; delivery_location: string | null; notes: string | null; status: FirmOfferStatus; filled_contract_id: string | null; created_at: string; updated_at: string }
export interface FirmOfferFill { contract: GrainContract; offer: FirmOffer }
export interface GrainAlertSettings { farm_id: string; alert_emails: string[]; updated_at: string }
/** The farmer's own planning limit for one crop-year position; null means no limit set. Never an insurance guarantee. */
export interface GrainSaleLimit extends PositionScope { id: string; sale_limit_bushels: number | null; created_at: string; updated_at: string }
export type GrainCarryMode = 'monthly' | 'flat'
export interface GrainCarrySettings { farm_id: string; mode: GrainCarryMode; monthly_rate_cents_per_bu_month: number; flat_rate_per_bu: number; interest_rate_pct: number; trucking_per_bu: number; updated_at: string }
export interface GrainCarryGridRow { market_price: number | null; basis: number | null }
/** Thirteen delivery-month rows (harvest plus twelve stored months) for one production estimate. */
export interface GrainCarryGrid { id: string; farm_id: string; production_estimate_id: string; harvest_month: number; default_basis: number; rows: GrainCarryGridRow[]; updated_at: string }

/** Mirrors public.usda_market_reports (GL-1): the verified mapping from a USDA report id to the geography it covers; verified_at null means no row is written for it yet. */
export interface UsdaMarketReport { report_id: string; name: string; geography: string; geography_label: string; verified_at: string | null; verification_note: string | null; created_at: string; updated_at: string }
/** Mirrors public.usda_report_dates in 20260711222703_module2_grain.sql. */
export interface UsdaReportDate { id: string; report_name: string; report_date: string; release_at: string | null; source_url: string | null; notes: string | null; created_at: string; updated_at: string }

export interface FuturesQuote { symbol: 'ZC' | 'ZS' | 'ZW'; contract: string; label: string; price: number; crop_year: number; new_crop: boolean; delayed: true; as_of: string }
export interface MarketDataService { getQuotes(): Promise<FuturesQuote[]> }
/** LD-1: where the grain on a truck came from. A field origin is grain coming off the combine or
 * the cart; a bin origin is grain coming out of storage. */
export type LoadOriginKind = 'bin' | 'field'
/** LD-1: where it went. `buyer` is a free-text elevator with no contract behind it. */
export type LoadDestinationKind = 'buyer' | 'contract' | 'bin'

/** LD-1: the farm's trucks, from the Equipment module, so a ticket can name a real asset instead of
 * a retyped string. Only the two fields the picker needs; Equipment owns everything else about them. */
export interface LoadTruck { id: string; name: string }

/** LD-1: a scale ticket, as the database stores it. Append-only: the only change a saved load ever
 * accepts is the one-way move into voided. */
export interface GrainLoad {
  id: string
  farm_id: string
  load_date: string
  truck_equipment_id: string | null
  truck_name: string | null
  origin_kind: LoadOriginKind
  origin_grain_bin_id: string | null
  origin_crop_assignment_id: string | null
  destination_kind: LoadDestinationKind
  destination_buyer: string | null
  destination_grain_contract_id: string | null
  destination_grain_bin_id: string | null
  commodity_id: string
  crop_year: number
  gross_lbs: number | null
  tare_lbs: number | null
  net_bushels: number
  moisture_pct: number | null
  ticket_number: string | null
  photo_path: string | null
  notes: string | null
  /** LD-2: which effects the farmer confirmed on the save that created this ticket. These are the
   * record of what the load did, which is why they are on the row and not inferred later. */
  effect_bin_out: boolean
  effect_bin_in: boolean
  effect_contract_delivery: boolean
  effect_harvest: boolean
  voided_at: string | null
  void_reason: string | null
  created_at: string
  updated_at: string
}

/** LD-1: the form's own shape. Every numeric field is the string the farmer typed, so a half-entered
 * number is never silently read as zero. An empty string means the farmer left it blank. */
export interface GrainLoadDraft {
  load_date: string
  truck_equipment_id: string
  truck_name: string
  origin_kind: LoadOriginKind
  origin_grain_bin_id: string
  origin_crop_assignment_id: string
  /** LD-4: which lot a bin origin is being hauled from. A lot is a commodity IN a crop year, so
   * both halves travel together -- a bin that held 2025 soybeans and was reused for 2025 corn has a
   * record of both, and the year alone does not say which. Empty means the farmer has not chosen,
   * which is correct and common: a bin holding one lot needs no answer. Ignored entirely for a
   * field origin, where the crop assignment already names the lot. */
  origin_crop_year: string
  origin_commodity_id: string
  destination_kind: LoadDestinationKind
  destination_buyer: string
  destination_grain_contract_id: string
  destination_grain_bin_id: string
  gross_lbs: string
  tare_lbs: string
  net_bushels: string
  moisture_pct: string
  ticket_number: string
  notes: string
  /** LD-2: the four effects, each a box the farmer ticks. Only the ones the draft's shape can
   * actually reach are ever shown; normalizeLoadEffects keeps the rest false. */
  effect_bin_out: boolean
  effect_bin_in: boolean
  effect_contract_delivery: boolean
  effect_harvest: boolean
}

/** LD-2: one later bin movement standing in the way of a void, as the server names it. */
export interface LoadVoidBlocker {
  id: string
  grain_bin_id: string
  direction: 'in' | 'out'
  bushels: number
  commodity_id: string
  crop_year: number | null
  occurred_on: string
  source_kind: string | null
}

/** LD-1: what a void did. LD-2 fills `blockedBy` with the later movements that depend on the load
 * and make the void impossible, and `reason` with the guard's own words. A blocked void changed
 * nothing at all -- not the ledger, not the delivery, not the ticket. */
export interface LoadVoidResult {
  status: 'voided' | 'blocked'
  load: GrainLoad | null
  blockedBy: LoadVoidBlocker[]
  reason: string | null
}

/** LD-1: the lot a load is carrying -- the commodity and the crop year together. Keeping them as one
 * value is the point: a load that knew its commodity but guessed its crop year would let carry-over
 * grain pay down a current-year contract, which is the defect this tranche exists to prevent. */
export interface LoadLot { commodity_id: string; crop_year: number }

export const LOAD_RECORD_PENDING = 'Recording a load arrives with the next database update.'
export const CROP_YEAR_RECONCILE_PENDING = 'Naming the crop year of older movements arrives with the next database update.'

/** LD-2: the movements that carry no crop year. They are an explicit "unknown" bucket -- no
 * year-specific figure counts them and nothing assigns them to the bin baseline's year on the
 * farmer's behalf. This is what the reconciliation list is built from. */
export function movementsWithoutCropYear(transactions: readonly BinTransaction[]): BinTransaction[] {
  return transactions.filter((row) => row.crop_year === null)
}

/** LD-2: the same 1900-2200 range the database checks, so the picker cannot offer an answer the
 * server would refuse. */
export function validateAssignedCropYear(cropYear: number): string | null {
  if (!Number.isInteger(cropYear) || cropYear < 1900 || cropYear > 2200) return 'Pick a crop year.'
  return null
}

/** LD-1: the browser's twin of the server's derivation. The origin decides the lot and nothing else
 * may; this returns null when the origin cannot name one, and the form then refuses to save rather
 * than sending a guess the server would have to reject. */
export function loadLotFor(
  workspace: Pick<GrainWorkspace, 'bin_inventory' | 'bin_transactions' | 'fields' | 'capabilities'>,
  draft: Pick<GrainLoadDraft, 'origin_kind' | 'origin_grain_bin_id' | 'origin_crop_assignment_id' | 'origin_crop_year' | 'origin_commodity_id'>,
  /** LD-4 repair: the lots the DATABASE says this bin holds, when the form has them. The workspace
   * derivation below reads a movement array PostgREST may have truncated, so where the two could
   * differ this one wins -- it is the same answer save_grain_load will reach. */
  authoritativeLots?: readonly BinLotOnHand[],
): LoadLot | null {
  if (draft.origin_kind === 'field') {
    const crop = workspace.fields.crop_assignments.find((row) => row.id === draft.origin_crop_assignment_id)
    return crop ? { commodity_id: crop.commodity_id, crop_year: crop.crop_year } : null
  }
  // LD-4, and the LD-006 finding 1 lesson applied in the other direction: until the migration is
  // applied, the installed save_grain_load still reads the baseline alone. Deriving a lot it would
  // refuse would tell the farmer a load is fine and let the server contradict it, so while the
  // capability is false this answers exactly as LD-1 did.
  if (workspace.capabilities?.grain_load_bin_lot === false) {
    const baseline = workspace.bin_inventory.find((row) => row.grain_bin_id === draft.origin_grain_bin_id)
    return baseline ? { commodity_id: baseline.commodity_id, crop_year: baseline.crop_year } : null
  }
  // LD-4: the bin's lots, not its baseline. LD-1 read bin_inventory alone here, which is why a bin
  // could only ever be hauled as its baseline's crop year and a bin with no baseline could not be
  // hauled at all. The chosen year wins when the farmer named one; otherwise a bin holding a single
  // lot answers for itself, and a bin holding several names nothing rather than guessing.
  const lots = authoritativeLots ?? binLotsOnHand(
    workspace.bin_inventory.find((row) => row.grain_bin_id === draft.origin_grain_bin_id),
    workspace.bin_transactions.filter((row) => row.grain_bin_id === draft.origin_grain_bin_id),
  )
  if (draft.origin_crop_year.trim()) {
    const chosen = lots.find((lot) => lot.crop_year === Number(draft.origin_crop_year)
      && (!draft.origin_commodity_id || lot.commodity_id === draft.origin_commodity_id))
    return chosen ? { commodity_id: chosen.commodity_id, crop_year: chosen.crop_year } : null
  }
  return lots.length === 1 ? { commodity_id: lots[0].commodity_id, crop_year: lots[0].crop_year } : null
}

/** LD-4: the lots a bin origin could be hauled from, for the picker and for the messages below. */
export function originBinLots(workspace: Pick<GrainWorkspace, 'bin_inventory' | 'bin_transactions'>, binId: string): BinLotOnHand[] {
  if (!binId) return []
  return binLotsOnHand(
    workspace.bin_inventory.find((row) => row.grain_bin_id === binId),
    workspace.bin_transactions.filter((row) => row.grain_bin_id === binId),
  )
}

/** LD-4 repair (Codex P2 on ef8a29e): every lot the bin has a RECORD of, emptied ones included --
 * the browser's twin of `public.bin_lots`, where `originBinLots` above is the twin of that function
 * filtered to what the bin still holds. Both exist because the two lists answer different
 * questions, and using one where the other belongs is the mistake this tranche kept making. */
export function recordedBinLots(workspace: Pick<GrainWorkspace, 'bin_inventory' | 'bin_transactions'>, binId: string): BinLotOnHand[] {
  if (!binId) return []
  return deriveBinLots(
    workspace.bin_inventory.find((row) => row.grain_bin_id === binId),
    workspace.bin_transactions.filter((row) => row.grain_bin_id === binId),
  ).filter((lot): lot is BinLotOnHand => lot.crop_year !== null)
}

/** LD-5: the crop years the manual bin movement form offers, and the one it may fill in unasked.
 *
 * Every hand-entered movement used to carry no crop year, so each one joined the unknown bucket
 * that LD-3's committed and free figures exclude. The form now asks, under the same rules the load
 * form's bin origin follows:
 *
 * - **Out** can only name a lot the bin still holds for this crop. `append_bin_movement` refuses to
 *   draw a lot below zero, so offering an empty year would only offer a refusal.
 * - **In** can name a lot already in the bin, a year this crop is planted in the farm's fields, or
 *   this year and last. Grain arriving is new to the bin, so its year cannot be read off the bin.
 * - The form fills a year in only when the bin holds exactly one lot of this crop -- the amendment's
 *   "defaulting only when the bin holds a single lot". Otherwise the farmer picks; nothing guesses.
 *
 * `lots` is what `public.bin_lots` returns: every recorded lot, emptied ones at zero. */
export function manualMovementCropYears(
  direction: BinTransaction['direction'],
  commodityId: string,
  lots: readonly BinLotOnHand[],
  plantedYears: readonly number[],
  thisYear: number,
): { years: number[]; defaultYear: number | null } {
  const forCrop = lots.filter((lot) => lot.commodity_id === commodityId)
  const onHand = forCrop.filter((lot) => lot.bushels > 0.000001)
  const defaultYear = onHand.length === 1 ? onHand[0]!.crop_year : null
  const candidates = direction === 'out'
    ? onHand.map((lot) => lot.crop_year)
    : [...forCrop.map((lot) => lot.crop_year), ...plantedYears, thisYear, thisYear - 1]
  const years = [...new Set(candidates)]
    .filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2200)
    .sort((a, b) => b - a)
  return { years, defaultYear }
}

/** LD-4 repair (Codex P2 on ef8a29e): the list `save_grain_load` itself resolves a draft against,
 * stated once so a stand-in for that function cannot quietly use a different one.
 *
 * The server keys on whether a year was NAMED, and on nothing else:
 *
 * - A named year is looked up among every recorded lot. That is how a ticket for grain already
 *   hauled away names the year it really was, and it is why `bin_lots` keeps emptied rows at all.
 * - An unnamed year is defaulted from what the bin still HOLDS, because a lot at zero is no answer
 *   to "which crop year is this load". The server's own default reads `bushels > 0.000001`.
 *
 * `MockGrainRepository.saveLoad` stands in for that function and passed NEITHER list, so both
 * `validateGrainLoad` and `loadLotFor` fell through to `binLotsOnHand` -- on-hand for both cases.
 * A ticket-only load naming an emptied lot was therefore refused by the mock while production
 * accepted it, which meant the path two earlier repairs had opened could not be covered by any
 * mock-backed test. The form's own list is deliberately wider than this for DISPLAY, and closes
 * the gap by always naming the year it showed; this is the server's rule, not the form's. */
export function lotsSaveResolvesAgainst(
  recordedLots: readonly BinLotOnHand[],
  draft: Pick<GrainLoadDraft, 'origin_crop_year'>,
): readonly BinLotOnHand[] {
  return draft.origin_crop_year.trim()
    ? recordedLots
    : recordedLots.filter((lot) => lot.bushels > 0.000001)
}

/** LD-1: a load that has been voided still shows on the ledger, and still must not count toward
 * anything. Every figure derived from loads reads through this. */
export function activeLoads(loads: readonly GrainLoad[]): GrainLoad[] {
  return loads.filter((load) => load.voided_at === null)
}

/** LD-1: the same 3-to-2000-character rule the database applies to a void reason. */
export function validateLoadVoidReason(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed.length < 3) return 'Say why this ticket is being voided.'
  if (trimmed.length > 2000) return 'That reason is too long.'
  return null
}

/** LD-1: everything the form can tell the farmer before the network is involved. The server checks
 * all of it again under a row lock -- this exists so a farmer in a truck with one bar of signal is
 * told what is wrong immediately, not after a round trip. */
export function validateGrainLoadShape(draft: GrainLoadDraft): string[] {
  const problems: string[] = []
  if (!draft.load_date) problems.push('Pick the date this load was hauled.')

  const net = Number(draft.net_bushels)
  if (!draft.net_bushels.trim() || !Number.isFinite(net) || net <= 0) problems.push('Net bushels must be more than zero.')

  const gross = draft.gross_lbs.trim() ? Number(draft.gross_lbs) : null
  const tare = draft.tare_lbs.trim() ? Number(draft.tare_lbs) : null
  if (gross !== null && (!Number.isFinite(gross) || gross <= 0)) problems.push('Gross weight must be more than zero.')
  if (tare !== null && (!Number.isFinite(tare) || tare <= 0)) problems.push('Tare weight must be more than zero.')
  if (gross !== null && tare !== null && Number.isFinite(gross) && Number.isFinite(tare) && gross <= tare) {
    problems.push('The loaded truck has to weigh more than the empty one.')
  }

  if (draft.moisture_pct.trim()) {
    const moisture = Number(draft.moisture_pct)
    if (!Number.isFinite(moisture) || moisture < 0 || moisture > 100) problems.push('Moisture must be between 0 and 100 percent.')
  }

  if (draft.truck_equipment_id && draft.truck_name.trim()) problems.push('Name the truck or pick one from equipment, not both.')

  if (draft.origin_kind === 'field' && !draft.origin_crop_assignment_id) problems.push('Pick the field crop this load came from.')
  if (draft.origin_kind === 'bin' && !draft.origin_grain_bin_id) problems.push('Pick the bin this load came from.')

  if (draft.destination_kind === 'buyer' && !draft.destination_buyer.trim()) problems.push('Name the buyer or elevator this load went to.')
  if (draft.destination_kind === 'bin' && !draft.destination_grain_bin_id) problems.push('Pick the bin this load went into.')
  if (draft.destination_kind === 'contract' && !draft.destination_grain_contract_id) problems.push('Pick the contract this load went against.')

  if (draft.origin_kind === 'bin' && draft.destination_kind === 'bin'
      && draft.origin_grain_bin_id && draft.origin_grain_bin_id === draft.destination_grain_bin_id) {
    problems.push('A load cannot go from a bin back into the same bin.')
  }

  return problems
}

/** LD-1: the shape rules plus everything the loaded workspace can settle -- which lot the origin
 * names, and whether a chosen contract is for that lot. The screen calls this; the repository calls
 * the shape half only, because it does not hold a workspace and the server settles the rest under a
 * row lock anyway. */
export function validateGrainLoad(
  draft: GrainLoadDraft,
  workspace: Pick<GrainWorkspace, 'bin_inventory' | 'bin_transactions' | 'fields' | 'grain_contracts' | 'capabilities'>,
  authoritativeLots?: readonly BinLotOnHand[],
): string[] {
  const problems = validateGrainLoadShape(draft)

  const lot = loadLotFor(workspace, draft, authoritativeLots)
  if ((draft.origin_kind === 'field' && draft.origin_crop_assignment_id) || (draft.origin_kind === 'bin' && draft.origin_grain_bin_id)) {
    if (!lot) {
      // LD-4: three different reasons a bin cannot name a lot, and the farmer needs the right one.
      // "Set the bin inventory first" was LD-1's only answer and is now wrong for two of the three.
      if (draft.origin_kind === 'bin') {
        if (workspace.capabilities?.grain_load_bin_lot === false) {
          problems.push('That bin has no recorded crop yet, so Farm Rx cannot tell which crop year this load is. Set the bin inventory first.')
          return problems
        }
        const lots = authoritativeLots ?? originBinLots(workspace, draft.origin_grain_bin_id)
        if (lots.length === 0) {
          problems.push('That bin holds no crop with a crop year, so Farm Rx cannot tell which crop year this load is.')
        } else if (draft.origin_crop_year.trim()) {
          problems.push('That bin does not hold the ' + draft.origin_crop_year.trim() + ' crop.')
        } else {
          problems.push('That bin holds more than one crop year. Pick which one this load came from.')
        }
      } else {
        problems.push('That field crop is no longer on this farm.')
      }
    }
  }

  if (draft.destination_kind === 'contract') {
    if (draft.destination_grain_contract_id && lot) {
      const contract = workspace.grain_contracts.find((row) => row.id === draft.destination_grain_contract_id)
      if (!contract) {
        problems.push('That contract is no longer on this farm.')
      } else if (contract.commodity_id !== lot.commodity_id) {
        problems.push('That contract is for a different crop than this load.')
      } else if (contract.crop_year !== lot.crop_year) {
        // Carry-over grain paying down a current-year contract is the defect LD-1 exists to stop.
        problems.push('That contract is for the ' + contract.crop_year + ' crop, and this load is the ' + lot.crop_year + ' crop.')
      }
    }
  }

  // An effect the shape cannot reach is not an error the farmer has to fix -- it is a preference
  // that does not apply to this load, and normalizeLoadEffects drops it from what is sent.

  return problems
}

/** LD-2: the four effects a saved load can have. Each is a separate visible write the farmer
 * confirmed on that save; nothing here ever happens silently. */
export type LoadEffectKey = 'bin_out' | 'bin_in' | 'contract_delivery' | 'harvest'

export const LOAD_EFFECT_KEYS: readonly LoadEffectKey[] = ['bin_out', 'bin_in', 'contract_delivery', 'harvest']

/** LD-2: which effects this draft's shape can actually reach. A load to a buyer cannot record a
 * contract delivery, and a load out of a bin cannot count toward a field's harvest. The database
 * carries the same four rules as check constraints; this is what keeps the form from ever offering
 * a box that could not be honoured. */
export function loadEffectsAvailable(draft: Pick<GrainLoadDraft, 'origin_kind' | 'destination_kind'>): LoadEffectKey[] {
  const available: LoadEffectKey[] = []
  if (draft.origin_kind === 'bin') available.push('bin_out')
  if (draft.destination_kind === 'bin') available.push('bin_in')
  if (draft.destination_kind === 'contract') available.push('contract_delivery')
  if (draft.origin_kind === 'field') available.push('harvest')
  return available
}

export function loadEffectFlag(key: LoadEffectKey): 'effect_bin_out' | 'effect_bin_in' | 'effect_contract_delivery' | 'effect_harvest' {
  if (key === 'bin_out') return 'effect_bin_out'
  if (key === 'bin_in') return 'effect_bin_in'
  if (key === 'contract_delivery') return 'effect_contract_delivery'
  return 'effect_harvest'
}

/** LD-2: the effects this draft will ACTUALLY perform -- the farmer's preference for each one,
 * narrowed to what the load's shape can reach.
 *
 * The flags on the draft are a preference, not a promise: they survive a change of origin or
 * destination so that a box the farmer never touched keeps its default, and a box they deliberately
 * unticked stays unticked if they come back to it. Clearing them as the shape changed looked tidier
 * and was wrong -- picking a bin cleared the contract-delivery default long before the farmer chose
 * a contract destination, so the box they were promised would be ticked appeared unticked. A browser
 * journey caught it. Narrowing happens here, at the one point that matters: what is sent. */
export function normalizeLoadEffects(draft: GrainLoadDraft): GrainLoadDraft {
  const available = loadEffectsAvailable(draft)
  let next = draft
  for (const key of LOAD_EFFECT_KEYS) {
    const flag = loadEffectFlag(key)
    if (!available.includes(key) && next[flag]) next = { ...next, [flag]: false }
  }
  return next
}

/** LD-2: the effects this draft is actually asking for, in a stable order. The form shows this back
 * to the farmer in words, so what is about to happen is on screen before the button is pressed. */
export function confirmedLoadEffects(draft: GrainLoadDraft): LoadEffectKey[] {
  return loadEffectsAvailable(draft).filter((key) => draft[loadEffectFlag(key)])
}

/** LD-2: the bushels a crop assignment has from loads. This is the ONLY record of a load's harvest
 * contribution: crop_assignments.harvested_bushels is one replaceable total that the Harvest form
 * overwrites whole, so a load increment would be erased by the next manual entry or double-counted
 * by it. Voided loads drop out here and nowhere else. */
export function harvestBushelsFromLoads(loads: readonly GrainLoad[], cropAssignmentId: string): number {
  return activeLoads(loads)
    .filter((load) => load.effect_harvest && load.origin_crop_assignment_id === cropAssignmentId)
    .reduce((total, load) => total + load.net_bushels, 0)
}

/** LD-2: what Harvest and Fields show beside the manual total. `difference` is present only when
 * both figures exist, because a difference against nothing is not a difference. */
export interface LoadHarvestComparison {
  fromLoads: number
  loadCount: number
  manual: number | null
  difference: number | null
}

export function loadHarvestComparison(
  loads: readonly GrainLoad[],
  cropAssignmentId: string,
  manual: number | null,
): LoadHarvestComparison {
  const contributing = activeLoads(loads)
    .filter((load) => load.effect_harvest && load.origin_crop_assignment_id === cropAssignmentId)
  const fromLoads = contributing.reduce((total, load) => total + load.net_bushels, 0)
  return {
    fromLoads,
    loadCount: contributing.length,
    manual,
    difference: manual === null || contributing.length === 0 ? null : fromLoads - manual,
  }
}

export interface GrainData { production_estimates: ProductionEstimate[]; grain_contracts: GrainContract[]; grain_contract_deliveries: GrainContractDelivery[]; grain_loads: GrainLoad[]; marketing_plan_targets: MarketingPlanTarget[]; insurance_units: InsuranceUnit[]; grain_bins: GrainBin[]; bin_inventory: BinInventory[]; bin_transactions: BinTransaction[]; cash_bids: CashBid[]; usda_report_dates: UsdaReportDate[]; usda_market_reports: UsdaMarketReport[]; marketing_alert_rules: MarketingAlertRule[]; firm_offers: FirmOffer[]; grain_alert_settings: GrainAlertSettings | null; grain_sale_limits: GrainSaleLimit[]; grain_carry_settings: GrainCarrySettings | null; grain_carry_grids: GrainCarryGrid[]; capabilities?: GrainCapabilities }
export interface GrainWorkspace extends GrainData { fields: FieldsData }
export interface GrainRepository {
  getData(): Promise<GrainWorkspace>
  /** Pure read for projections such as Today: consumes an already-published context and performs no access resolution, queue
   * replay, due generation, or cache write; private financial rows behind `can_read_private_financials` as the database returns them. */
  getSnapshot?(context: FarmOperationContext): Promise<ReadOnlySnapshot<GrainWorkspace>>
  getNeedsAttentionQueueKey?(): Promise<string>
  saveProductionEstimate(estimate: ProductionEstimate): Promise<void>
  reconcileHarvestActual(estimate: ProductionEstimate, harvestActual: number): Promise<void>
  saveContract(contract: GrainContract): Promise<void>
  finalizeContractPriceLeg(contractId: string, leg: 'futures_price' | 'basis', value: number): Promise<void>
  editContract(contractId: string, reason: string, changes: GrainContractCorrection, expectedUpdatedAt: string, operationId: string): Promise<GrainContract>
  deleteContract(contractId: string, reason: string, expectedUpdatedAt: string, operationId: string): Promise<ContractDeleteResult>
  /** LD-1: one saved ticket per id. A retry after a lost response replays rather than writing a
   * second load, so the caller keeps one id for one ticket across every attempt. */
  /** LD-1: the farm's trucks, read only when the Loads form is open. Deliberately NOT part of the
   * grain workspace: Today serves its front door from the same workspace load, and a named rep's
   * Today must make no equipment read at all. */
  listLoadTrucks(): Promise<LoadTruck[]>
  /** LD-4 repair: what one bin holds, by crop year, as the database sees it. Null means the answer
   * is not available -- offline, or the migration is not applied -- and the caller must fall back
   * to the workspace derivation rather than treat an empty list as "this bin holds nothing". */
  listBinLots(binId: string): Promise<BinLotOnHand[] | null>
  /** LD-2: the loads that carry a harvest contribution, for the derived "from loads" figure on
   * Harvest and Fields. Read for the same reason listLoadTrucks is and kept out of the workspace for
   * the same reason: a scale ticket is private financial data, and Harvest is a screen a worker
   * without financial access uses every day. The caller asks for this ONLY when that member can read
   * private financials, so a worker's Harvest makes no load read at all. */
  /** `complete` is false when the farm has more contributing tickets than one read returns. The
   * figure is a SUM, so a capped read would understate it silently and "Use load total" would
   * overwrite a typed harvest with a partial total. The screens say "at least" and withhold that
   * action instead. */
  listHarvestLoads(): Promise<{ loads: GrainLoad[]; complete: boolean }>
  /** LD-2: name the crop year of a bin movement written before crop years existed. Owner or manager
   * only, one-way, and refused by the server when the answer would leave that year short. */
  assignBinMovementCropYear(transactionId: string, cropYear: number): Promise<BinTransaction>
  saveLoad(id: string, draft: GrainLoadDraft): Promise<GrainLoad>
  voidLoad(loadId: string, reason: string): Promise<LoadVoidResult>
  recordContractDelivery(delivery: GrainContractDelivery): Promise<void>
  saveMarketingPlanTarget(target: MarketingPlanTarget): Promise<void>
  replaceMarketingPlanTargets(scope: PositionScope, targets: MarketingPlanTarget[]): Promise<void>
  saveCashBid(bid: CashBid): Promise<void>
  saveMarketingAlertRule(rule: MarketingAlertRule): Promise<void>
  deleteMarketingAlertRule(id: string): Promise<void>
  saveFirmOffer(offer: FirmOffer): Promise<void>
  fillFirmOffer(offer: FirmOffer, contract: GrainContract): Promise<FirmOfferFill>
  deleteFirmOffer(id: string): Promise<void>
  upsertGrainBin(bin: GrainBin): Promise<void>
  appendBinTransaction(transaction: BinTransaction): Promise<void>
  saveGrainAlertSettings(settings: GrainAlertSettings): Promise<void>
  /** These three return the saved row so the screen can adopt the server's updated_at without a full workspace reload. */
  saveGrainSaleLimit(limit: GrainSaleLimit): Promise<GrainSaleLimit>
  saveGrainCarrySettings(settings: GrainCarrySettings): Promise<GrainCarrySettings>
  saveGrainCarryGrid(grid: GrainCarryGrid): Promise<GrainCarryGrid>
}
export interface GrainServices { grainRepository: GrainRepository; marketDataService: MarketDataService; profitabilityRepository: ProfitabilityRepository; createGrainId: () => string }
export interface GrainContext { commodity: Commodity; data: GrainWorkspace }

const finite = (value: number | null) => value === null || Number.isFinite(value)
export function validateGrainContract(contract: GrainContract, commodityIds: Set<string>): string[] {
  const errors: string[] = []
  if (!Number.isInteger(contract.crop_year) || contract.crop_year < 1900 || contract.crop_year > 2200) errors.push('Crop year must be between 1900 and 2200.')
  if (!commodityIds.has(contract.commodity_id)) errors.push('Choose a valid commodity.')
  if (!Object.values<GrainContractType>({ cash_spot: 'cash_spot', forward_cash: 'forward_cash', basis: 'basis', hta: 'hta' }).includes(contract.contract_type)) errors.push('Choose a valid contract type.')
  if (contract.buyer.trim().length < 1 || contract.buyer.trim().length > 200) errors.push('Buyer is required and must be 200 characters or fewer.')
  if (!Number.isFinite(contract.bushels) || contract.bushels <= 0) errors.push('Bushels must be greater than zero.')
  if (!finite(contract.cash_price) || !finite(contract.futures_price) || !finite(contract.basis) || (contract.cash_price !== null && contract.cash_price < 0) || (contract.futures_price !== null && contract.futures_price < 0)) errors.push('Prices and basis must be finite; cash and futures prices cannot be negative.')
  if (!Number.isFinite(contract.premium_cents_per_bu) || contract.premium_cents_per_bu < 0) errors.push('Premium must be a finite value of zero or more cents per bushel.')
  if (contract.delivery_start && contract.delivery_end && contract.delivery_end < contract.delivery_start) errors.push('Delivery end must be on or after delivery start.')
  if ((contract.contract_type === 'cash_spot' || contract.contract_type === 'forward_cash') && contract.cash_price === null) errors.push('Cash and forward cash contracts require a cash price.')
  if (contract.contract_type === 'basis' && contract.basis === null) errors.push('Basis contracts require a basis.')
  if (contract.contract_type === 'hta' && contract.futures_price === null) errors.push('HTA contracts require a futures price.')
  return errors
}

export function activeProductionForScope(workspace: GrainWorkspace, scope: PositionScope): number {
  const estimate = workspace.production_estimates.find((item) => sameScope(item, scope))
  if (!estimate) return 0
  return estimate.drives_math === 'actual' && estimate.actual_bushels !== null ? estimate.actual_bushels : estimate.expected_bushels
}

/** The newest crop year's estimate: where a Today grain-delivery intent lands and the position Today's grain line summarizes (the
 * repository sorts estimates oldest first, which is right for planning but wrong for work being recorded now); between estimates
 * of the same year the first stays. */
export function deliveryDefaultEstimate<T extends { crop_year: number }>(estimates: readonly T[]): T | undefined {
  return estimates.reduce<T | undefined>((newest, estimate) => (!newest || estimate.crop_year > newest.crop_year ? estimate : newest), undefined)
}

/** The calendar month (1-12) the marketing plan is judged against: the farm's current day in its stored time zone, the same day
 * Today places, so the Overview and the grain line count the same targets on either side of a month boundary wherever the
 * device happens to be. */
export function planMonthFor(now: Date, timeZone: string | null | undefined): number {
  return Number(farmCalendarDate(now, timeZone).slice(5, 7))
}

/** The marketing plan's cumulative target through a calendar month (1-12), as the Overview's plan status accumulates it: every
 * target whose month number is at or before the given month counts, whatever year its date carries. Today's grain line and the
 * Overview share this rule so the two screens report the same planned percent. */
export function plannedPercentThroughMonth(targets: readonly { target_month: string; target_pct_of_production: number }[], month: number): number {
  return targets.filter((target) => Number(target.target_month.slice(5, 7)) <= month).reduce((total, target) => total + target.target_pct_of_production, 0)
}

/** Shared by the marketing plan and alert rules: signed contract bushels / active production. */
export function marketedPercent(workspace: GrainWorkspace, scope: PositionScope): number {
  const production = activeProductionForScope(workspace, scope)
  if (!production) return 0
  return workspace.grain_contracts.filter((item) => sameScope(item, scope)).reduce((sum, item) => sum + item.bushels, 0) / production * 100
}
