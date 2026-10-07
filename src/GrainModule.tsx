import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { parseTodayRecordIntent, parseTodayGrainLineIntent } from "./data/todayIntents";
import { NeedsAttentionList } from "./components/NeedsAttentionList";
import { SaveReceipt } from "./components/SaveReceipt";
import { MarketQuoteSection, quoteCropYear } from "./components/MarketQuote";
import { confirmDialog, promptDialog } from "./components/ConfirmDialog";
import { SectionTabs } from "./SectionTabs";
import { farmerError, isOverdeliveryRefusal } from "./lib/farmerErrors";
import { isTransportFailure } from "./data/QueuedFieldsRepository";
import { currentFarmContext } from "./auth/farmContext";
import { beginPendingSettingsWork, registerPendingSettingsFlush, SETTINGS_CONTEXT_CHANGED } from "./data/pendingSettingsWork";
import { clearSettingsDraft, readSettingsDrafts, writeSettingsDraft, type SettingsDraftScope } from "./data/settingsDrafts";
import { quarantineTiedSettingsDrafts } from "./data/revokedFarmRecovery";
import { supabaseConfig } from "./lib/supabaseConfig";
import { getModuleSyncStatus, subscribeSyncStatus } from "./data/syncStatus";
import { useOptionalFarmAccess } from "./auth/FarmAccessContext";
import { canEditFarmModule } from "./auth/farmContext";
import { normalizeGrainSaleLimit, stableGrainSaleLimitId } from "./data/grainSettings";
// `base` is the row the editing session started from (the version the commit sends, so a row changed elsewhere conflicts);
// `sent` is the last value this browser saved for the scope, kept so a replayed row of this browser's own is recognised.
type SaleLimitDraft = { key: string; value: number | null; base: { id: string; updated_at: string } | null; sent?: number | null };
// A kept draft is used only when its shape is the one this page writes; anything else (an older release, a damaged entry) is dropped.
const isSaleLimitDraft = (key: string, payload: unknown): payload is SaleLimitDraft => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const draft = payload as Record<string, unknown>;
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
  const base = draft.base as Record<string, unknown> | null | undefined;
  return draft.key === key.slice("sale-limit:".length) && (draft.value === null || finite(draft.value)) && (base === null || (!!base && typeof base === "object" && typeof base.id === "string" && typeof base.updated_at === "string")) && (draft.sent === undefined || draft.sent === null || finite(draft.sent));
};
import { getSaveReceipt, setSaveReceipt, useSaveReceipt } from "./lib/saveReceipt";
import { createSubmitLock, createSubmitLockMap } from "./lib/submitLock";
import type { BinInventory, BinTransaction, FirmOffer, FirmOfferStatus, FirmOfferType, GrainAlertSettings, GrainBin, GrainCarryGrid, GrainCarrySettings, GrainContract, GrainContractDelivery, GrainContractType, GrainLoad, GrainLoadDraft, GrainServices, GrainWorkspace, LoadTruck, MarketingAlertRule, MarketingAlertRuleType, MarketingPlanTarget, PositionScope, ProductionEstimate } from "./data/grain";
import { contractUndeliveredBushels, deriveCommittedFree, deriveCommittedFreeLot, deriveUnknownCropYearBushels } from "./data/committedFree";
import type { BinLotOnHand } from "./data/committedFree";
import { formatFarmDate } from "./lib/farmDate";
import { confirmedLoadEffects, contractCorrectionDiff, contractIsCorrectable, contractIsDeletable, loadEffectsAvailable, loadLotFor, manualMovementCropYears, originBinLots, recordedBinLots, LOAD_RECORD_PENDING, marketedPercent, movementsWithoutCropYear, validateAssignedCropYear, sameScope, scopeKey, scopeOf, deliveryDefaultEstimate, planDateFor, plannedPercentThroughDate, harvestBushelsFromLoads, validateContractCorrectionReason, validateGrainContract, validateGrainLoad, validateLoadVoidReason, MARKETING_PLAN_PERCENT_TOLERANCE, activeLoads, basisCentsPrompt, basisLooksLikeCents, loadDateInFutureProblem, netBushelsFromWeights, normalizeLoadEffects, STANDARD_BUSHEL_LBS } from "./data/grain";
import {
  captureGrainAlertOperationContext,
  evaluateGrainAlerts,
  mayRecordAlertTransitions,
  recordMarketingAlertTransitions,
  requestOwnerAlertDelivery,
  verifyGrainAlertOperationContext,
  type GrainAlert,
} from "./data/grainAlerts";
import {
  evaluateMarketingAlertRules,
  ruleSentence,
} from "./data/marketingAlerts";
import { localCalendarDay } from "./data/marketingAlerts";
import { farmCalendarDate, farmLocalCalendarDate } from "./data/farmDates";
import {
  deriveBinPosition,
  activeBinCommodityIds,
  deriveCommodityBinTotal,
  isBinTransactionSuperseded,
  moistureStatus,
  safeStorageMoisture,
  validateBinTransaction,
  validateGrainBin,
} from "./data/binLedger";
import { knownCounterparties, isMarsBid, latestBasis, marsBidLabel } from "./data/basisMath";
import { GrainCostOfCarry } from "./GrainCostOfCarry";
import {
  displayFirmOfferStatus,
  offerToContract,
  pendingFirmOfferBushels,
  validateFirmOffer,
} from "./data/firmOffers";
import { hasCompleteRevenueProtection } from "./data/insuranceMath";
import {
  calculateGrainPosition,
  finalCashPrice,
  hasUnsupportedSavedCoverage,
  remainingMarketingCapacity,
  saleLimitForScope,
  saleLimitWarning,
  unsupportedCoverageMessage,
} from "./data/grainPosition";
import { fillFirmOfferFallback, firmOfferContractId } from "./data/firmOfferFill";
import { bidDate, latestAlertEligibleCashBid, marketedPercentLabel, validateMarketingAlertRule } from "./data/marketingAlerts";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/** Grain is priced to the quarter cent ($4.1275), so a price shown to the farmer keeps up to four
 * decimals instead of rounding away part of the contract price. */
export const pricePerBu = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const bushels = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const preciseBushels = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const displayBushels = (value: number) => Number.isInteger(value) ? bushels.format(value) : preciseBushels.format(value);
export const HARVEST_RECONCILIATION_SCOPE_SUPPRESSION_COPY = "Harvest-minus-bins is not shown because bins cover the whole farm and all years.";

/** Pure view data so every ledger label uses the same baseline supersession rule as bin math. */
export function buildBinLedgerRow(inventory: BinInventory | undefined, item: BinTransaction) {
  return { label: `${item.direction === "in" ? "In" : "Out"} · ${displayBushels(item.bushels)} bu`, superseded: isBinTransactionSuperseded(inventory, item) };
}

/** Where a bin movement came from, in words rather than the stored code. */
export const movementSourceLabel = (kind: string | null | undefined) =>
  kind === "grain_load" ? "From a load ticket"
    : kind === "grain_load_void" ? "Undone by a voided load ticket"
    : !kind || /^manual/i.test(kind) ? "Entered by hand"
    // Any other code is shown as words rather than hidden behind "Other".
    : kind.replace(/[_-]+/g, " ").trim().replace(/^\w/, (letter) => letter.toUpperCase());

/** Keeps the harvest-total action from accidentally saving a stale text-input value. */
export function buildProductionSaveInput(estimate: ProductionEstimate, aphValue: string, actualValue: string, drives_math = estimate.drives_math, actualOverride?: number): ProductionEstimate {
  return { ...estimate, aph_yield: Number(aphValue), actual_bushels: actualOverride ?? (actualValue.trim() === "" ? null : Number(actualValue)), drives_math };
}

/** Harvest reconciliation changes only the persisted Grain actual and its math basis. */
export function buildHarvestReconciliationInput(estimate: ProductionEstimate, harvestActual: number): ProductionEstimate {
  return { ...estimate, actual_bushels: harvestActual, drives_math: "actual" };
}

/** A bin with active lots may only offer those commodities; an empty bin offers every commodity. */
export function movementCommodityOptions<T extends { id: string }>(commodities: T[], inventory: BinInventory | undefined, transactions: BinTransaction[]) {
  const activeCommodityIds = activeBinCommodityIds(inventory, transactions);
  return activeCommodityIds.length ? commodities.filter((item) => activeCommodityIds.includes(item.id)) : commodities;
}
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const contractLabels: Record<GrainContractType, string> = {
  cash_spot: "Cash / spot",
  forward_cash: "Forward cash",
  basis: "Basis",
  hta: "HTA",
};
// The everyday pages come first, so on a laptop they fit without scrolling the tab strip and on a phone
// they sit on the first row of pills. Slugs (and so links and bookmarks) are unchanged.
const GRAIN_TABS = [
  { slug: "", label: "Overview" },
  { slug: "contracts", label: "Contracts" },
  { slug: "loads", label: "Loads" },
  { slug: "storage", label: "Bins & basis" },
  { slug: "plan", label: "Plan" },
  { slug: "offers", label: "Firm offers" },
  { slug: "alerts", label: "Alerts" },
  { slug: "carry", label: "Storage cost" },
];
/** "Oct 2026" from any ISO date or month ("2026-10-01", "2026-10"). */
const monthLabel = (date: string) => `${months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
/** LD-2: the one-time list of bin movements written before crop years existed.
 *
 * Those rows are an explicit "crop year unknown" bucket. No year-specific figure counts them and
 * nothing assigns them to the bin's baseline year on the farmer's behalf, because a wrong guess
 * there would put carry-over bushels into the current year's free-and-committed maths. This is the
 * only way to name them, it can be done once per movement, and the server refuses a year that would
 * leave that lot short. The whole section disappears once every movement has a year, which is why
 * it lives here rather than behind a settings menu nobody opens. */
function CropYearReconciliation({ workspace, services, canManageFarm, onSaved }: { workspace: GrainWorkspace; services: GrainServices; canManageFarm: boolean; onSaved: () => Promise<void> }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const unknown = movementsWithoutCropYear(workspace.bin_transactions);
  // The RPC behind this arrives with the same migration as the crop_year column itself.
  if (unknown.length === 0 || !canManageFarm || workspace.capabilities?.grain_load_effects === false) return null;
  const binName = (id: string) => workspace.grain_bins.find((bin) => bin.id === id)?.name ?? "a bin";
  const commodityLabel = (id: string) => workspace.fields.commodities.find((item) => item.id === id)?.name ?? id;
  const thisYear = new Date().getFullYear();
  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
  const assign = async (transactionId: string) => {
    const chosen = Number(picked[transactionId]);
    const problem = validateAssignedCropYear(chosen);
    if (problem) { setMessage(problem); return }
    setBusyId(transactionId);
    setMessage(null);
    try {
      await services.grainRepository.assignBinMovementCropYear(transactionId, chosen);
      await onSaved();
    } catch (error) {
      setMessage(farmerError(error, "name the crop year for this movement"));
    } finally { setBusyId(null) }
  };
  return (
    <section className="grain-section crop-year-reconcile">
      <div className="section-heading"><div><span className="eyebrow">Older movements</span><h2>Which crop year were these?</h2></div></div>
      <p>
        {unknown.length === 1 ? "One bin movement was" : `${unknown.length} bin movements were`} recorded before Farm Rx
        kept track of crop years. Until you say which year each one was, {unknown.length === 1 ? "it stays" : "they stay"} out
        of every committed and free bushel figure &mdash; Farm Rx will not guess between carry-over and this year&rsquo;s crop.
      </p>
      {message && <p className="load-message" role="status">{message}</p>}
      <table className="load-table">
        <thead><tr><th>Date</th><th>Bin</th><th>Crop</th><th>Movement</th><th>Crop year</th><th /></tr></thead>
        <tbody>
          {unknown.map((movement) => (
            <tr key={movement.id}>
              <td>{movement.occurred_on}</td>
              <td>{binName(movement.grain_bin_id)}</td>
              <td>{commodityLabel(movement.commodity_id)}</td>
              <td>{movement.direction === "in" ? "In" : "Out"} {movement.bushels.toLocaleString()} bu</td>
              <td>
                {/* aria-label rather than a hidden label: the repo's `sr-only` class is used in
                    places but is not defined in any stylesheet, so text relying on it is visible. */}
                <select aria-label={`Crop year for the ${movement.occurred_on} movement`} value={picked[movement.id] ?? ""} onChange={(event) => setPicked((current) => ({ ...current, [movement.id]: event.target.value }))}>
                  <option value="">Pick a year</option>
                  {years.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </td>
              <td>
                <button className="text-action" type="button" disabled={busyId !== null || !picked[movement.id]} onClick={() => void assign(movement.id)}>
                  {busyId === movement.id ? "Saving\u2026" : "Save year"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="panel-note">A crop year can be named only once. If you pick the wrong one, fix it with new bin movements.</p>
    </section>
  );
}

/** LD-1: a blank ticket. Dated today because that is what a farmer hauling right now needs, and a bin
 * origin because grain leaving storage is the load a farm records year-round.
 *
 * LD-2: the four effects start ticked. Recording a load out of a bin normally does take the grain
 * out of the bin, so the common case should not need four taps in a truck cab -- and the form shows
 * in plain words what the ticked boxes will do before the save. Unticking is the exception, which is
 * why unticking is what takes the deliberate action. normalizeLoadEffects clears whichever of them
 * the chosen origin and destination cannot reach. */
const emptyLoadDraft = (): GrainLoadDraft => ({
  load_date: localCalendarDay(new Date()),
  truck_equipment_id: "",
  truck_name: "",
  origin_kind: "bin",
  origin_grain_bin_id: "",
  origin_crop_assignment_id: "",
  origin_crop_year: "",
  origin_commodity_id: "",
  destination_kind: "buyer",
  destination_buyer: "",
  destination_grain_contract_id: "",
  destination_grain_bin_id: "",
  gross_lbs: "",
  tare_lbs: "",
  net_bushels: "",
  moisture_pct: "",
  ticket_number: "",
  notes: "",
  effect_bin_out: true,
  effect_bin_in: true,
  effect_contract_delivery: true,
  effect_harvest: true,
});
type Template =
  "balanced" | "harvest" | "storage" | "conservative" | "seasonal";
const templates: Record<
  Template,
  {
    name: string;
    description: string;
    total: number;
    schedule: Array<[number, number]>;
  }
> = {
  balanced: {
    name: "Balanced Seller",
    description: "Plan to sell 60%; keep 40% flexible.",
    total: 60,
    schedule: [
      [3, 10],
      [5, 10],
      [7, 10],
      [9, 15],
      [11, 15],
    ],
  },
  harvest: {
    name: "Harvest Heavy",
    description: "Plan to sell 65%; keep 35% flexible.",
    total: 65,
    schedule: [
      [6, 8],
      [8, 12],
      [9, 25],
      [10, 20],
    ],
  },
  storage: {
    name: "Storage Heavy",
    description: "Plan to sell 70%; keep 30% flexible.",
    total: 70,
    schedule: [
      [5, 10],
      [8, 10],
      [11, 10],
      [1, 20],
      [3, 20],
    ],
  },
  conservative: {
    name: "Conservative Pre-Harvest",
    description: "Plan to sell 55%; keep 45% flexible.",
    total: 55,
    schedule: [
      [2, 10],
      [4, 15],
      [6, 15],
      [8, 15],
    ],
  },
  seasonal: {
    name: "Seasonal Seller",
    description: "Plan to sell 60%; keep 40% flexible.",
    total: 60,
    schedule: [
      [2, 10],
      [4, 15],
      [6, 15],
      [7, 10],
      [10, 10],
    ],
  },
};

function manualPlannedPrice(workspace: GrainWorkspace, scope: PositionScope) {
  const targets = scopeRows(workspace.marketing_plan_targets, scope).filter(
    (target): target is MarketingPlanTarget & { target_price: number } =>
      target.target_price !== null,
  );
  const weightedBushels = targets.reduce(
    (sum, target) => sum + target.target_pct_of_production,
    0,
  );
  return weightedBushels
    ? targets.reduce(
        (sum, target) =>
          sum + target.target_price * target.target_pct_of_production,
        0,
      ) / weightedBushels
    : null;
}
function activeProduction(estimate: ProductionEstimate) {
  return estimate.drives_math === "actual" && estimate.actual_bushels !== null
    ? estimate.actual_bushels
    : estimate.expected_bushels;
}
function scopeRows<T extends PositionScope>(rows: T[], scope: PositionScope) {
  return rows.filter((row) => sameScope(row, scope));
}
export { deliveryDefaultEstimate } from "./data/grain";
function scopeLabel(workspace: GrainWorkspace, scope: PositionScope) {
  const commodity =
    workspace.fields.commodities.find((item) => item.id === scope.commodity_id)
      ?.name ?? scope.commodity_id;
  const entity =
    scope.enterprise_label ??
    workspace.fields.entities.find(
      (item) => item.id === scope.operating_entity_id,
    )?.name ??
    "whole farm";
  return `${scope.crop_year} ${commodity} — ${entity}`;
}
function binPosition(workspace: GrainWorkspace, bin: GrainBin) {
  const inventory = workspace.bin_inventory.find(
    (item) => item.grain_bin_id === bin.id,
  );
  const transactions = workspace.bin_transactions.filter(
    (item) => item.grain_bin_id === bin.id,
  );
  const derived = deriveBinPosition(inventory, transactions);
  const primary = derived.lots[0];
  return {
    inventory,
    ...derived,
    commodityId: primary?.commodityId ?? null,
    onHand: derived.lots.reduce((sum, lot) => sum + lot.onHand, 0),
    exceedsRecordedInventory: derived.lots.some((lot) => lot.onHand < 0),
  };
}

/** `canManageFarm` decides whether the crop-year reconciliation list is offered. Naming what a
 * past movement was is restating history, so it takes an owner or a manager -- the server refuses
 * anyone else by name, and this keeps the list out of a worker's way rather than letting them find
 * a button that always fails. */
export function GrainPage({ services, canManageFarm = false }: { services: GrainServices; canManageFarm?: boolean }) {
  const [workspace, setWorkspace] = useState<GrainWorkspace | null>(null);
  const [attentionQueueKey, setAttentionQueueKey] = useState<string | null>(null);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);
  const receipt = useSaveReceipt(lastReceiptId);
  const [selectedEstimateId, setSelectedEstimateId] = useState("");
  const [editingTarget, setEditingTarget] = useState<{
    month: number;
    target?: MarketingPlanTarget;
  } | null>(null);
  const [planError, setPlanError] = useState("");
  // A plan replace has no row receipt the screen can follow (its queue receipt is keyed by the operation), so the plan card says
  // what happened in its own words: saved, or kept on this device until there is signal.
  const [planNotice, setPlanNotice] = useState("");
  // A sale limit that could not be saved is reported under the box it came from, on that crop's card only.
  const [saleLimitNotice, setSaleLimitNotice] = useState<{ key: string; message: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [alerts, setAlerts] = useState<GrainAlert[]>([]);
  const [deliveryNotice, setDeliveryNotice] = useState("");
  // GL-3b: a deleted contract takes its row off the screen with it, so anything the delete has to tell
  // the farmer cannot live in the row. This sits above the table, where the contract used to be.
  const [repairNotice, setRepairNotice] = useState("");
  // No existing per-scope settings field is suitable, so this farmer decision is
  // intentionally limited to the open session instead of being hidden in another record.
  const [saleLimits, setSaleLimits] = useState<Record<string, number | null>>({});
  const refreshWriteLock = useRef(createSubmitLock());
  const planLock = useRef(createSubmitLock());
  const location = useLocation();
  const rawTab = location.pathname.split("/")[2] ?? "";
  // A Today "Grain delivery" tile arrives with a record intent: the contracts tab opens in delivery mode, with the new-sale form
  // set aside so the only entry offered is the delivered bushels on an existing contract.
  const [deliveryIntent, setDeliveryIntent] = useState(() => parseTodayRecordIntent(location.state)?.record === "grain_delivery");
  // Today's grain line arrives with the estimate it summarized, so the Overview opens on that estimate and shows the same numbers.
  const [lineEstimateId] = useState(() => parseTodayGrainLineIntent(location.state)?.estimateId ?? null);
  const tabPath = [
    "plan",
    "alerts",
    "offers",
    "carry",
    "contracts",
    "loads",
    "storage",
  ].includes(rawTab)
    ? rawTab
    : "";
  const farmAccess = useOptionalFarmAccess();
  // Whether this member may write the farm's grain settings. Read through a ref inside refresh, which older closures (the sync-status
  // subscription) keep calling, so a change of access is always seen.
  const canWriteSettings = farmAccess ? canEditFarmModule(farmAccess.profile, "grain") : true;
  const canWriteSettingsRef = useRef(canWriteSettings);
  canWriteSettingsRef.current = canWriteSettings;
  const refresh = async (strict = false) => {
    try {
      const alertOperationContext = await captureGrainAlertOperationContext();
      originRef.current = { userId: alertOperationContext.userId, farmId: alertOperationContext.farmId };
      const [data, queueKey] = await Promise.all([services.grainRepository.getData(), services.grainRepository.getNeedsAttentionQueueKey?.().catch(() => null) ?? Promise.resolve(null)]);
      await verifyGrainAlertOperationContext(alertOperationContext);
      if (data.fields.farm.id !== alertOperationContext.farmId) throw new Error("The selected farm changed while grain alerts were loading.");
      setAttentionQueueKey(queueKey);
      const ruleEvaluation = evaluateMarketingAlertRules(data);
      const nextAlerts = evaluateGrainAlerts(data);
      setWorkspace(data);
      // Farm-saved sale limits win over anything typed but not yet committed for the same position, except a limit still being
      // typed. A draft whose save failed is replaced only when the refresh brings a newer row (another device's change), so a
      // stale draft never overwrites it; otherwise the draft stays dirty and pending for the next retry.
      if (data.capabilities?.persisted_settings === true) {
        const previous = workspaceRef.current;
        const adopted: string[] = [];
        const rows = data.grain_sale_limits.filter((limit) => {
          const key = scopeKey(scopeOf(limit));
          if (!dirtySaleLimits.current.has(key)) return true;
          if (!failedSaleLimits.current.has(key)) return false;
          const before = previous?.grain_sale_limits.find((row) => scopeKey(scopeOf(row)) === key);
          const newer = !before || before.id !== limit.id || before.updated_at !== limit.updated_at;
          if (newer) adopted.push(key);
          return newer;
        });
        for (const key of adopted) { dirtySaleLimits.current.delete(key); failedSaleLimits.current.delete(key); delete saleLimitBases.current[key]; settleSaleLimitUnflushed(key); }
        setSaleLimits((current) => ({ ...current, ...Object.fromEntries(rows.map((limit) => [scopeKey(scopeOf(limit)), limit.sale_limit_bushels])) }));
        // A limit this browser kept for this account and farm (its save failed, or the page was left before it ran) comes back
        // dirty and pending, unless the farm's row moved on since, in which case the newer row wins and the draft is dropped.
        // A member who may read but not write leaves every kept draft in storage, untouched and unsent, until edit access returns
        // (the refresh below on that change adopts it then); nothing is saved on their behalf.
        const scope = canWriteSettingsRef.current ? draftScopeFor(data.fields.farm.id) : null;
        // Two tabs that wrote the same draft at the same moment: the write read back is adopted below; the other goes to the recovery
        // vault for the farmer to check (it stays in storage, reported again next time, if the vault cannot be written).
        const toVault = (_kept: unknown, tied: Parameters<typeof quarantineTiedSettingsDrafts>[2]) => { if (scope) try { quarantineTiedSettingsDrafts(window.localStorage, scope, tied); } catch { /* the tied writes stay in storage */ } };
        if (scope) for (const entry of readSettingsDrafts(scope, "sale-limit:", isSaleLimitDraft, toVault)) {
          const kept = entry.payload as SaleLimitDraft;
          const row = data.grain_sale_limits.find((limit) => scopeKey(scopeOf(limit)) === kept.key);
          const typing = dirtySaleLimits.current.has(kept.key);
          const moved = (row?.id ?? null) !== (kept.base?.id ?? null) || (row?.updated_at ?? null) !== (kept.base?.updated_at ?? null);
          // The lineage travels with the draft and decides whether a moved row is the draft writer's own queued write coming back
          // (same value as last saved): after a reload nothing is in memory yet, and the draft may belong to another tab, whose
          // lineage must not be overridden by this tab's stale idea of what it last saved (every draft write carries its writer's).
          const sent = kept.sent;
          const own = moved && row !== undefined && sent !== undefined && row.sale_limit_bushels === sent;
          if (moved && !own) {
            // Another device changed the row. A scope still being typed keeps its draft and base: its commit conflicts, and the
            // recovery refresh then replaces it with the other device's row. An idle scope's older draft is dropped.
            if (!typing) clearSettingsDraft(scope, entry.key, entry.revision);
            continue;
          }
          let base = kept.base; let revision: string | null = entry.revision;
          if (own && row) {
            // This browser's own queued write replayed: rebase the draft onto it, whether it is still being typed or comes back from a reload.
            base = { id: row.id, updated_at: row.updated_at }; saleLimitBases.current[kept.key] = base;
            revision = writeSettingsDraft(scope, entry.key, { ...kept, base, sent } satisfies SaleLimitDraft);
            saleLimitDraftRevisions.current[kept.key] = revision;
            // The browser refused the rebased draft (full or blocked storage): the newer value is kept nowhere durable, so the stale
            // draft goes and the value is committed at once instead of waiting for the next blur (after the adoption below, if any).
            if (revision === null) { clearSettingsDraft(scope, entry.key, entry.revision); const estimate = data.production_estimates.find((candidate) => scopeKey(scopeOf(candidate)) === kept.key); if (estimate) setTimeout(() => void commitSaleLimit(estimate), 0); }
          }
          if (typing) continue; // the farmer is already typing here
          saleLimitDraftRevisions.current[kept.key] = revision; saleLimitBases.current[kept.key] = base; saleLimitSent.current[kept.key] = sent;
          dirtySaleLimits.current.add(kept.key); failedSaleLimits.current.add(kept.key); markSaleLimitUnflushed(kept.key, data.fields.farm.id);
          saleLimitsRef.current = { ...saleLimitsRef.current, [kept.key]: kept.value };
          setSaleLimits((current) => ({ ...current, [kept.key]: kept.value }));
        }
      }
      setAlerts(nextAlerts);
      // GL-2: until the live database carries the crop-year eligibility rule, this client writes nothing
      // about a SAVED MARKETING RULE and asks for no delivery of one. A merge deploys this client on its
      // own while applying the migration is a separate owner action, so a new client runs against the old
      // sweep for a while; the two judge a bid by different rules, and any rule write from here in that
      // window ends up wrong. The holdback must skip the pre-0035 branch rather than fall through it:
      // that branch stamps last_triggered_at, which hides the alert from the page for the rest of the
      // day, and then asks for a delivery the server refuses.
      //
      // It reaches no further than that. A plan-target or USDA report reminder carries no ruleId, owes
      // nothing to crop-year eligibility, and is emailed by the same check-on-open path it always was --
      // which the page still tells the farmer. Holding those back too would silence real emails for the
      // length of the rollout gap. The delivery below is the same call either way; only its input narrows.
      const deliveries = mayRecordAlertTransitions(data.capabilities)
        ? recordMarketingAlertTransitions(data.fields.farm.id, ruleEvaluation.conditions, alertOperationContext).then((transitioned) => {
          if (transitioned !== null) return requestOwnerAlertDelivery(nextAlerts.filter((alert) => !alert.ruleId || transitioned.has(alert.ruleId)), data.fields.farm.id, alertOperationContext);
          // Pre-0035: retain current behavior, but one synchronous refresh lock
          // prevents a refresh burst from double-writing the same rule state.
          if (ruleEvaluation.firedRuleIds.length && refreshWriteLock.current.acquire()) {
            const stamp = new Date().toISOString();
            void Promise.all(ruleEvaluation.firedRuleIds.map((id) => {
              const rule = data.marketing_alert_rules.find((item) => item.id === id);
              return rule ? verifyGrainAlertOperationContext(alertOperationContext).then(() => services.grainRepository.saveMarketingAlertRule({ ...rule, last_triggered_at: stamp, updated_at: stamp })) : Promise.resolve();
            })).finally(() => refreshWriteLock.current.release());
          }
          return requestOwnerAlertDelivery(nextAlerts, data.fields.farm.id, alertOperationContext);
        })
        : requestOwnerAlertDelivery(nextAlerts.filter((alert) => !alert.ruleId), data.fields.farm.id, alertOperationContext);
      void deliveries.then(
        (failed) =>
          setDeliveryNotice(
            failed.length
              ? "An email notice could not be sent. Your in-app alert is still here."
              : "",
          ),
      ).catch(() =>
        setDeliveryNotice(
          "An email notice could not be sent. Your in-app alert is still here.",
        ),
      );
      setLoadError("");
      // The page opens on the newest crop year, the one being sold and delivered now. The repository
      // lists estimates oldest first, so taking the first one opened every tab on last year's crop.
      setSelectedEstimateId((current) =>
        data.production_estimates.some((estimate) => estimate.id === current)
          ? current
          : ((lineEstimateId && data.production_estimates.some((estimate) => estimate.id === lineEstimateId) ? lineEstimateId : undefined) ?? deliveryDefaultEstimate(data.production_estimates)?.id ?? ""),
      );
    } catch (caught) {
      const message =
        caught instanceof Error &&
        caught.message === "GRAIN_PRIVATE_ACCESS_DENIED"
          ? "Grain records are private on this farm. Ask the farm owner or manager if you need access."
          : farmerError(caught, "load your grain records");
      setLoadError(message);
      if (strict) throw new Error(message);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  // Edit access returned (a member re-promoted while on the page): refresh so the drafts left untouched while read-only are adopted.
  // Edit access lost while a limit was still being typed: the browser draft stays for a later visit with edit access, but nothing is
  // sent for this member any more, so the in-memory pending work is released and a confirmed farm switch is not refused.
  const previousCanWrite = useRef(canWriteSettings);
  useEffect(() => {
    const returned = !previousCanWrite.current && canWriteSettings;
    const lost = previousCanWrite.current && !canWriteSettings;
    previousCanWrite.current = canWriteSettings;
    if (returned && workspaceRef.current) void refresh().catch(() => undefined);
    if (lost) { for (const key of dirtySaleLimits.current) settleSaleLimitUnflushed(key); dirtySaleLimits.current.clear(); failedSaleLimits.current.clear(); saleLimitBases.current = {}; saleLimitDraftRevisions.current = {}; }
  }, [canWriteSettings]); // eslint-disable-line react-hooks/exhaustive-deps
  const whisper = () => undefined;
  const saleLimitsRef = useRef(saleLimits);
  saleLimitsRef.current = saleLimits;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  // Scopes the farmer is still typing in; a workspace refresh must not overwrite them.
  const dirtySaleLimits = useRef(new Set<string>());
  // Scopes whose last save failed: kept dirty and pending for retry, but replaced when a refresh brings a newer row.
  const failedSaleLimits = useRef(new Set<string>());
  // An edit not yet committed keeps the farm marked pending for the farm switcher; the commit below then holds its own token.
  const unflushedSaleLimits = useRef(new Map<string, () => void>());
  const pendingScopeFor = (farmId: string | undefined) => originRef.current && farmId ? { userId: originRef.current.userId, farmId } : null;
  const markSaleLimitUnflushed = (key: string, farmId = workspaceRef.current?.fields.farm.id) => { const scope = pendingScopeFor(farmId); if (scope && !unflushedSaleLimits.current.has(key)) unflushedSaleLimits.current.set(key, beginPendingSettingsWork(scope)); };
  // This page instance is gone once the route changes (the route boundary remounts per path); saves that fail after that retain their draft instead.
  const mountedRef = useRef(true);
  // Set on every setup (development StrictMode runs setup, cleanup, setup once), so the flag is true while the page is on.
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  // A save queued offline returns the client row with its old version; replay later advances the version on the server. Once the
  // grain queue has drained, refetch so the rows carry their replayed versions and the next edit does not conflict with its own save.
  useEffect(() => {
    let previous = getModuleSyncStatus("grain").kind;
    const unsubscribe = subscribeSyncStatus(() => {
      const next = getModuleSyncStatus("grain").kind;
      if ((previous === "pending" || previous === "syncing") && next === "synced" && mountedRef.current) void refresh().catch(() => undefined);
      previous = next;
    });
    return () => { unsubscribe(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The account and farm this page loaded for: a save runs only while both are still the live selection (another tab may have changed either).
  const originRef = useRef<{ userId: string; farmId: string } | null>(null);
  // The revision of the browser draft last written or adopted per position: a save clears only that revision (another tab may have written since).
  const saleLimitDraftRevisions = useRef<Record<string, string | null>>({});
  // Per position: the row the current editing session started from (sent as the version, so another device's change conflicts instead
  // of being overwritten) and the last value this browser saved (lineage: a refreshed row with that value is this browser's own write).
  const saleLimitBases = useRef<Record<string, { id: string; updated_at: string } | null | undefined>>({});
  const saleLimitSent = useRef<Record<string, number | null | undefined>>({});
  // The browser draft scope for this account and farm (see settingsDrafts.ts); undefined until the page knows its account.
  const draftScopeFor = (farmId: string): SettingsDraftScope | undefined => originRef.current ? { projectRef: supabaseConfig.projectRef, userId: originRef.current.userId, farmId } : undefined;
  const settleSaleLimitUnflushed = (key: string) => { unflushedSaleLimits.current.get(key)?.(); unflushedSaleLimits.current.delete(key); };
  // One lock per position: a slow save on one card must not swallow a commit on another.
  const saleLimitLocks = useRef(createSubmitLockMap());
  // A debounced, unmount-time, or blur-time save must never run under a farm the farmer (or another tab) has since switched to.
  const farmStillSelected = async (farmId: string) => { try { const live = await currentFarmContext(); const origin = originRef.current; return live.farmId === farmId && origin !== null && live.userId === origin.userId; } catch { return false; } };
  // A failed settings save refreshes once so the screen learns the row another device may have created.
  const recoverSettings = async (caught: unknown, action: string) => {
    setSettingsNotice(farmerError(caught, action));
    await refresh().catch(() => undefined);
  };
  const isContextChanged = (caught: unknown) => caught instanceof Error && caught.message === SETTINGS_CONTEXT_CHANGED;
  // Another tab (or a switch already under way) changed the selected farm: the queued repository would rebind the row to that
  // farm, so the save is refused, the draft stays dirty and pending, and no refresh runs under the other farm.
  const contextChanged = (): never => { setSettingsNotice(farmerError(new Error(SETTINGS_CONTEXT_CHANGED), "save your settings")); throw new Error(SETTINGS_CONTEXT_CHANGED); };
  const commitSaleLimit = async (estimate: ProductionEstimate) => {
    const key = scopeKey(scopeOf(estimate));
    const lock = saleLimitLocks.current.get(key);
    if (!lock.acquire()) return; // a commit for this same position is in flight; it re-runs below if the value changed meanwhile
    // Held synchronously, before the first await, so a farm-switch click that blurred this input sees the save as pending work.
    const pendingScope = pendingScopeFor(estimate.farm_id); const done = pendingScope ? beginPendingSettingsWork(pendingScope) : () => undefined;
    settleSaleLimitUnflushed(key);
    let savedValue: number | null | undefined;
    let failure: unknown;
    const draftRevision = saleLimitDraftRevisions.current[key] ?? null;
    const clearDraft = () => { const scope = draftScopeFor(estimate.farm_id); if (scope && draftRevision) clearSettingsDraft(scope, `sale-limit:${key}`, draftRevision); };
    // The value as typed; the commit sends it rounded to the column's two decimals and, unless the farmer typed again meanwhile,
    // shows the rounded value afterwards, so the screen, the draft lineage, and the saved row agree and no follow-up commit loops.
    const typed = saleLimitsRef.current[key] ?? null;
    let typedSince = false;
    const adopt = (value: number | null) => { if ((saleLimitsRef.current[key] ?? null) !== value) { saleLimitsRef.current = { ...saleLimitsRef.current, [key]: value }; setSaleLimits((current) => ({ ...current, [key]: value })); } };
    try {
      const current = workspaceRef.current;
      if (!current || current.capabilities?.persisted_settings !== true) return;
      // A commit scheduled earlier (the follow-up after a save, the at-once commit after a refused draft write) may run after edit
      // access was lost: nothing is sent for a member who may not write, and the browser draft stays for a later visit with access.
      if (!canWriteSettingsRef.current) return;
      const existing = current.grain_sale_limits.find((limit) => scopeKey(scopeOf(limit)) === key);
      const stamp = new Date().toISOString();
      try {
        const value = normalizeGrainSaleLimit({ id: existing?.id ?? "", ...scopeOf(estimate), sale_limit_bushels: typed, created_at: stamp, updated_at: stamp }).sale_limit_bushels;
        if ((existing?.sale_limit_bushels ?? null) === value) { dirtySaleLimits.current.delete(key); delete saleLimitBases.current[key]; savedValue = value; adopt(value); clearDraft(); return; }
        if (!(await farmStillSelected(estimate.farm_id))) contextChanged();
        // The version sent is the row this editing session started from, so a row changed on another device since then conflicts
        // (and the recovery refresh replaces the draft) instead of being overwritten with the typed value.
        const base = saleLimitBases.current[key]; const origin = base === undefined ? existing : base;
        // A first insert takes the id derived from its position scope, so another tab's first insert of the same scope is the same row.
        const saved = await services.grainRepository.saveGrainSaleLimit({ id: origin?.id ?? await stableGrainSaleLimitId(scopeOf(estimate)), ...scopeOf(estimate), sale_limit_bushels: value, created_at: existing?.created_at ?? stamp, updated_at: origin?.updated_at ?? stamp });
        savedValue = saved.sale_limit_bushels;
        failedSaleLimits.current.delete(key);
        saleLimitBases.current[key] = { id: saved.id, updated_at: saved.updated_at }; saleLimitSent.current[key] = saved.sale_limit_bushels;
        typedSince = (saleLimitsRef.current[key] ?? null) !== typed;
        if (!typedSince) { dirtySaleLimits.current.delete(key); delete saleLimitBases.current[key]; adopt(savedValue); clearDraft(); }
        // The farmer typed more while this save ran: rewrite the newer draft on top of the saved row, so a reload before the follow-up
        // commit does not mistake this save for another device's change and drop the newer value.
        else { const scope = draftScopeFor(estimate.farm_id); if (scope) { const previous = saleLimitDraftRevisions.current[key]; const revision = writeSettingsDraft(scope, `sale-limit:${key}`, { key, value: saleLimitsRef.current[key] ?? null, base: { id: saved.id, updated_at: saved.updated_at }, sent: saved.sale_limit_bushels } satisfies SaleLimitDraft); saleLimitDraftRevisions.current[key] = revision; if (revision === null && previous) clearSettingsDraft(scope, `sale-limit:${key}`, previous); } }
        setSettingsNotice("");
        setSaleLimitNotice((current) => current?.key === key ? null : current);
        // Keep the ref current too, so a follow-up commit chained below sees the saved row before React renders it.
        const next = (workspaceCurrent: GrainWorkspace) => ({ ...workspaceCurrent, grain_sale_limits: [...workspaceCurrent.grain_sale_limits.filter((limit) => scopeKey(scopeOf(limit)) !== key), saved] });
        if (workspaceRef.current) workspaceRef.current = next(workspaceRef.current);
        setWorkspace((workspaceCurrent) => workspaceCurrent ? next(workspaceCurrent) : workspaceCurrent);
      } catch (caught) {
        failure = caught ?? new Error("Sale limit save failed.");
        failedSaleLimits.current.add(key);
        if (!isContextChanged(caught)) {
          setSaleLimitNotice({ key, message: farmerError(caught, "save your sale limit") });
          await recoverSettings(caught, "save your sale limit");
        }
      }
    } finally {
      lock.release();
      // The farmer kept typing while the save was in flight: commit the newest value once more.
      if (savedValue !== undefined && typedSince) void commitSaleLimit(estimate);
      // A failed save keeps the typed limit on screen, dirty and pending: the farm switcher warns, and a confirmed switch
      // retries it through the registered flush and stops if it fails again, rather than discarding it.
      done(failure);
      // A failed save leaves the browser draft in place; a mounted page also keeps the scope pending for the farm switcher.
      if (failure !== undefined && dirtySaleLimits.current.has(key) && mountedRef.current) markSaleLimitUnflushed(key);
    }
  };
  const commitSaleLimitRef = useRef(commitSaleLimit);
  commitSaleLimitRef.current = commitSaleLimit;
  // A confirmed farm switch commits every sale limit still being typed, then waits for those saves before the farm changes.
  const activeFarmId = workspace?.fields.farm.id;
  const persistedSettings = workspace?.capabilities?.persisted_settings === true;
  useEffect(() => {
    const scope = pendingScopeFor(activeFarmId);
    if (!scope || !persistedSettings || !canWriteSettings) return; // a member who may not write has nothing to send
    return registerPendingSettingsFlush(scope, () => {
      for (const estimate of workspaceRef.current?.production_estimates ?? []) if (dirtySaleLimits.current.has(scopeKey(scopeOf(estimate)))) void commitSaleLimitRef.current(estimate);
    });
  }, [activeFarmId, persistedSettings, canWriteSettings]);
  const carryPersistence = {
    saveSettings: async (settings: GrainCarrySettings) => {
      if (!(await farmStillSelected(settings.farm_id))) contextChanged();
      try {
        const saved = await services.grainRepository.saveGrainCarrySettings(settings);
        setSettingsNotice("");
        setWorkspace((current) => current ? { ...current, grain_carry_settings: saved } : current);
        return saved;
      } catch (caught) { await recoverSettings(caught, "save your storage cost settings"); throw caught; }
    },
    saveGrid: async (grid: GrainCarryGrid) => {
      if (!(await farmStillSelected(grid.farm_id))) contextChanged();
      try {
        const saved = await services.grainRepository.saveGrainCarryGrid(grid);
        setSettingsNotice("");
        setWorkspace((current) => current ? { ...current, grain_carry_grids: [...current.grain_carry_grids.filter((row) => row.id !== saved.id && row.production_estimate_id !== saved.production_estimate_id), saved] } : current);
        return saved;
      } catch (caught) { await recoverSettings(caught, "save your carry prices"); throw caught; }
    },
    draftScope: workspace ? draftScopeFor(workspace.fields.farm.id) : undefined,
    writable: canWriteSettings,
  };
  if (!workspace)
    return (
      <section className="page">
        <div className="loading-state" role={loadError ? "alert" : undefined}>
          {loadError || "Loading grain position…"}
        </div>
      </section>
    );
  const selectedEstimate =
    workspace.production_estimates.find(
      (estimate) => estimate.id === selectedEstimateId,
    ) ?? (lineEstimateId ? workspace.production_estimates.find((estimate) => estimate.id === lineEstimateId) : undefined) ?? deliveryDefaultEstimate(workspace.production_estimates);
  // Bins, crop-year naming and basis need no production estimate, so this one block serves the page
  // both before and after the first estimate exists.
  const storageTab = (
    <section className="grain-section storage-layout">
      <Bins
        workspace={workspace}
        services={services}
        receipt={receipt}
        onSaved={async () => {
          whisper();
          await refresh();
        }}
        onMovementSaved={async () => {
          await refresh(true);
          whisper();
        }}
        onReceipt={setLastReceiptId}
      />
      <CropYearReconciliation
        workspace={workspace}
        services={services}
        canManageFarm={canManageFarm}
        onSaved={async () => { await refresh(true); whisper(); }}
      />
      <Basis
        workspace={workspace}
        services={services}
        onSaved={async () => {
          whisper();
          await refresh();
        }}
      />
    </section>
  );
  // No estimate yet: the tabs still show, because Loads and Bins & basis work without one. The pages
  // that are kept per crop and year (plan, contracts, offers, alerts, storage cost) point back to the
  // Overview, where the first estimate is started.
  if (!selectedEstimate)
    return (
      <section className="page grain-page">
        <div className="page-heading grain-heading">
          <div>
            <h1>Grain</h1>
          </div>
        </div>
        <NeedsAttentionList module="grain" queueKey={attentionQueueKey} onChanged={refresh} />
        <SaveReceipt state={receipt} />
        <SectionTabs base="/grain" tabs={GRAIN_TABS} />
        {tabPath === "" && (
          <FirstEstimate
            workspace={workspace}
            services={services}
            onSaved={refresh}
            onReceipt={setLastReceiptId}
            receipt={receipt}
          />
        )}
        {tabPath === "loads" && (
          <LoadsTab workspace={workspace} services={services} onSaved={refresh} />
        )}
        {tabPath === "storage" && storageTab}
        {tabPath !== "" && tabPath !== "loads" && tabPath !== "storage" && (
          <section className="grain-section grain-needs-estimate">
            <p>Start a grain estimate on the Overview tab first. Contracts and plans are kept per crop and year.</p>
            <NavLink to="/grain" end className="primary-action">Go to Overview</NavLink>
          </section>
        )}
        <aside className="compliance-note">
          Farm Rx shows your numbers and your targets. It does not give marketing
          advice.
        </aside>
      </section>
    );
  const selectedScope = scopeOf(selectedEstimate);
  const selectedScopeLabel = scopeLabel(workspace, selectedScope);
  const contractRows = scopeRows(workspace.grain_contracts, selectedScope);
  // Display only: the same finalRevenue / finalBushels the Overview averages, nothing new persisted.
  const contractPosition = calculateGrainPosition(0, contractRows, 0, null);
  const farmYear = Number(planDateFor(new Date(), workspace.fields.farm.time_zone).slice(0, 4));
  const nextYearMissing = !workspace.production_estimates.some((estimate) => estimate.crop_year === farmYear + 1);
  // Queued while offline, a plan change is not yet on the farm's record; the notice says so instead of "saved".
  const planSavedNotice = () => getModuleSyncStatus("grain").kind !== "synced" ? "Plan kept on this device. It will save when you have signal." : "Plan saved.";
  const saveTarget = async (values: {
    pct: number;
    price: number | null;
    relativePct: number | null;
    deadline: string | null;
  }) => {
    if (!editingTarget) return;
    if (!planLock.current.acquire()) return;
    const timestamp = new Date().toISOString();
    const target: MarketingPlanTarget = editingTarget.target
      ? {
          ...editingTarget.target,
          target_pct_of_production: values.pct,
          target_price: values.price,
          breakeven_relative_pct: values.relativePct,
          deadline: values.deadline,
          updated_at: timestamp,
        }
      : {
          id: services.createGrainId(),
          ...selectedScope,
          target_month: `${selectedScope.crop_year}-${String(editingTarget.month).padStart(2, "0")}-01`,
          target_pct_of_production: values.pct,
          target_price: values.price,
          breakeven_relative_pct: values.relativePct,
          deadline: values.deadline,
          notes: null,
          created_at: timestamp,
          updated_at: timestamp,
        };
    try {
      await services.grainRepository.saveMarketingPlanTarget(target);
      setEditingTarget(null);
      setPlanError("");
      setPlanNotice(planSavedNotice());
      await refresh();
    } catch (error) {
      setPlanError(farmerError(error, "save this target"));
    } finally {
      planLock.current.release();
    }
  };
  // There is no single-target delete: the plan is replaced with every other month of this crop and
  // year, and replace_marketing_plan_targets removes the one left out.
  const removeTarget = async (target: MarketingPlanTarget) => {
    if (!planLock.current.acquire()) return;
    if (!(await confirmDialog({ title: `Remove the ${monthLabel(target.target_month)} target?`, body: "The other months of this plan stay as they are.", confirmLabel: "Remove month", destructive: true }))) {
      planLock.current.release();
      return;
    }
    try {
      await services.grainRepository.replaceMarketingPlanTargets(
        selectedScope,
        scopeRows(workspace.marketing_plan_targets, selectedScope).filter((row) => row.id !== target.id),
      );
      setEditingTarget(null);
      setPlanError("");
      setPlanNotice(planSavedNotice());
      await refresh();
    } catch (error) {
      setPlanError(farmerError(error, "remove this month"));
    } finally {
      planLock.current.release();
    }
  };
  const applyTemplate = async (template: Template) => {
    if (!planLock.current.acquire()) return;
    const existing = scopeRows(workspace.marketing_plan_targets, selectedScope);
    if (existing.length && !(await confirmDialog({ title: `Replace your ${selectedScopeLabel} plan?`, body: `This replaces the ${existing.length === 1 ? "1 month" : `${existing.length} months`} you have set with the ${templates[template].name} template (${templates[template].total}% of the crop). Contracts are not changed.`, confirmLabel: "Replace plan", destructive: true }))) {
      planLock.current.release();
      return;
    }
    setPlanNotice("");
    const timestamp = new Date().toISOString();
    const targets = templates[template].schedule.map(([month, pct]) => ({
      id: services.createGrainId(),
      ...selectedScope,
      target_month: `${selectedScope.crop_year}-${String(month).padStart(2, "0")}-01`,
      target_pct_of_production: pct,
      target_price: null,
      breakeven_relative_pct: null,
      // A template sets months and percentages only. A deadline turns into a deadline alert, so it is
      // added per month by the farmer in the month editor, never on their behalf.
      deadline: null,
      notes: null,
      created_at: timestamp,
      updated_at: timestamp,
    }));
    try {
      await services.grainRepository.replaceMarketingPlanTargets(
        selectedScope,
        targets,
      );
      setPlanError("");
      setPlanNotice(planSavedNotice());
      await refresh();
    } catch (error) {
      setPlanError(farmerError(error, "apply this plan"));
    } finally {
      planLock.current.release();
    }
  };
  return (
    <section className="page grain-page">
      <div className="page-heading grain-heading">
        <div>
          <h1>Grain</h1>
        </div>
      </div>
      <NeedsAttentionList module="grain" queueKey={attentionQueueKey} onChanged={refresh} />
      <SaveReceipt state={receipt} />
      <SectionTabs base="/grain" tabs={GRAIN_TABS} />
      {tabPath === "" && (
        <>
          {alerts.length > 0 && (
            <section className="grain-section" aria-label="Grain alerts">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Grain alerts</span>
                  <h2>Items to review</h2>
                  <p>An alert already sent to your phone today is not shown again here.</p>

                </div>
              </div>
              {alerts.map((alert) => (
                <p key={alert.key} role="status">
                  {alert.message}
                </p>
              ))}
            </section>
          )}
          {deliveryNotice && (
            <p className="form-error grain-inline-error" role="status">
              {deliveryNotice}
            </p>
          )}
          <section aria-label="Commodity positions" className="position-grid">
            {workspace.production_estimates.map((estimate) => (
              <PositionCard
                key={estimate.id}
                estimate={estimate}
                workspace={workspace}
                services={services}
                saleLimit={saleLimitForScope(saleLimits, estimate)}
                saleLimitPersisted={workspace.capabilities?.persisted_settings === true}
                saleLimitError={saleLimitNotice?.key === scopeKey(scopeOf(estimate)) ? saleLimitNotice.message : ""}
                onSaleLimitCommit={() => void commitSaleLimit(estimate)}
                onSaleLimitChange={(limit) => {
                  const key = scopeKey(scopeOf(estimate));
                  // A limit too large for its column could never be saved: it is refused here with the reason, neither kept nor queued.
                  try { normalizeGrainSaleLimit({ id: "", ...scopeOf(estimate), sale_limit_bushels: limit, created_at: "", updated_at: "" }); }
                  catch (caught) { const message = caught instanceof Error ? caught.message : "That sale limit cannot be saved."; setSaleLimitNotice({ key, message: message.charAt(0).toUpperCase() + message.slice(1) }); return; }
                  setSaleLimitNotice((current) => current?.key === key ? null : current);
                  dirtySaleLimits.current.add(key);
                  failedSaleLimits.current.delete(key);
                  // Written to the browser at once, so a reload or a save that fails after leaving the page keeps what was typed.
                  const scope = draftScopeFor(estimate.farm_id);
                  // If the browser refuses the draft (private mode, blocked or full storage), commit the value at once rather than waiting for blur.
                  const existing = workspace.grain_sale_limits.find((row) => scopeKey(scopeOf(row)) === key);
                  if (saleLimitBases.current[key] === undefined) saleLimitBases.current[key] = existing ? { id: existing.id, updated_at: existing.updated_at } : null;
                  // A refused write removes only the revision this tab wrote before; a newer draft another tab wrote stays.
                  if (scope) { const previous = saleLimitDraftRevisions.current[key]; const revision = writeSettingsDraft(scope, `sale-limit:${key}`, { key, value: limit, base: saleLimitBases.current[key] ?? null, sent: saleLimitSent.current[key] } satisfies SaleLimitDraft); saleLimitDraftRevisions.current[key] = revision; if (revision === null) { if (previous) clearSettingsDraft(scope, `sale-limit:${key}`, previous); setTimeout(() => void commitSaleLimit(estimate), 0); } }
                  markSaleLimitUnflushed(scopeKey(scopeOf(estimate)));
                  setSaleLimits((current) => ({ ...current, [scopeKey(scopeOf(estimate))]: limit }));
                }}
                onSaved={async () => {
                  whisper();
                  await refresh();
                }}
                onReceipt={setLastReceiptId}
              />
            ))}
          </section>
          <UntrackedStoredGrain workspace={workspace} />
          {/* GL-3: the way to add a second crop. Renders nothing when every crop assignment already has
              an estimate. */}
          <FirstEstimate
            compact
            workspace={workspace}
            services={services}
            onSaved={refresh}
            onReceipt={setLastReceiptId}
            receipt={receipt}
          />
          <MarketQuoteSection cropYear={quoteCropYear(workspace.production_estimates.map((estimate) => estimate.crop_year))} />
        </>
      )}
      {tabPath === "plan" && (
        <>
          <section className="grain-section plan-card">
            <div className="section-heading">
              <div>
                <h2>Monthly marketing plan</h2>
                <p>How much of the crop you plan to sell in each month. Each month adds to the ones before it.</p>
              </div>
              <label className="commodity-picker">
                <span>Crop and year</span>
                <select
                  value={selectedEstimate.id}
                  onChange={(event) => {
                    setSelectedEstimateId(event.target.value);
                    setPlanNotice("");
                  }}
                >
                  {workspace.production_estimates.map((estimate) => (
                    <option key={estimate.id} value={estimate.id}>
                      {scopeLabel(workspace, estimate)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="template-bar" aria-label="Marketing plan templates">
              {(Object.keys(templates) as Template[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="template-button"
                  onClick={() => void applyTemplate(key)}
                >
                  <strong>{templates[key].name}</strong>
                  <span>{templates[key].description}</span>
                </button>
              ))}
            </div>
            {planNotice && (
              <p role="status" className={`save-receipt ${planNotice === "Plan saved." ? "save-receipt-saved" : "save-receipt-queued-offline"} plan-notice`}>{planNotice}</p>
            )}
            <div className="month-grid">
              {months.map((month, index) => {
                const number = index + 1;
                const target = scopeRows(
                  workspace.marketing_plan_targets,
                  selectedScope,
                ).find(
                  (item) => Number(item.target_month.slice(5, 7)) === number,
                );
                return (
                  <button
                    className={`month-cell${target ? " planned" : ""}`}
                    type="button"
                    key={month}
                    onClick={() => {
                      setPlanNotice("");
                      setPlanError("");
                      setEditingTarget({ month: number, target });
                    }}
                  >
                    <span>{month}</span>
                    <strong>
                      {target ? `${target.target_pct_of_production}%` : "—"}
                    </strong>
                    <small>
                      {target?.target_price === null ||
                      target?.target_price === undefined
                        ? target
                          ? "Add cash target"
                          : "No target set"
                          : `Cash target ${money.format(target.target_price)}`}
                    </small>
                  </button>
                );
              })}
            </div>
            {/* While the month editor is open its own error line shows this, inside the modal. */}
            {planError && !editingTarget && (
              <p className="form-error grain-inline-error" role="alert">
                {planError}
              </p>
            )}
            <PlanStatus estimate={selectedEstimate} workspace={workspace} />
          </section>
          <ActualVsPlan estimate={selectedEstimate} workspace={workspace} />
        </>
      )}
      {/* A sale-limit error already shows under the box on its card, so it is not repeated down here. */}
      {settingsNotice && !(tabPath === "" && saleLimitNotice) && (
        <p className="form-error grain-inline-error" role="status">
          {settingsNotice}
        </p>
      )}
      {tabPath === "carry" && (
        <GrainCostOfCarry
          workspace={workspace}
          selectedEstimate={selectedEstimate}
          selectedEstimateId={selectedEstimateId}
          onSelectEstimate={setSelectedEstimateId}
          persistence={carryPersistence}
        />
      )}
      {tabPath === "alerts" && (
        <MarketingAlerts
          workspace={workspace}
          services={services}
          selectedEstimateId={selectedEstimateId}
          onSelectEstimate={setSelectedEstimateId}
          onSaved={async () => {
            whisper();
            await refresh();
          }}
        />
      )}
      {tabPath === "offers" && (
        <FirmOffers
          workspace={workspace}
          services={services}
          selectedEstimateId={selectedEstimateId}
          onSelectEstimate={setSelectedEstimateId}
          saleLimits={saleLimits}
          onSaved={async () => {
            whisper();
            await refresh();
          }}
        />
      )}
      {tabPath === "contracts" && (
        <section className="grain-section contracts-card">
          <div className="section-heading">
            <div>
              <h2>Contracts</h2>
              {deliveryIntent && <p>Record the bushels delivered on a contract.</p>}
            </div>
            <SaveReceipt state={receipt} />
          </div>
          {/* GL-3: the crop and year picker belongs on the tab, not only in delivery mode. The table below
              is filtered to the chosen scope, so without it a farmer reading Contracts could not tell which
              crop year the list was showing, or change it. */}
          {workspace.production_estimates.length > 0 && (
            <label className="commodity-picker contracts-picker">
              <span>Crop and year</span>
              <select value={selectedEstimate.id} onChange={(event) => { setRepairNotice(""); setSelectedEstimateId(event.target.value); }}>
                {workspace.production_estimates.map((estimate) => (
                  <option key={estimate.id} value={estimate.id}>{scopeLabel(workspace, estimate)}</option>
                ))}
              </select>
            </label>
          )}
          {/* A crop can be sold only once it has an estimate, and next year's crop gets one only after it
              is planned in Fields and given a yield on Overview. Nothing else on this tab says so. */}
          {!deliveryIntent && nextYearMissing && (
            <p className="panel-note contracts-next-year">To sell next year's crop, add it in <Link to="/fields">Fields</Link>, then set its expected yield on <Link to="/grain">Overview</Link>. It will then appear here.</p>
          )}
          {deliveryIntent ? <div className="grain-delivery-intent" role="status"><div><strong>Recording a grain delivery</strong><p>Pick the crop and year above, then the contract below, and enter the delivered bushels. Nothing is written until you tap Record delivery.</p><p>Hauling a truck out of a bin? <Link to="/grain/loads">Record it as a load</Link> instead. It takes the grain out of the bin and records the delivery in one step.</p></div><button className="secondary-action" type="button" onClick={() => setDeliveryIntent(false)}>Record a sale instead</button></div> : <ContractEntry
            // GL-3a made the crop and year picker permanent on this tab, which introduced a way to save a
            // contract under the wrong scope: React reused this form across a scope change, so a draft
            // typed for 2026 kept its delivery window while the save spread the newly chosen 2027 scope.
            // Keying by the scope remounts the form, so a draft never outlives the crop year it was for.
            key={scopeKey(selectedScope)}
            workspace={workspace}
            scope={selectedScope}
            services={services}
            saleLimit={saleLimits[scopeKey(selectedScope)] ?? null}
            onSaved={async () => {
              setRepairNotice("");
              whisper();
              await refresh();
            }}
            onReceipt={setLastReceiptId}
          />}
          {/* News, not an error: green, and the farmer can put it away. */}
          {repairNotice && (
            <p className="grain-inline-notice" role="status">{repairNotice} <button className="text-action" type="button" onClick={() => setRepairNotice("")}>Dismiss</button></p>
          )}
          {contractRows.length === 0 ? (
            <p className="panel-note contracts-empty">
              {deliveryIntent
                ? `No contracts yet for ${selectedScopeLabel}. Pick another crop and year above, or tap Record a sale instead.`
                : `No contracts yet for ${selectedScopeLabel}. Add your first sale above.`}
            </p>
          ) : (
          <div className="table-scroll">
            {/* The delivery, pricing and correction controls get a full-width row under each contract
                rather than being squeezed into the last column, so the table fits a laptop without scrolling sideways. There is
                no Commodity column: the table shows one crop and year, named in the picker and the total.
                On a phone each contract stacks into a labelled card. */}
            <table className="contracts-table phone-stack">
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Type</th>
                  <th className="align-right">Bushels</th>
                  <th className="align-right">Price</th>
                  <th>Delivery</th>
                  <th className="align-right">Delivered</th>
                </tr>
              </thead>
              <tbody>
                {contractRows.map(
                  (contract, contractIndex) => {
                    const delivered = workspace.grain_contract_deliveries.filter((item) => item.grain_contract_id === contract.id).reduce((sum, item) => sum + item.bushels, 0);
                    const remaining = contract.bushels - delivered;
                    const finalPrice = finalCashPrice(contract);
                    return (
                    <Fragment key={contract.id}>
                    <tr className="contract-row">
                      <td className="phone-full" data-label="Buyer">
                        <strong>{contract.buyer}</strong>
                        <small>
                          {contract.contract_number ?? "No contract #"}
                        </small>
                      </td>
                      <td data-label="Type">{contractLabels[contract.contract_type]}</td>
                      <td className="align-right numeric" data-label="Bushels">
                        {bushels.format(contract.bushels)}
                      </td>
                      {/* A half-priced contract shows the leg that is known, not only the one that is missing. */}
                      <td className="align-right numeric" data-label="Price">
                        {finalPrice === null
                          ? contract.contract_type === "hta"
                            ? <>Futures {pricePerBu.format(contract.futures_price!)}<small>Basis not set</small></>
                            : <>Basis {pricePerBu.format(contract.basis!)}<small>Futures not set</small></>
                          : pricePerBu.format(finalPrice)}
                      </td>
                      <td data-label="Delivery">
                        {contract.delivery_start?.slice(5).replace("-", "/") ??
                          "—"}
                      </td>
                      <td className="align-right numeric phone-full" data-label="Delivered">{workspace.capabilities?.contract_deliveries ? <><strong>{displayBushels(delivered)} bu delivered</strong><small>{displayBushels(Math.max(0, remaining))} bu left</small>{remaining < 0 && <small className="negative-text">Over-delivered by {displayBushels(-remaining)} bu</small>}</> : <strong>Tracking arrives with the next database update</strong>}</td>
                    </tr>
                    <tr className="contract-actions-row">
                      <td className="phone-full" colSpan={6}><ContractActions contract={contract} workspace={workspace} services={services} autoFocusDelivery={deliveryIntent && contractIndex === 0} onSaved={async () => { whisper(); await refresh(); }} onDeliverySaved={async () => { await refresh(true); whisper(); }} onDeleted={setRepairNotice} onReceipt={setLastReceiptId} /></td>
                    </tr>
                    </Fragment>
                    );
                  },
                )}
              </tbody>
              {/* GL-3: a totals row, so the tab answers "how much have I sold, and how much is left to
                  deliver" without the farmer adding the column up by hand. Totals cover the rows shown,
                  which are the chosen crop and year. Over-delivery is not netted away: remaining is
                  floored per contract exactly as each row shows it, so the total can never be made to
                  look smaller by one contract that was over-delivered.
                  The average price and value use the position maths the Overview uses, over fully priced
                  contracts only; a half-priced contract has no final price to average yet. */}
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>Total for {selectedScopeLabel}</th>
                  <td className="align-right numeric" data-label="Bushels"><strong>{bushels.format(contractRows.reduce((sum, contract) => sum + contract.bushels, 0))}</strong></td>
                  <td className="align-right numeric" data-label="Average price">{contractPosition.finalBushels ? <><strong>{pricePerBu.format(contractPosition.finalRevenue / contractPosition.finalBushels)}</strong><small>avg on {displayBushels(contractPosition.finalBushels)} priced bu</small></> : "—"}</td>
                  <td data-label="Value">{contractPosition.finalBushels ? <><strong>{money.format(contractPosition.finalRevenue)}</strong><small>priced contracts</small></> : "—"}</td>
                  <td className="align-right numeric" data-label="Delivered">
                    {workspace.capabilities?.contract_deliveries ? (() => {
                      const deliveredTotal = contractRows.reduce((sum, contract) => sum + workspace.grain_contract_deliveries.filter((item) => item.grain_contract_id === contract.id).reduce((inner, item) => inner + item.bushels, 0), 0);
                      const remainingTotal = contractRows.reduce((sum, contract) => sum + Math.max(0, contract.bushels - workspace.grain_contract_deliveries.filter((item) => item.grain_contract_id === contract.id).reduce((inner, item) => inner + item.bushels, 0)), 0);
                      return <><strong>{displayBushels(deliveredTotal)} bu delivered</strong><small>{displayBushels(remainingTotal)} bu left</small></>;
                    })() : <strong>—</strong>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </section>
      )}
      {tabPath === "loads" && (
        <LoadsTab workspace={workspace} services={services} onSaved={refresh} />
      )}
      {tabPath === "storage" && storageTab}
      {tabPath === "" && <UsdaCalendar reports={workspace.usda_report_dates} timeZone={workspace.fields.farm.time_zone} />}
      <aside className="compliance-note">
        Farm Rx shows your numbers and your targets. It does not give marketing
        advice.
      </aside>
      {editingTarget && (
        <TargetEditor
          month={editingTarget.month}
          commodity={selectedScopeLabel}
          target={editingTarget.target}
          scope={selectedScope}
          services={services}
          workspace={workspace}
          error={planError}
          onClose={() => {
            setEditingTarget(null);
            setPlanError("");
          }}
          onSave={saveTarget}
          onRemove={editingTarget.target ? () => void removeTarget(editingTarget.target!) : undefined}
        />
      )}
    </section>
  );
}

export function MarketingAlerts({
  workspace,
  services,
  selectedEstimateId,
  onSelectEstimate,
  onSaved,
}: {
  workspace: GrainWorkspace;
  services: GrainServices;
  selectedEstimateId: string;
  onSelectEstimate: (id: string) => void;
  onSaved: () => Promise<void>;
}) {
  const [draftType, setDraftType] = useState<MarketingAlertRuleType | null>(
    null,
  );
  const alertLocks = useRef(createSubmitLockMap());
  const [editing, setEditing] = useState<MarketingAlertRule | null>(null);
  const [error, setError] = useState("");
  // The receipt of this section's last write: Saved, or Waiting for signal when it was kept on this device.
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const receipt = useSaveReceipt(receiptId);
  const selected =
    workspace.production_estimates.find(
      (estimate) => estimate.id === selectedEstimateId,
    ) ?? workspace.production_estimates[0];
  if (!selected) return null;
  const scope = scopeOf(selected);
  const commodity =
    workspace.fields.commodities.find((item) => item.id === scope.commodity_id)
      ?.name ?? scope.commodity_id;
  const currentPct = marketedPercent(workspace, scope);
  const rules = workspace.marketing_alert_rules.filter((rule) =>
    sameScope(rule, scope),
  );
  const otherRules = workspace.marketing_alert_rules.filter(
    (rule) =>
      !workspace.production_estimates.some((estimate) =>
        sameScope(estimate, rule),
      ),
  );
  const start = (type: MarketingAlertRuleType) => {
    setError("");
    setEditing(null);
    setDraftType(type);
  };
  const save = async (rule: MarketingAlertRule) => {
    const alertLock = alertLocks.current.get(rule.id);
    if (!alertLock.acquire()) return;
    let saved = false;
    try {
      setReceiptId(rule.id);
      await services.grainRepository.saveMarketingAlertRule(rule);
      saved = true;
      setError("");
      setDraftType(null);
      setEditing(null);
      await onSaved();
    } catch (caught) {
      const message = farmerError(caught, "save this alert");
      // The form shows a failed save next to its own button; once the form has closed, the section shows it.
      if (saved) setError(message);
      else {
        // One message only: the open form says it did not save, so the heading drops its Needs attention receipt.
        setReceiptId(null);
        throw new Error(message);
      }
    } finally {
      alertLock.release();
    }
  };
  const remove = async (id: string) => {
    const alertLock = alertLocks.current.get(id);
    if (!alertLock.acquire()) return;
    if (!(await confirmDialog({ title: "Delete this alert rule?", body: "You will stop getting this alert. Past notifications stay.", confirmLabel: "Delete rule", destructive: true }))) {
      alertLock.release();
      return;
    }
    try {
      setReceiptId(id);
      await services.grainRepository.deleteMarketingAlertRule(id);
      setError("");
      await onSaved();
    } catch (caught) {
      setError(farmerError(caught, "delete this alert"));
    } finally {
      alertLock.release();
    }
  };
  const toggle = async (rule: MarketingAlertRule) => {
    const alertLock = alertLocks.current.get(rule.id);
    if (!alertLock.acquire()) return;
    try {
      setReceiptId(rule.id);
      await services.grainRepository.saveMarketingAlertRule({
        ...rule,
        active: !rule.active,
        updated_at: new Date().toISOString(),
      });
      setError("");
      await onSaved();
    } catch (caught) {
      setError(farmerError(caught, "update this alert"));
    } finally {
      alertLock.release();
    }
  };
  return (
    <>
      <section className="grain-section alerts-card">
        <div className="section-heading">
          <div>
            <h2>Marketing alerts</h2>
            <p>
              Farm Rx checks these on the server about every 15 minutes, even
              when Grain is closed, and
              sends the alert to your phone, if you have turned notifications on.
              A USDA cash price can reach your target, but USDA prices never
              change your position or revenue numbers.
            </p>
            <SaveReceipt state={receipt} />
          </div>
          <label className="commodity-picker">
            <span>Commodity</span>
            <select
              value={selected.id}
              onChange={(event) => {
                setError("");
                onSelectEstimate(event.target.value);
              }}
            >
              {workspace.production_estimates.map((estimate) => (
                <option key={estimate.id} value={estimate.id}>
                  {scopeLabel(workspace, estimate)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="alert-template-row" aria-label="Alert templates">
          <button
            className="alert-template"
            type="button"
            onClick={() => start("price_target")}
          >
            <strong>Cash price target</strong>
            <span>Tell me when {commodity.toLowerCase()} hits my number</span>
          </button>
          <button
            className="alert-template"
            type="button"
            onClick={() => start("pct_marketed_goal")}
          >
            <strong>% marketed goal</strong>
            <span>Alert me while I've marketed less than my goal</span>
          </button>
          <button
            className="alert-template"
            type="button"
            onClick={() => start("deadline")}
          >
            <strong>Deadline</strong>
            <span>One reminder, a week ahead</span>
          </button>
        </div>
        {(draftType || editing) && (
          <AlertRuleForm
            key={`${editing?.id ?? "new"}:${editing?.rule_type ?? draftType}`}
            workspace={workspace}
            services={services}
            scope={scope}
            commodity={commodity}
            currentPct={currentPct}
            rule={editing}
            type={editing?.rule_type ?? draftType!}
            onCancel={() => {
              setEditing(null);
              setDraftType(null);
            }}
            onSave={save}
          />
        )}
        <div className="alert-rule-list">
          {rules.length ? (
            rules.map((rule) => (
              <article
                key={rule.id}
                className={`alert-rule${rule.active ? "" : " paused"}`}
              >
                <div>
                  <strong>{ruleSentence(rule, commodity)}</strong>
                  {rule.message && <span>{rule.message}</span>}
                  {rule.last_triggered_at && (
                    <small>
                      Last reached{" "}
                      {new Date(rule.last_triggered_at).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric" },
                      )}
                    </small>
                  )}
                </div>
                <div className="alert-rule-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => void toggle(rule)}
                  >
                    {rule.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    className="text-action"
                    type="button"
                    onClick={() => {
                      setError("");
                      setEditing(rule);
                      setDraftType(null);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="text-action danger-action"
                    type="button"
                    onClick={() => void remove(rule.id)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="alert-empty">
              No alerts for this commodity and crop year yet. Choose a template
              above.
            </p>
          )}
        </div>
        {error && (
          <p className="form-error grain-inline-error" role="alert">
            {error}
          </p>
        )}
        {otherRules.length > 0 && (
          <div className="alert-rule-list">
            <h3>Other alerts</h3>
            <p>
              These alerts do not have a production estimate in the picker, but
              you can still pause or delete them.
            </p>
            {otherRules.map((rule) => (
              <article
                key={rule.id}
                className={`alert-rule${rule.active ? "" : " paused"}`}
              >
                <div>
                  <strong>{scopeLabel(workspace, rule)}</strong>
                  <span>
                    {ruleSentence(
                      rule,
                      workspace.fields.commodities.find(
                        (item) => item.id === rule.commodity_id,
                      )?.name ?? rule.commodity_id,
                    )}
                  </span>
                </div>
                <div className="alert-rule-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => void toggle(rule)}
                  >
                    {rule.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    className="text-action danger-action"
                    type="button"
                    onClick={() => void remove(rule.id)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <AlertEmailSettings
        workspace={workspace}
        services={services}
        onSaved={onSaved}
      />
    </>
  );
}

export function FirmOffers({
  workspace,
  services,
  selectedEstimateId,
  onSelectEstimate,
  saleLimits,
  onSaved,
}: {
  workspace: GrainWorkspace;
  services: GrainServices;
  selectedEstimateId: string;
  onSelectEstimate: (id: string) => void;
  saleLimits: Record<string, number | null>;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<FirmOffer | null>(null);
  // The crop a new offer saves to, taken when Add (or Copy) is tapped, so moving the picker never moves a typed draft.
  const [addingScope, setAddingScope] = useState<PositionScope | null>(null);
  // An earlier offer the new-offer form starts from: Copy as new offer, or the bushels a partial fill left over.
  const [template, setTemplate] = useState<FirmOffer | null>(null);
  const [addCount, setAddCount] = useState(0);
  const [filling, setFilling] = useState<FirmOffer | null>(null);
  const [fillSaving, setFillSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const receipt = useSaveReceipt(receiptId);
  const formAnchor = useRef<HTMLDivElement>(null);
  const offerLocks = useRef(createSubmitLockMap());
  // The forms open above a long list: bring the one just opened into view.
  useEffect(() => {
    if (addingScope || editing || filling)
      formAnchor.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [addingScope, editing?.id, filling?.id]);
  const selected =
    workspace.production_estimates.find(
      (estimate) => estimate.id === selectedEstimateId,
    ) ?? workspace.production_estimates[0];
  if (!selected) return null;
  const scope = scopeOf(selected);
  const offers = workspace.firm_offers.filter((offer) =>
    sameScope(offer, scope),
  );
  const other = workspace.firm_offers.filter(
    (offer) =>
      !workspace.production_estimates.some((estimate) =>
        sameScope(estimate, offer),
      ),
  );
  // Only one form is open at a time, from either list.
  const closeForms = () => {
    setAddingScope(null);
    setEditing(null);
    setFilling(null);
    setTemplate(null);
    setError("");
    // A notice can point at the leftover-bushels form ("Save the form below"); it goes when the form does.
    setNotice("");
  };
  const openAdd = (from: PositionScope, start: FirmOffer | null = null) => {
    closeForms();
    setTemplate(start);
    setAddingScope(from);
    // A fresh form every time, even when the same offer is copied again or its leftover form is already open.
    setAddCount((count) => count + 1);
  };
  const openEdit = (offer: FirmOffer) => {
    closeForms();
    setEditing(offer);
  };
  const openFill = (offer: FirmOffer) => {
    closeForms();
    setFilling(offer);
  };
  const openCopy = (offer: FirmOffer) => openAdd(scopeOf(offer), offer);
  const save = async (offer: FirmOffer) => {
    const offerLock = offerLocks.current.get(offer.id);
    if (!offerLock.acquire()) return;
    let saved = false;
    try {
      setReceiptId(offer.id);
      await services.grainRepository.saveFirmOffer(offer);
      saved = true;
      setEditing(null);
      setAddingScope(null);
      setTemplate(null);
      setNotice("");
      setError("");
      await onSaved();
    } catch (caught) {
      const message = farmerError(caught, "save this firm offer");
      // The form shows a failed save next to its own button; once the form has closed, the section shows it.
      if (saved) setError(message);
      else {
        // One message only: the open form says it did not save, so the heading drops its Needs attention receipt.
        setReceiptId(null);
        throw new Error(message);
      }
    } finally {
      offerLock.release();
    }
  };
  const remove = async (id: string) => {
    const offerLock = offerLocks.current.get(id);
    if (!offerLock.acquire()) return;
    if (!(await confirmDialog({ title: "Delete this firm offer?", body: "Only your record of the offer is removed. Check with the buyer if it is still working at the elevator.", confirmLabel: "Delete offer", destructive: true }))) {
      offerLock.release();
      return;
    }
    try {
      setReceiptId(id);
      await services.grainRepository.deleteFirmOffer(id);
      setError("");
      await onSaved();
    } catch (caught) {
      setError(farmerError(caught, "delete this firm offer"));
    } finally {
      offerLock.release();
    }
  };
  const cancel = async (offer: FirmOffer) => {
    const offerLock = offerLocks.current.get(offer.id);
    if (!offerLock.acquire()) return;
    if (!(await confirmDialog({ title: "Mark this offer canceled?", body: "Do this after you cancel it with the buyer. It stops counting as pending bushels. You can copy it as a new offer later.", confirmLabel: "Mark canceled", cancelLabel: "Go back" }))) {
      offerLock.release();
      return;
    }
    try {
      setReceiptId(offer.id);
      await services.grainRepository.saveFirmOffer({
        ...offer,
        status: "canceled",
        filled_contract_id: null,
        updated_at: new Date().toISOString(),
      });
      setError("");
      await onSaved();
    } catch (caught) {
      setError(farmerError(caught, "cancel this firm offer"));
    } finally {
      offerLock.release();
    }
  };
  // A failed fill is thrown back to the fill form, which shows it under its Save button and stays open.
  // The fill is online only (the queued repository refuses it offline), so the notice follows a recorded sale.
  const finishFill = async (contract: GrainContract, offer: FirmOffer) => {
    const offerLock = offerLocks.current.get(offer.id);
    if (fillSaving || !offerLock.acquire()) return;
    setFillSaving(true);
    const filled = async () => {
      setFilling(null);
      setError("");
      // The whole offer is marked filled; bushels the buyer is still holding come back only if the farmer saves them as a new offer.
      const rest = Math.round((offer.bushels - contract.bushels) * 100) / 100;
      setNotice(
        rest > 0
          ? `Sale recorded as a contract and the offer to ${offer.buyer} is marked filled. Save the form below if the buyer is still holding the other ${displayBushels(rest)} bu.`
          : `Sale recorded as a contract and the offer to ${offer.buyer} is marked filled.`,
      );
      if (rest > 0) {
        setTemplate({ ...offer, bushels: rest });
        setAddingScope(scopeOf(offer));
      }
      try {
        await onSaved();
      } catch (caught) {
        setError(farmerError(caught, "reload your firm offers"));
      }
    };
    try {
      try {
        await services.grainRepository.fillFirmOffer(offer, contract);
      } catch (caught) {
        if (!(caught instanceof Error) || caught.message !== "FIRM_OFFER_FILL_RPC_UNAVAILABLE") throw caught;
        await fillFirmOfferFallback(
          services.grainRepository,
          offer,
          { ...contract, id: await firmOfferContractId(offer) },
        );
      }
      await filled();
    } finally {
      offerLock.release();
      setFillSaving(false);
    }
  };
  return (
    <section className="grain-section firm-offers-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Pending, not sold</span>
          <h2>Firm offers</h2>
          <p>
            Standing offers are shown separately from signed contracts until
            they fill.
          </p>
          <SaveReceipt state={receipt} />
        </div>
        <label className="commodity-picker">
          <span>Commodity</span>
          <select
            value={selected.id}
            onChange={(event) => {
              setError("");
              onSelectEstimate(event.target.value);
            }}
          >
            {workspace.production_estimates.map((estimate) => (
              <option key={estimate.id} value={estimate.id}>
                {scopeLabel(workspace, estimate)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {notice && (
        <p className="saved-whisper offer-notice" role="status">
          {notice}
        </p>
      )}
      {!addingScope && !editing && !filling && (
        <button
          className="primary-action"
          type="button"
          onClick={() => openAdd(scope)}
        >
          Add firm offer
        </button>
      )}
      <div ref={formAnchor} className="offer-form-anchor">
        {(addingScope || editing) && (
          <FirmOfferForm
            key={editing?.id ?? `new:${template?.id ?? ""}:${addCount}`}
            offer={editing}
            initial={editing ? null : template}
            scope={editing ? scopeOf(editing) : addingScope!}
            services={services}
            workspace={workspace}
            saleLimit={saleLimitForScope(saleLimits, editing ?? addingScope!)}
            onCancel={closeForms}
            onSave={save}
          />
        )}
        {filling && (
          <div className="offer-fill-entry">
            <h3>Record the filled sale</h3>
            <p>This creates the contract first, then marks the offer filled.</p>
            <ContractEntry
              workspace={workspace}
              scope={scopeOf(filling)}
              services={services}
              saleLimit={saleLimitForScope(saleLimits, filling)}
              initialOffer={filling}
              isSaving={fillSaving}
              onFilled={(contract) => finishFill(contract, filling)}
              onSaved={onSaved}
              onReceipt={() => undefined}
            />
            <button
              className="secondary-action"
              type="button"
              disabled={fillSaving}
              onClick={closeForms}
            >
              Close without saving
            </button>
          </div>
        )}
      </div>
      {offers.length === 0 && !addingScope && (
        <p className="alert-empty">
          No firm offers for this crop and year yet. Tap Add firm offer when a
          buyer gives you a price to hold.
        </p>
      )}
      <OfferList
        offers={offers}
        workspace={workspace}
        saleLimits={saleLimits}
        onEdit={openEdit}
        onCancel={cancel}
        onDelete={remove}
        onFill={openFill}
        onCopy={openCopy}
      />
      {other.length > 0 && (
        <div className="offer-list other-offers">
          <h3>Other firm offers</h3>
          <p>
            These offers do not have a production estimate in the picker, but
            you can still manage them.
          </p>
          <OfferList
            offers={other}
            workspace={workspace}
            saleLimits={saleLimits}
            onEdit={openEdit}
            onCancel={cancel}
            onDelete={remove}
            onFill={openFill}
            onCopy={openCopy}
          />
        </div>
      )}
      {error && (
        <p className="form-error grain-inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function OfferList({
  offers,
  workspace,
  saleLimits,
  onEdit,
  onCancel,
  onDelete,
  onFill,
  onCopy,
}: {
  offers: FirmOffer[];
  workspace: GrainWorkspace;
  saleLimits: Record<string, number | null>;
  onEdit: (offer: FirmOffer) => void;
  onCancel: (offer: FirmOffer) => void;
  onDelete: (id: string) => void;
  onFill: (offer: FirmOffer) => void;
  onCopy: (offer: FirmOffer) => void;
}) {
  const groups: FirmOfferStatus[] = ["open", "filled", "expired", "canceled"];
  const ordered = groups.map(
    (status) =>
      [
        status,
        offers.filter((offer) => displayFirmOfferStatus(offer) === status),
      ] as const,
  );
  return (
    <div className="offer-list">
      {ordered.map(([status, rows]) =>
        rows.length ? (
          <details key={status} open={status === "open"}>
            <summary>
              {status === "open"
                ? "Open offers"
                : `${status[0].toUpperCase()}${status.slice(1)} offers`}{" "}
              ({rows.length})
            </summary>
            {rows.map((offer) => {
              const displayed = displayFirmOfferStatus(offer);
              const commodity =
                workspace.fields.commodities.find(
                  (item) => item.id === offer.commodity_id,
                )?.name ?? offer.commodity_id;
              const value =
                offer.offer_type === "basis"
                  ? `${pricePerBu.format(offer.basis ?? 0)}/bu basis`
                  : `${pricePerBu.format(offer.price ?? 0)}/bu`;
              const offerSaleLimit = saleLimitForScope(saleLimits, offer);
              return (
                <article className="offer-row" key={offer.id}>
                  <div>
                    <strong>{offer.buyer}</strong>
                    <span>
                      {scopeLabel(workspace, offer)} ·{" "}
                      {offer.offer_type === "hta"
                        ? "HTA"
                        : offer.offer_type === "basis"
                          ? "Basis"
                          : "Cash"}{" "}
                      ·{" "}
                      <b className="numeric">
                        {bushels.format(offer.bushels)} bu
                      </b>{" "}
                      · <b className="numeric">{value}</b>
                    </span>
                    <small>
                      {commodity}
                      {offer.contract_month ? ` · ${offer.contract_month}` : ""}
                      {offer.delivery_location
                        ? ` · ${offer.delivery_location}`
                        : ""}
                      {offer.expires_on ? ` · expires ${offer.expires_on}` : ""}
                    </small>
                    {offer.notes && <small>{offer.notes}</small>}
                    <small>{offerSaleLimit === null ? "Set your own sale limit for this crop before treating it as a limit." : `Your sale limit: ${bushels.format(offerSaleLimit)} bu.`}</small>
                  </div>
                  <div className="offer-actions">
                    <span className={`status-chip ${displayed}`}>
                      {displayed}
                    </span>
                    {displayed === "open" && (
                      <>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => onFill(offer)}
                        >
                          Mark filled
                        </button>
                        <button
                          className="text-action"
                          type="button"
                          onClick={() => onEdit(offer)}
                        >
                          Edit
                        </button>
                        <button
                          className="text-action danger-action"
                          type="button"
                          onClick={() => void onCancel(offer)}
                        >
                          Mark canceled
                        </button>
                      </>
                    )}
                    {/* Past its date but still open on the farm record: a new expiry date renews it, and then it can be filled. */}
                    {displayed === "expired" && offer.status === "open" && (
                      <>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => onEdit(offer)}
                        >
                          Edit or renew
                        </button>
                        <small className="offer-kept-note">
                          Change the expiry date to renew it, then mark it filled.
                        </small>
                      </>
                    )}
                    {(displayed === "expired" || displayed === "canceled") && (
                      <button
                        className="text-action"
                        type="button"
                        onClick={() => onCopy(offer)}
                      >
                        Copy as new offer
                      </button>
                    )}
                    {displayed === "filled" ? (
                      <small className="offer-kept-note">
                        Kept for your records — linked to a contract.
                      </small>
                    ) : (
                      <button
                        className="text-action danger-action"
                        type="button"
                        onClick={() => void onDelete(offer.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </details>
        ) : null,
      )}
    </div>
  );
}

function FirmOfferForm({
  offer,
  initial = null,
  scope,
  services,
  workspace,
  saleLimit,
  onCancel,
  onSave,
}: {
  offer: FirmOffer | null;
  /** A new offer started from an earlier one. Its status, link and expiry date are not carried over. */
  initial?: FirmOffer | null;
  scope: PositionScope;
  services: GrainServices;
  workspace: GrainWorkspace;
  saleLimit: number | null;
  onCancel: () => void;
  onSave: (offer: FirmOffer) => Promise<void>;
}) {
  const start = offer ?? initial;
  const [buyer, setBuyer] = useState(start?.buyer ?? "");
  const [type, setType] = useState<FirmOfferType>(start?.offer_type ?? "cash");
  const [amount, setAmount] = useState(start?.bushels.toString() ?? "");
  const [price, setPrice] = useState(start?.price?.toString() ?? "");
  const [basis, setBasis] = useState(start?.basis?.toString() ?? "");
  const [month, setMonth] = useState(start?.contract_month ?? "");
  const [expires, setExpires] = useState(offer?.expires_on ?? "");
  const [location, setLocation] = useState(start?.delivery_location ?? "");
  const [notes, setNotes] = useState(start?.notes ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(createSubmitLock());
  // One id for this form, so a retry after an unclear failure updates the same offer instead of adding a second one.
  const [offerId] = useState(() => offer?.id ?? services.createGrainId());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!submitLock.current.acquire()) return;
    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const next: FirmOffer = {
        id: offerId,
        ...scope,
        buyer,
        offer_type: type,
        bushels: Number(amount),
        price: type === "basis" ? null : price === "" ? null : Number(price),
        basis: type === "basis" ? (basis === "" ? null : Number(basis)) : null,
        contract_month: month.trim() || null,
        expires_on: expires || null,
        delivery_location: location.trim() || null,
        notes: notes.trim() || null,
        status: offer?.status ?? "open",
        filled_contract_id: offer?.filled_contract_id ?? null,
        created_at: offer?.created_at ?? timestamp,
        updated_at: timestamp,
      };
      // Form-only checks on top of the database's own rules: a $0 price and a past expiry are almost always typing slips.
      // An expiry date the farmer did not change is left alone, so an old offer's note can still be edited.
      const errors = [
        ...(type !== "basis" && price !== "" && !(Number(price) > 0) ? ["Enter a price above $0.00."] : []),
        ...(expires && expires !== (offer?.expires_on ?? "") && expires < localCalendarDay(new Date()) ? ["The expiry date is in the past. Pick today or later, or leave it blank."] : []),
        ...validateFirmOffer(next),
      ];
      if (errors.length) {
        setError(errors.join(" "));
        return;
      }
      setError("");
      // Basis is typed in dollars; -35 is almost always "35 under" typed as cents. Ask, never convert.
      if (next.basis !== null && basisLooksLikeCents(next.basis) && !(await confirmDialog(basisCentsPrompt(next.basis)))) return;
      try {
        await onSave(next);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to save this firm offer.",
        );
      }
    } finally {
      submitLock.current.release();
      setSaving(false);
    }
  };
  const priceLabel =
    type === "basis"
      ? "Basis $/bu"
      : type === "hta"
        ? "Futures $/bu"
        : "Cash $/bu";
  const contracted = scopeRows(workspace.grain_contracts, scope).reduce((sum, item) => sum + item.bushels, 0);
  // Take this offer out only when it already counts as pending: an open offer past its date is counted nowhere.
  const otherPending = pendingFirmOfferBushels(workspace, scope) - (offer && displayFirmOfferStatus(offer) === "open" ? offer.bushels : 0);
  const saleLimitMessage = saleLimitWarning(saleLimit, contracted, otherPending, Number(amount), "save");
  // noValidate: the checks in submit say each problem in plain words next to Save, instead of the browser's own bubble.
  return (
    <form className="firm-offer-form" noValidate onSubmit={(event) => void submit(event)}>
      <div>
        <h3>{offer ? "Edit firm offer" : "New firm offer"}</h3>
        <p className="offer-form-scope">{scopeLabel(workspace, scope)}</p>
      </div>
      <label>
        Buyer
        <input
          required
          maxLength={200}
          value={buyer}
          onChange={(event) => setBuyer(event.target.value)}
        />
      </label>
      <label>
        Offer type
        <select
          value={type}
          onChange={(event) => setType(event.target.value as FirmOfferType)}
        >
          <option value="cash">Cash price</option>
          <option value="basis">Basis</option>
          <option value="hta">HTA</option>
        </select>
      </label>
      <label>
        Bushels
        <input
          required
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        {priceLabel}
        {/* Grain trades to the quarter cent, and a basis is often negative: the iOS decimal pad has no minus key. */}
        <input
          required
          type="number"
          min={type === "basis" ? undefined : "0.01"}
          step="any"
          inputMode={type === "basis" ? undefined : "decimal"}
          placeholder={type === "basis" ? "-0.35" : undefined}
          value={type === "basis" ? basis : price}
          onChange={(event) =>
            type === "basis"
              ? setBasis(event.target.value)
              : setPrice(event.target.value)
          }
        />
      </label>
      <label>
        {type === "cash" ? "Delivery month" : "Futures month"} <small>optional</small>
        <input
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        />
      </label>
      <label>
        Expires on <small>optional</small>
        <input
          type="date"
          min={offer ? undefined : localCalendarDay(new Date())}
          value={expires}
          onChange={(event) => setExpires(event.target.value)}
        />
      </label>
      <label>
        Delivery location <small>optional</small>
        <input
          maxLength={200}
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
      </label>
      <label className="offer-note">
        Note <small>optional</small>
        <textarea
          maxLength={4000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saleLimitMessage && (
        <p className="form-error" role="alert">
          {saleLimitMessage}
        </p>
      )}
      <div>
        <button className="primary-action" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save firm offer"}
        </button>
        <button className="text-action" type="button" onClick={onCancel}>
          Close without saving
        </button>
      </div>
    </form>
  );
}

function AlertRuleForm({
  workspace,
  services,
  scope,
  commodity,
  currentPct,
  rule,
  type,
  onCancel,
  onSave,
}: {
  workspace: GrainWorkspace;
  services: GrainServices;
  scope: PositionScope;
  commodity: string;
  currentPct: number;
  rule: MarketingAlertRule | null;
  type: MarketingAlertRuleType;
  onCancel: () => void;
  onSave: (rule: MarketingAlertRule) => Promise<void>;
}) {
  const [direction, setDirection] = useState<MarketingAlertRule["direction"]>(
    rule?.direction ?? "at_or_above",
  );
  const [threshold, setThreshold] = useState(rule?.threshold?.toString() ?? "");
  const [remindOn, setRemindOn] = useState(rule?.remind_on ?? "");
  const [message, setMessage] = useState(rule?.message ?? "");
  const [breakeven, setBreakeven] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(createSubmitLock());
  // One id for this form, so a double tap or a retry saves one rule instead of adding a second one.
  const [ruleId] = useState(() => rule?.id ?? services.createGrainId());
  const today = localCalendarDay(new Date());
  // The bid the server sweep would read right now: the newest cash bid in the last two days, from any elevator.
  const eligibleBid = type === "price_target" ? latestAlertEligibleCashBid(workspace, scope, today) : null;
  useEffect(() => {
    // A late answer for an earlier crop, or a failed lookup, never shows a break-even for the wrong crop.
    let live = true;
    setBreakeven(null);
    if (type === "price_target")
      services.profitabilityRepository
        .getBreakeven(scope, workspace.fields)
        .then((value) => { if (live) setBreakeven(value); })
        .catch(() => { if (live) setBreakeven(null); });
    return () => { live = false; };
  }, [
    type,
    services,
    scope.farm_id,
    scope.crop_year,
    scope.commodity_id,
    scope.operating_entity_id,
    scope.enterprise_label,
    workspace.fields,
  ]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (type === "deadline" && !remindOn) {
      setError("Pick a reminder date.");
      return;
    }
    // A reminder date in the past can never go off. A saved date the farmer did not change is left alone.
    if (type === "deadline" && remindOn < today && remindOn !== (rule?.remind_on ?? "")) {
      setError("Pick today or a later date.");
      return;
    }
    if (!submitLock.current.acquire()) return;
    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const next: MarketingAlertRule = {
        id: ruleId,
        ...scope,
        rule_type: type,
        direction: type === "price_target" ? direction : null,
        threshold: type === "deadline" ? null : Number(threshold),
        remind_on: type === "deadline" ? remindOn || null : null,
        message: message.trim() || null,
        active: rule?.active ?? true,
        last_triggered_at: rule?.last_triggered_at ?? null,
        created_at: rule?.created_at ?? timestamp,
        updated_at: timestamp,
      };
      // The form skips the browser's own English bubbles (noValidate), so a blank or out-of-range number is said here.
      const errors = validateMarketingAlertRule(next);
      if (errors.length) {
        setError(errors.join(" "));
        return;
      }
      setError("");
      try {
        await onSave(next);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Unable to save this alert.",
        );
      }
    } finally {
      submitLock.current.release();
      setSaving(false);
    }
  };
  return (
    <form className="alert-rule-form" noValidate onSubmit={(event) => void submit(event)}>
      <div>
        <h3>
          {rule
            ? "Edit alert"
            : `New ${type === "price_target" ? "cash price target" : type === "pct_marketed_goal" ? "% marketed goal" : "deadline"}`}
        </h3>
        <p>
          {scope.crop_year} {commodity}
        </p>
      </div>
      {type === "price_target" && (
        <>
          <label>
            When cash price is
            <select
              value={direction ?? "at_or_above"}
              onChange={(event) =>
                setDirection(
                  event.target.value as MarketingAlertRule["direction"],
                )
              }
            >
              <option value="at_or_above">At or above</option>
              <option value="at_or_below">At or below</option>
            </select>
          </label>
          <label>
            Cash price target ($/bu)
            {/* Bids trade to the quarter cent, so a target can too. */}
            <input
              required
              type="number"
              min="0.01"
              max="1000"
              step="any"
              inputMode="decimal"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
          </label>
          <p className="alert-fact">
            Checks the newest cash bid saved for this crop from today or the 2
            days before, from any elevator, including USDA bids. It does not
            watch futures or live elevator prices, so keep your bids up to date.
          </p>
          <p className="alert-fact">
            {eligibleBid
              ? `Bid it would use today: ${pricePerBu.format(eligibleBid.cash_price!)} from ${eligibleBid.elevator}, ${bidDate(eligibleBid.bid_date)}.`
              : `No bid for the ${scope.crop_year} crop from today or the 2 days before, so this alert cannot go off until a new bid is saved.`}
          </p>
          {breakeven !== null && (
            <p className="alert-fact">
              Your break-even: {money.format(breakeven)}/bu
            </p>
          )}
        </>
      )}
      {type === "pct_marketed_goal" && (
        <>
          <label>
            Marketed goal %
            <input
              required
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              inputMode="decimal"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
          </label>
          <p className="alert-fact">
            Currently {marketedPercentLabel(currentPct)}% marketed
          </p>
          {/* A paused rule never sends, and one that has already sent waits until the goal is reached first. */}
          {threshold !== "" && Number(threshold) > currentPct && (!rule || (rule.active && !rule.last_triggered_at)) && (
            <p className="alert-fact">
              You are below this goal now, so you will get one notification
              within about 15 minutes. After that it only notifies you again if
              you reach the goal and then drop below it. While you are below the
              goal it also shows in Grain alerts on this page.
            </p>
          )}
        </>
      )}
      {type === "deadline" && (
        <>
          <label>
            Reminder date
            <input
              required
              type="date"
              min={rule?.remind_on && rule.remind_on < today ? undefined : today}
              value={remindOn}
              onChange={(event) => setRemindOn(event.target.value)}
            />
          </label>
          <p className="alert-fact">
            You will get one notification 7 days before this date, or right away
            if it is less than 7 days off. It is not sent again on the day, but
            it can still show in Grain alerts on this page that week.
          </p>
        </>
      )}
      <label className="alert-note">
        Note <small>optional</small>
        <input
          maxLength={1000}
          value={message}
          placeholder={
            type === "deadline" ? "Crop insurance sales close" : "Add a note"
          }
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="alert-form-actions">
        <button className="primary-action" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save alert"}
        </button>
        <button className="text-action" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AlertEmailSettings({
  workspace,
  services,
  onSaved,
}: {
  workspace: GrainWorkspace;
  services: GrainServices;
  onSaved: () => Promise<void>;
}) {
  const [emails, setEmails] = useState(
    (workspace.grain_alert_settings?.alert_emails ?? []).join(", "),
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const submitLock = useRef(createSubmitLock());
  useEffect(
    () =>
      setEmails(
        (workspace.grain_alert_settings?.alert_emails ?? []).join(", "),
      ),
    [workspace.grain_alert_settings?.updated_at],
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const addresses = emails
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const settings: GrainAlertSettings = {
      farm_id: workspace.fields.farm.id,
      alert_emails: addresses,
      updated_at: new Date().toISOString(),
    };
    if (!submitLock.current.acquire()) return;
    try {
      await services.grainRepository.saveGrainAlertSettings(settings);
      setError("");
      setSaved("Saved");
      await onSaved();
    } catch (caught) {
      setError(farmerError(caught, "save these alert email addresses"));
    } finally {
      submitLock.current.release();
    }
  };
  return (
    <section className="grain-section alert-email-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Delivery</span>
          <h2>Email these alerts</h2>
          <p>
            Add up to three addresses. Emails go out while the farm owner has
            Grain open: plan targets, USDA report reminders, and marketing
            alerts reached then. Alerts the server finds while Grain is closed
            are never emailed; they show in Alerts, and also go to your phone
            if you have turned notifications on.
          </p>
        </div>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Email addresses <small>Separate addresses with commas.</small>
          <input
            value={emails}
            inputMode="email"
            placeholder="farmer@example.com, advisor@example.com"
            onChange={(event) => {
              setEmails(event.target.value);
              setSaved("");
            }}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button className="primary-action" type="submit">
            Save emails
          </button>
          {saved && (
            <span className="saved-whisper" role="status">
              {saved}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

/** GL-3: this was reachable only on a farm with no estimate at all, so a second crop could never be
 * added. It now lists the crop assignments that have no estimate yet, and renders compactly on the
 * Overview once the farm has its first one. The create path is unchanged. */
export function FirstEstimate({
  workspace,
  services,
  onSaved,
  onReceipt,
  receipt,
  compact = false,
}: {
  workspace: GrainWorkspace;
  services: GrainServices;
  onSaved: () => Promise<void>;
  onReceipt: (id: string) => void;
  receipt: ReturnType<typeof useSaveReceipt>;
  compact?: boolean;
}) {
  const assignments = workspace.fields.crop_assignments;
  // One expected yield per crop and year: corn and beans yield very differently, so a single shared box
  // would hand the second crop the first one's number.
  const [aph, setAph] = useState<Record<string, string>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const submitLock = useRef(createSubmitLock());
  if (!assignments.length)
    return compact ? null : (
      <section className="empty-state grain-empty-state">
        <h2>No crops to track yet</h2>
        <p>Grain starts from the crops you assign to fields. Add a crop to a field, then come back here.</p>
        <Link className="primary-action" to="/fields">Add crops in Fields</Link>
      </section>
    );
  // A crop that already has an estimate is not offered again; adding it twice would split one crop's
  // position across two rows.
  const covered = new Set(
    workspace.production_estimates.map(
      (estimate) => `${estimate.crop_year}|${estimate.commodity_id}`,
    ),
  );
  const grouped = new Map<string, (typeof assignments)[number]>();
  // Planted acres per crop and year, summed the same way the server derives an estimate's acres.
  const acresByKey = new Map<string, number>();
  for (const assignment of assignments) {
    const key = `${assignment.crop_year}|${assignment.commodity_id}`;
    acresByKey.set(key, (acresByKey.get(key) ?? 0) + (assignment.planted_acres ?? 0));
    if (!covered.has(key) && !grouped.has(key)) grouped.set(key, assignment);
  }
  if (compact && grouped.size === 0) return null;
  const create = async (assignment: (typeof assignments)[number]) => {
    const key = `${assignment.crop_year}|${assignment.commodity_id}`;
    const yieldValue = Number(aph[key] ?? "");
    if ((aph[key] ?? "").trim() === "" || !Number.isFinite(yieldValue) || yieldValue <= 0) {
      setCardErrors((current) => ({ ...current, [key]: "Enter an expected yield above zero." }));
      return;
    }
    if (!submitLock.current.acquire()) return;
    setCardErrors((current) => ({ ...current, [key]: "" }));
    const now = new Date().toISOString();
    const id = services.createGrainId();
    try {
      onReceipt(id);
      await services.grainRepository.saveProductionEstimate({
        id,
        farm_id: workspace.fields.farm.id,
        crop_year: assignment.crop_year,
        commodity_id: assignment.commodity_id,
        operating_entity_id: null,
        enterprise_label: null,
        planted_acres: null,
        aph_yield: yieldValue,
        expected_bushels: 0,
        actual_bushels: null,
        drives_math: "projected",
        notes: null,
        created_at: now,
        updated_at: now,
      });
      setError("");
      // GL-3a: clear the yield after a successful save. The compact card stays mounted while any crop
      // assignment still lacks an estimate, so a yield left behind would be ready to save again. A yield
      // drives the whole position, so a carried-over number is a wrong number, not a convenience. Each
      // crop now has its own box, and only the saved crop's box is cleared.
      setAph((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await onSaved();
    } catch (caught) {
      setError(farmerError(caught, "start this estimate"));
    } finally {
      submitLock.current.release();
    }
  };
  return (
    <section className={compact ? "grain-section add-crop-card" : "grain-section first-estimate"}>
      <div className="section-heading">
        <div>
          <h2>{compact ? "Add another crop" : "Start your grain estimate"}</h2>
          <p>
            {compact
              ? "These crops are not tracked in Grain yet. Enter an expected yield to add one."
              : "Enter each crop's expected yield to start tracking what you have sold."}
          </p>
        </div>
      </div>
      <SaveReceipt state={receipt} />
      <div className="position-grid">
        {[...grouped.values()].map((assignment) => {
          const key = `${assignment.crop_year}|${assignment.commodity_id}`;
          const acres = acresByKey.get(key) ?? 0;
          const yieldValue = Number(aph[key] ?? "");
          const validYield = (aph[key] ?? "").trim() !== "" && Number.isFinite(yieldValue) && yieldValue > 0;
          return (
            <article className="position-card first-estimate-card" key={key}>
              <h2>
                {workspace.fields.commodities.find(
                  (item) => item.id === assignment.commodity_id,
                )?.name ?? assignment.commodity_id}
              </h2>
              <p>
                {assignment.crop_year} crop · {acres.toLocaleString()} ac planted
              </p>
              <label>
                Expected yield (bu/ac)
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="any"
                  value={aph[key] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setAph((current) => ({ ...current, [key]: value }));
                    setCardErrors((current) => ({ ...current, [key]: "" }));
                  }}
                />
              </label>
              {validYield && acres > 0 && (
                <p className="numeric">About {bushels.format(acres * yieldValue)} bu expected</p>
              )}
              {cardErrors[key] && (
                <p className="form-error" role="alert">{cardErrors[key]}</p>
              )}
              <button
                className="primary-action"
                type="button"
                onClick={() => void create(assignment)}
              >
                Create estimate
              </button>
            </article>
          );
        })}
      </div>
      {error && (
        <p className="form-error grain-inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function PositionCard({
  estimate,
  workspace,
  services,
  saleLimit,
  saleLimitPersisted = false,
  saleLimitError = "",
  onSaleLimitChange,
  onSaleLimitCommit,
  onSaved,
  onReceipt,
}: {
  estimate: ProductionEstimate;
  workspace: GrainWorkspace;
  services: GrainServices;
  saleLimit: number | null;
  saleLimitPersisted?: boolean;
  saleLimitError?: string;
  onSaleLimitChange: (limit: number | null) => void;
  onSaleLimitCommit?: () => void;
  onSaved: () => Promise<void>;
  onReceipt: (id: string) => void;
}) {
  const [aph, setAph] = useState(String(estimate.aph_yield));
  const [actual, setActual] = useState(
    estimate.actual_bushels?.toString() ?? "",
  );
  // GL-3: React-controlled, not a bare <details>. The card re-renders whenever the breakeven and
  // profitability reads resolve, and an uncontrolled disclosure can lose the farmer's open state to one
  // of those renders mid-read.
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState("");
  const submitLock = useRef(createSubmitLock());
  // The queued repository publishes each production save's receipt under the estimate's own id, so the
  // card can say Saving / Saved for its own saves without the page-level receipt.
  const cardReceipt = useSaveReceipt(estimate.id);
  // "Edit yield" and the Actual button open More details and then put the cursor in the box they need.
  const yieldInputRef = useRef<HTMLInputElement>(null);
  const actualInputRef = useRef<HTMLInputElement>(null);
  const [focusTarget, setFocusTarget] = useState<"yield" | "actual" | null>(null);
  useEffect(() => {
    if (!showMore || !focusTarget) return;
    (focusTarget === "yield" ? yieldInputRef : actualInputRef).current?.focus();
    setFocusTarget(null);
  }, [showMore, focusTarget]);
  // Until the profitability read settles, "no coverage" cannot be told apart from "not loaded yet".
  const [coverageChecked, setCoverageChecked] = useState(false);
  const [breakeven, setBreakeven] = useState<number | null>(null);
  const [rpMarketingEstimate, setRpMarketingEstimate] = useState<
    { bushels: number; guaranteedBushels: number } | { ambiguous: true } | null
  >(null);
  const [savedCoverageBlocked, setSavedCoverageBlocked] = useState(false);
  const scope = scopeOf(estimate);
  useEffect(() => {
    void services.profitabilityRepository
      .getBreakeven(scope, workspace.fields)
      .then(setBreakeven);
  }, [
    services,
    scope.farm_id,
    scope.crop_year,
    scope.commodity_id,
    scope.operating_entity_id,
    scope.enterprise_label,
    workspace.fields,
  ]);
  const commodity = workspace.fields.commodities.find(
    (item) => item.id === scope.commodity_id,
  )!;
  const production = activeProduction(estimate);
  const contracts = scopeRows(workspace.grain_contracts, scope);
  const basis = latestBasis(workspace, scope);
  const plannedPrice = manualPlannedPrice(workspace, scope);
  // Cash targets are all-in; no inferred premium is added to target revenue.
  const position = calculateGrainPosition(production, contracts, basis, plannedPrice);
  const { basisOpen, futuresOpen, finalBushels, partiallyPricedBushels, outrightOpen, finalRevenue, plannedRevenue } = position;
  const average = finalBushels ? finalRevenue / finalBushels : null;
  const pricedPct = production ? (finalBushels / production) * 100 : 0;
  // LD-3: this card is already one commodity in one crop year, which is exactly a lot. Carry-over
  // grain of the same commodity belongs to a different card and is deliberately not counted here.
  const committedFree = deriveCommittedFreeLot(workspace, estimate.commodity_id, estimate.crop_year);
  const insurance = scopeRows(workspace.insurance_units, scope);
  const insuranceUnitEstimate = insurance.reduce(
    (sum, unit) =>
      sum + (unit.insured_acres * unit.aph * unit.coverage_level_pct) / 100,
    0,
  );
  const pendingOffers = pendingFirmOfferBushels(workspace, scope);
  const insuredAcres = insurance.reduce(
    (sum, unit) => sum + unit.insured_acres,
    0,
  );
  const minRevenue = insuredAcres
    ? insurance.reduce(
        (sum, unit) =>
          sum + unit.revenue_guarantee_per_acre * unit.insured_acres,
        0,
      ) / insuredAcres
    : null;
  const insuranceFloor = insurance.length
    ? insurance.reduce(
        (sum, unit) => sum + unit.guarantee_per_bu * unit.insured_acres,
        0,
      ) / insuredAcres
    : null;
  const contractedBushels = contracts.reduce(
    (sum, contract) => sum + contract.bushels,
    0,
  );
  const matchingAssignments = workspace.fields.crop_assignments.filter((assignment) => assignment.crop_year === scope.crop_year && assignment.commodity_id === scope.commodity_id && (scope.operating_entity_id === null || workspace.fields.fields.some((field) => field.id === assignment.field_id && field.operating_entity_id === scope.operating_entity_id)));
  const harvestActual = matchingAssignments.reduce((sum, assignment) => sum + (assignment.harvested_bushels ?? 0), 0);
  // LD-2: load tickets never write harvested_bushels; adopting their total is one explicit "Use load
  // total" on Harvest. So the figure is shown here for the farmer to act on there, and is never added
  // into the harvest total this card offers to write as the Grain actual.
  const fromLoads = matchingAssignments.reduce((sum, assignment) => sum + harvestBushelsFromLoads(workspace.grain_loads, assignment.id), 0);
  const binBalance = deriveCommodityBinTotal(workspace.grain_bins, workspace.bin_inventory, workspace.bin_transactions, scope.commodity_id);
  useEffect(() => {
    let active = true;
    setRpMarketingEstimate(null);
    setCoverageChecked(false);
    setSavedCoverageBlocked(hasUnsupportedSavedCoverage(insurance, []));
    void services.profitabilityRepository
      .getWorkspace()
      .then((profitability) => {
        const matchingBudgets = profitability.budgets.filter((item) =>
          sameScope(item, scope),
        );
        if (hasUnsupportedSavedCoverage(insurance, matchingBudgets.map((budget) => budget.rp_coverage_pct))) {
          if (active) { setSavedCoverageBlocked(true); setCoverageChecked(true); }
          return;
        }
        const allocationOwners = new Map<string, string>();
        let ambiguous = false;
        for (const budget of matchingBudgets)
          for (const allocation of profitability.allocations.filter(
            (item) => item.budget_id === budget.id && item.allocated_acres > 0,
          )) {
            const owner = allocationOwners.get(allocation.crop_assignment_id);
            if (owner !== undefined && owner !== budget.id) ambiguous = true;
            allocationOwners.set(allocation.crop_assignment_id, budget.id);
          }
        const enteredCoverageBudgets = matchingBudgets.filter(
          hasCompleteRevenueProtection,
        );
        let guaranteedBushels = 0;
        let hasAllocation = false;
        for (const budget of enteredCoverageBudgets) {
          if (budget.rp_aph_yield === null || budget.rp_coverage_pct === null)
            continue;
          for (const allocation of profitability.allocations.filter(
            (item) => item.budget_id === budget.id && item.allocated_acres > 0,
          )) {
            guaranteedBushels +=
              ((budget.rp_aph_yield * budget.rp_coverage_pct) / 100) *
              allocation.allocated_acres;
            hasAllocation = true;
          }
        }
        if (!active) return;
        setCoverageChecked(true);
        if (!hasAllocation) return;
        if (ambiguous) {
          setRpMarketingEstimate({ ambiguous: true });
          return;
        }
        setRpMarketingEstimate({
          guaranteedBushels,
          bushels: guaranteedBushels,
        });
      })
      .catch(() => {
        /* Grain remains usable when the private profitability workspace cannot be read. */
        if (active) setCoverageChecked(true);
      });
    return () => {
      active = false;
    };
  }, [
    services,
    scope.farm_id,
    scope.crop_year,
    scope.commodity_id,
    scope.operating_entity_id,
    scope.enterprise_label,
    contractedBushels,
  ]);
  const rpAmbiguous =
    rpMarketingEstimate !== null && "ambiguous" in rpMarketingEstimate;
  const rpBushels =
    rpMarketingEstimate !== null && !rpAmbiguous ? rpMarketingEstimate.bushels : null;
  // No insurance unit and no Revenue Protection coverage on a budget: there is no guarantee to show, and
  // "0 bu" would read as "no room left to sell". The sale-limit figures below are not affected.
  const noCoverage = !savedCoverageBlocked && insurance.length === 0 && rpBushels === null && !rpAmbiguous;
  const noCoverageNote = "Add Revenue Protection coverage to this crop's budget in Profitability to see this.";
  const insuranceEstimate = savedCoverageBlocked || noCoverage ? null : rpBushels ?? insuranceUnitEstimate;
  const remainingEstimate = insuranceEstimate === null ? null : remainingMarketingCapacity(insuranceEstimate, contractedBushels, pendingOffers);
  const coverageValue = (value: number | null) => savedCoverageBlocked ? "Blocked" : !coverageChecked ? "Checking…" : noCoverage || value === null ? "Not entered" : `${bushels.format(value)} bu`;
  const remainingSaleLimit = saleLimit === null ? null : Math.max(0, saleLimit - contractedBushels - pendingOffers);
  const estimateNote = savedCoverageBlocked
    ? unsupportedCoverageMessage
    : noCoverage
    ? noCoverageNote
    : rpAmbiguous
    ? "RP estimate not shown: a field is allocated to more than one budget; using insurance units."
    : rpMarketingEstimate !== null && !rpAmbiguous
      ? `From entered coverage: ${bushels.format(rpMarketingEstimate.guaranteedBushels)} bu.`
      : minRevenue === null
        ? "No insurance unit."
        : `${money.format(minRevenue)}/ac minimum revenue.`;
  const saveProduction = async (input: ProductionEstimate) => {
    // A blank yield box would be sent as 0 and refused; say so here, beside the box, instead.
    if (!Number.isFinite(input.aph_yield) || input.aph_yield <= 0) {
      setError("Enter an expected yield above zero (bu/ac).");
      setShowMore(true);
      setFocusTarget("yield");
      return;
    }
    if (!submitLock.current.acquire()) return;
    try {
      await services.grainRepository.saveProductionEstimate(input);
      setError("");
      await onSaved();
    } catch (exception) {
      setError(farmerError(exception, "save production"));
    } finally {
      submitLock.current.release();
    }
  };
  const reconcileHarvest = async () => {
    if (!submitLock.current.acquire()) return;
    if (!(await confirmDialog({ title: "Use the harvest total as Grain actual?", body: "This changes Grain actual only; it does not change bins.", confirmLabel: "Use harvest total" }))) {
      submitLock.current.release();
      return;
    }
    try {
      onReceipt(estimate.id);
      await services.grainRepository.reconcileHarvestActual(estimate, harvestActual);
      setActual(String(harvestActual));
      setError("");
      await onSaved();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Unable to reconcile the harvest total.");
    } finally {
      submitLock.current.release();
    }
  };
  // The crop year (and the entity or enterprise, when the estimate is kept for one) is what tells two
  // cards of the same commodity apart; the crop family only repeated the name below it.
  const scopeName = scope.enterprise_label ?? (scope.operating_entity_id === null ? null : workspace.fields.entities.find((item) => item.id === scope.operating_entity_id)?.name ?? null);
  const lotGap = lotGapText(workspace, estimate.commodity_id, estimate.crop_year, committedFree.free);
  // HTAs are valued at the latest farmer-entered basis, which is $0 until a local bid exists.
  const hasManualBid = workspace.cash_bids.some((bid) => !isMarsBid(bid) && bid.farm_id === scope.farm_id && bid.commodity_id === scope.commodity_id);
  const htaOpen = basisOpen.length > 0;
  return (
    <article className="position-card">
      <div className="position-top">
        <div>
          <span className="eyebrow">
            {estimate.crop_year} crop{scopeName ? ` · ${scopeName}` : ""}
          </span>
          <h2>{commodity.name}</h2>
        </div>
        <div className="position-top-actions">
        <div
          className="math-toggle"
          role="group"
          aria-label={`${commodity.name} production basis`}
        >
          <button
            type="button"
            className={estimate.drives_math === "projected" ? "active" : ""}
            onClick={() => void saveProduction(buildProductionSaveInput(estimate, aph, actual, "projected"))}
          >
            Projected
          </button>
          <button
            type="button"
            className={estimate.drives_math === "actual" ? "active" : ""}
            onClick={() => {
              // Not greyed out with no reason: with no actual bushels saved yet, the tap says what to do and
              // opens the box to do it in. Nothing is saved.
              if (estimate.actual_bushels === null) {
                setShowMore(true);
                setError("Enter actual bushels in More details and tap Save production. Then tap Actual.");
                setFocusTarget("actual");
                return;
              }
              void saveProduction(buildProductionSaveInput(estimate, aph, actual, "actual"));
            }}
          >
            Actual
          </button>
        </div>
        {!showMore && <SaveReceipt state={cardReceipt} />}
        </div>
      </div>
      {/* GL-3: the card opened with a paragraph and nine numbers. It now leads with one line and three
          tiles; everything else is still here, one tap away, and nothing was removed. */}
      <p className="position-hero">
        <strong>{Math.round(pricedPct)}% priced</strong>
        {average === null ? "" : ` at ${money.format(average)} average`} ·{" "}
        <strong>{bushels.format(outrightOpen)} bu</strong> still unpriced
      </p>
      {/* LD-3: what is actually in the bins for THIS crop year, against what is still owed on this
          crop year's contracts. A line rather than a fourth tile, because GL-3 settled this card at
          one hero line and three tiles and that shape is worth keeping. Carry-over grain of the same
          commodity is a different lot and is deliberately not counted here. */}
      <p className="position-committed-free">
        <span className="numeric">{bushels.format(committedFree.onHand)} bu</span> of the {estimate.crop_year} crop stored
        {" · "}
        {committedFree.committed > 0.000001
          ? <><span className="numeric">{bushels.format(committedFree.committed)} bu</span> committed</>
          : "nothing committed"}
        {" · "}
        {lotGap
          ? <strong className={lotGap.short ? "committed-free-short" : undefined}>{lotGap.text}</strong>
          : <strong>{bushels.format(committedFree.free)} bu free</strong>}
      </p>
      <div className="position-stats position-tiles">
        <Metric
          label="Fully priced"
          value={`${bushels.format(finalBushels)} bu`}
          note={`${Math.round(pricedPct)}%`}
        />
        <Metric
          label="Partly priced"
          value={`${bushels.format(partiallyPricedBushels)} bu`}
          note="basis or futures still open"
        />
        <Metric
          label="Planned revenue"
          value={plannedRevenue === null ? "—" : money.format(plannedRevenue)}
          note={
            plannedRevenue === null
              ? "add a cash price target"
              : htaOpen && !hasManualBid
                ? "HTAs counted at $0 basis until you enter a local bid on Bins & basis"
                : "priced contracts as signed; HTAs at your latest basis; basis contracts and unpriced grain at your target"
          }
        />
      </div>
      <div className="position-more">
        <button
          type="button"
          className="position-more-toggle"
          aria-expanded={showMore}
          onClick={() => setShowMore((value) => !value)}
        >
          {showMore ? "Hide details" : "More details"}
        </button>
        {showMore && (
        <div className="position-more-body">
        <p className="position-sentence">
          {Math.round(pricedPct)}% fully priced at{" "}
          {average === null ? "—" : money.format(average)} avg. Breakeven{" "}
          {breakeven === null ? "—" : money.format(breakeven)}.{" "}
          {bushels.format(
            basisOpen.reduce((sum, contract) => sum + contract.bushels, 0),
          )}{" "}
          bu basis open and{" "}
          {bushels.format(
            futuresOpen.reduce((sum, contract) => sum + contract.bushels, 0),
          )}{" "}
          bu futures open. {bushels.format(outrightOpen)} bu unpriced
          {plannedPrice === null
            ? ". Add a cash price target to estimate it."
            : ` using your cash price target of ${money.format(plannedPrice)}.`}
        </p>
        <section className="grain-reconciliation"><h3>Harvest reconciliation</h3><p>Harvest actuals: <strong>{bushels.format(harvestActual)} bu</strong> · Grain actual production: <strong>{estimate.actual_bushels === null ? "not entered" : `${bushels.format(estimate.actual_bushels)} bu`}</strong> · <strong>All bins holding {commodity.name} (whole farm, all years): {bushels.format(binBalance)} bu</strong>.</p><p>{estimate.actual_bushels === null ? "Grain actual has not been entered. Bins are never changed by this action." : `Harvest minus Grain actual: ${bushels.format(harvestActual - estimate.actual_bushels)} bu. ${HARVEST_RECONCILIATION_SCOPE_SUPPRESSION_COPY}`}</p>{fromLoads > 0 && <p>Load tickets: at least <strong>{bushels.format(fromLoads)} bu</strong>. To count them as harvest, use &lsquo;Use load total&rsquo; on the Harvest page first. <NavLink to="/harvest" className="text-action">Open Harvest</NavLink></p>}<button className="secondary-action" type="button" disabled={harvestActual <= 0} onClick={() => { void reconcileHarvest() }}>Use harvest total as Grain actual</button>{harvestActual <= 0 && <small>No harvest total entered yet on Harvest.</small>}</section>
        <div className="position-stats">
          <Metric
            label="Insurance floor estimate"
            value={coverageValue(insuranceEstimate)}
            note={estimateNote}
          />
        </div>
        <p className="insurance-limit-note">
          Revenue Protection pays money, not bushels — enterprise averaging, basis,
          premiums, and your share can leave you exposed.
        </p>
        <div className="production-editor sale-limit-editor">
          <label>
            Your sale limit (bushels)
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={saleLimit ?? ""}
              onChange={(event) => {
                const value = event.target.value.trim();
                onSaleLimitChange(value === "" ? null : Number(value));
              }}
              onBlur={() => onSaleLimitCommit?.()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSaleLimitCommit?.();
                }
              }}
            />
            <small>{saleLimitPersisted ? "Saves for this farm when you leave this box. It is your limit, not an insurance guarantee." : "Used only in this open session; it is your limit, not an insurance guarantee."}</small>
            {saleLimitError && <p className="form-error" role="alert">{saleLimitError}</p>}
          </label>
          <Metric label="Insurance estimate guarantee" value={coverageValue(insuranceEstimate)} note={estimateNote} />
          <Metric label="Already contracted" value={`${bushels.format(contractedBushels)} bu`} note="Signed contracts" />
          <Metric label="Pending offers" value={`${bushels.format(pendingOffers)} bu`} note="Open firm offers; not sold yet" />
          <Metric label="Insurance estimate remaining" value={coverageValue(remainingEstimate)} note={savedCoverageBlocked ? unsupportedCoverageMessage : noCoverage ? noCoverageNote : "Guarantee − contracted − pending; never below zero"} />
          <Metric label="Your sale limit remaining" value={remainingSaleLimit === null ? "Set your own sale limit" : `${bushels.format(remainingSaleLimit)} bu`} note={saleLimit === null ? "Set your own sale limit to plan sales." : `${bushels.format(saleLimit)} limit − contracted − pending`} />
        </div>
        {pendingOffers > 0 && (
          <p className="pending-offer-line">
            <b className="numeric">{bushels.format(pendingOffers)} bu</b> on firm
            offer — pending, not sold.
          </p>
        )}
        <div className="production-editor">
          <label>
            Planted acres
            <strong>
              {estimate.planted_acres === null
                ? "—"
                : `${estimate.planted_acres.toLocaleString()} ac`}
            </strong>
          </label>
          <label>
            Expected yield (bu/ac)
            <input
              ref={yieldInputRef}
              type="number"
              inputMode="decimal"
              min="0.01"
              step="any"
              value={aph}
              onChange={(event) => setAph(event.target.value)}
            />
          </label>
          <label>
            Actual bushels
            <input
              ref={actualInputRef}
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={actual}
              placeholder="Enter at harvest"
              onChange={(event) => setActual(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-action"
            onClick={() => void saveProduction(buildProductionSaveInput(estimate, aph, actual))}
          >
            Save production
          </button>
          <SaveReceipt state={cardReceipt} />
        </div>
        </div>
        )}
      </div>
      {error && (
        <p className="form-error grain-inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="position-foot">
        <span>
          {estimate.drives_math === "actual" ? "Actual" : "Projected"}{" "}
          production: <strong>{bushels.format(production)} bu</strong>{" "}
          <button
            type="button"
            className="text-action"
            onClick={() => {
              setShowMore(true);
              setFocusTarget("yield");
            }}
          >
            Edit yield
          </button>
        </span>
        <span>
          {plannedPrice === null ? (
            "No cash price target yet"
          ) : (
            <>
              Cash price target <strong>{money.format(plannedPrice)}</strong>
            </>
          )}
          {insuranceFloor !== null && (
            <> · insurance floor {money.format(insuranceFloor)}</>
          )}
        </span>
      </div>
    </article>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong className="numeric">{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function PlanStatus({
  estimate,
  workspace,
}: {
  estimate: ProductionEstimate;
  workspace: GrainWorkspace;
}) {
  const scope = scopeOf(estimate);
  const production = activeProduction(estimate);
  // The farm's day, not the device's, so the figure matches Today's grain line across a month boundary. The year is
  // kept, so a plan that crosses New Year counts the right months.
  const today = planDateFor(new Date(), workspace.fields.farm.time_zone);
  const targets = scopeRows(workspace.marketing_plan_targets, scope);
  const targetPct = plannedPercentThroughDate(targets, today);
  const contracted = scopeRows(workspace.grain_contracts, scope).reduce(
    (total, contract) => total + contract.bushels,
    0,
  );
  const actualPct = production ? (contracted / production) * 100 : 0;
  const status =
    targets.length === 0
      ? "Not started"
      : actualPct >= targetPct
        ? "On Track"
        : "Behind";
  const totalPlanned = targets.reduce(
    (total, target) => total + target.target_pct_of_production,
    0,
  );
  // This crop year's lot only: carry-over of the same commodity is a different lot and is not under this plan.
  // (deriveCommodityBinTotal sums every crop year in every bin, which is right for the whole-farm figures elsewhere.)
  const inBins = deriveCommittedFreeLot(workspace, scope.commodity_id, scope.crop_year).onHand;
  const wholeFarmBins =
    scope.operating_entity_id !== null || scope.enterprise_label !== null;
  const unplanned = Math.round(100 - totalPlanned);
  return (
    <div className="plan-status">
      <div>
        <span>Plan progress through {monthLabel(today)}</span>
        <strong>{Math.round(actualPct)}% of the crop contracted</strong>
        <span>Your plan calls for {Math.round(targetPct)}% by {monthLabel(today)}</span>
        {unplanned > 0 && <span>{unplanned}% of the crop isn&rsquo;t in any month of the plan yet</span>}
        <small className="numeric">
          {bushels.format(inBins)} bu of the {scope.crop_year} crop in bins
          {wholeFarmBins ? " (whole farm)" : ""}
        </small>
      </div>
      <span
        className={`status-chip ${status === "On Track" ? "on-track" : status === "Behind" ? "behind" : "not-started"}`}
      >
        {status}
      </span>
    </div>
  );
}

function ActualVsPlan({
  estimate,
  workspace,
}: {
  estimate: ProductionEstimate;
  workspace: GrainWorkspace;
}) {
  const scope = scopeOf(estimate);
  const production = activeProduction(estimate);
  const targets = scopeRows(workspace.marketing_plan_targets, scope).sort(
    (left, right) => left.target_month.localeCompare(right.target_month),
  );
  const sold = scopeRows(workspace.grain_contracts, scope).reduce(
    (sum, contract) => sum + contract.bushels,
    0,
  );
  let cumulative = 0;
  return (
    <section className="grain-section actual-plan-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Follow-through</span>
          <h2>Actual vs. plan</h2>
          <p>Your plan by month, with what you have contracted so far.</p>
        </div>
      </div>
      <div
        className="progress-track"
        aria-label={`${Math.round(production ? (sold / production) * 100 : 0)} percent contracted`}
      >
        <span
          style={{
            width: `${Math.min(100, production ? (sold / production) * 100 : 0)}%`,
          }}
        />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th className="align-right">Plan %</th>
              <th className="align-right">Plan bu</th>
              <th className="align-right">Cumulative plan</th>
            </tr>
          </thead>
          <tbody>
            {targets.length ? (
              targets.map((target) => {
                cumulative += target.target_pct_of_production;
                return (
                  <tr key={target.id}>
                    <td>{monthLabel(target.target_month)}</td>
                    <td className="align-right numeric">
                      {target.target_pct_of_production}%
                    </td>
                    <td className="align-right numeric">
                      {bushels.format(
                        (production * target.target_pct_of_production) / 100,
                      )}
                    </td>
                    <td className="align-right numeric">{cumulative}%</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4}>
                  No plan yet. Choose a template or tap a month to start.
                </td>
              </tr>
            )}
          </tbody>
          {/* Contracts carry no sale date (created_at is when the record was typed), so sales cannot be
              split by month honestly. The contracted total is shown once, against the whole plan. */}
          {targets.length > 0 && (
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>Contracted so far</th>
                <td className="align-right numeric">
                  <strong>
                    {bushels.format(sold)} bu ({Math.round(production ? (sold / production) * 100 : 0)}%)
                  </strong>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

export function ContractEntry({
  workspace,
  scope,
  services,
  onSaved,
  initialOffer,
  onFilled,
  isSaving = false,
  saleLimit,
  onReceipt,
}: {
  workspace: GrainWorkspace;
  scope: PositionScope;
  services: GrainServices;
  onSaved: () => Promise<void>;
  initialOffer?: FirmOffer;
  onFilled?: (contract: GrainContract) => Promise<void>;
  isSaving?: boolean;
  saleLimit: number | null;
  onReceipt: (id: string) => void;
}) {
  // GL-3: suggestions, not the only options. Existing contract buyers count too, so the second sale to
  // a buyer never has to be retyped from scratch.
  const buyers = knownCounterparties(workspace, [initialOffer?.buyer]);
  const preset = initialOffer
    ? offerToContract(
        initialOffer,
        "00000000-0000-4000-8000-000000000000",
        new Date().toISOString(),
      )
    : null;
  const [buyer, setBuyer] = useState(initialOffer?.buyer ?? "");
  const [type, setType] = useState<GrainContractType>(
    preset?.contract_type ?? "forward_cash",
  );
  const [bushelCount, setBushelCount] = useState(
    initialOffer?.bushels.toString() ?? "",
  );
  const [price, setPrice] = useState(
    (preset?.cash_price ?? preset?.futures_price)?.toString() ?? "",
  );
  const [basis, setBasis] = useState(preset?.basis?.toString() ?? "");
  // No made-up delivery window: a contract the farmer never dated is saved undated and the table shows
  // "—", instead of a hidden Sep 1 - Nov 30 that then reads as a date somebody agreed to.
  const [start, setStart] = useState(preset?.delivery_start ?? "");
  const [end, setEnd] = useState(preset?.delivery_end ?? "");
  const [number, setNumber] = useState("");
  const [premium, setPremium] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Controlled, so a problem with a field inside it (a delivery date, the premium) can open it to show
  // that field rather than reporting a box the farmer cannot see.
  const [detailsOpen, setDetailsOpen] = useState(!!initialOffer);
  const submitLock = useRef(createSubmitLock());
  const contracted = scopeRows(workspace.grain_contracts, scope).reduce((sum, item) => sum + item.bushels, 0);
  const pending = pendingFirmOfferBushels(workspace, scope);
  const proposedBushels = Number(bushelCount);
  const pendingBeforeProposal = pending - (initialOffer ? initialOffer.bushels : 0);
  const saleLimitMessage = saleLimitWarning(saleLimit, contracted, pendingBeforeProposal, proposedBushels, "record");
  // Filling part of an offer still marks the whole offer filled; FirmOffers then opens a new offer
  // for the rest, which counts as pending only once the farmer saves it.
  const offerLeftover = initialOffer && Number.isFinite(proposedBushels) && proposedBushels > 0 && proposedBushels < initialOffer.bushels
    ? Math.round((initialOffer.bushels - proposedBushels) * 100) / 100
    : 0;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving || submitting || !submitLock.current.acquire()) return;
    try {
      const timestamp = new Date().toISOString();
      const draft: Omit<GrainContract, "id"> = {
      ...scope,
      contract_type: type,
      buyer,
      bushels: Number(bushelCount),
      cash_price:
        type === "cash_spot" || type === "forward_cash" ? Number(price) : null,
      futures_price: type === "hta" ? Number(price) : null,
      basis: type === "basis" ? Number(basis) : null,
      delivery_start: start || null,
      delivery_end: end || null,
      contract_number: number || null,
      premium_cents_per_bu: premium === "" ? 0 : Number(premium),
      notes: null,
      created_at: timestamp,
      updated_at: timestamp,
      };
      // Every check runs before an id is taken: a refused or abandoned contract must not spend one
      // from the shared, ordered generator. The repository's own check would otherwise surface only
      // as "could not record this contract", which no retry can fix.
      const problem = validateGrainContract({ ...draft, id: "" }, new Set(workspace.fields.commodities.map((commodity) => commodity.id)))[0];
      if (problem) {
        if (/^(Delivery|Premium)/.test(problem)) setDetailsOpen(true);
        setError(problem);
        return;
      }
      if (draft.basis !== null && basisLooksLikeCents(draft.basis) && !(await confirmDialog(basisCentsPrompt(draft.basis)))) return;
      // The premium box is in cents among $/bu boxes, so 0.10 typed for ten cents saves a tenth of a cent.
      if (draft.premium_cents_per_bu > 0 && draft.premium_cents_per_bu < 1) {
        const asCents = Number((draft.premium_cents_per_bu * 100).toFixed(4));
        if (!(await confirmDialog({ title: `Premium of ${draft.premium_cents_per_bu}¢ per bushel?`, body: `Premium is entered in cents, so ${draft.premium_cents_per_bu} is less than one cent. For ${asCents}¢, type ${asCents}.`, confirmLabel: "Keep this premium" }))) return;
      }
      setSubmitting(true);
      const contractId = services.createGrainId();
      const contract: GrainContract = {
        ...draft,
        id: contractId,
        notes: initialOffer
          ? offerToContract(initialOffer, contractId, timestamp).notes
          : null,
      };
      onReceipt(contract.id);
      if (onFilled) await onFilled(contract);
      else {
        await services.grainRepository.saveContract(contract);
        await onSaved();
      }
      if (!initialOffer) {
        setBushelCount("");
        setPrice("");
        setBasis("");
        setNumber("");
        setPremium("");
      }
      setError("");
    } catch (exception) {
      setError(farmerError(exception, initialOffer ? "record this firm-offer sale" : "record this contract"));
    } finally {
      submitLock.current.release();
      setSubmitting(false);
    }
  };
  const needsPrice = type !== "basis";
  const priceLabel = type === "hta" ? "Futures $/bu" : "Cash $/bu";
  return (
    <form className="contract-entry" onSubmit={(event) => void submit(event)}>
      {/* The crop and year picker sits above this form, so the form names where the sale goes. */}
      {!initialOffer && <p className="contract-entry-scope">New sale for <strong>{scopeLabel(workspace, scope)}</strong></p>}
      <label>
        <span>Buyer</span>
        <input
          required
          type="text"
          list="contract-buyer-suggestions"
          placeholder="Buyer or elevator"
          maxLength={200}
          value={buyer}
          onChange={(event) => setBuyer(event.target.value)}
        />
        <datalist id="contract-buyer-suggestions">
          {buyers.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </label>
      <label>
        <span>Type</span>
        <select
          value={type}
          onChange={(event) => {
            const next = event.target.value as GrainContractType;
            // One box holds the cash price or, on an HTA, the futures price. Keeping a typed cash price
            // as the futures price (or back) would save a number under a meaning nobody gave it.
            if ((next === "hta") !== (type === "hta")) setPrice("");
            setType(next);
          }}
        >
          {Object.entries(contractLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Bushels</span>
        <input
          required
          type="number"
          min="1"
          inputMode="numeric"
          value={bushelCount}
          onChange={(event) => setBushelCount(event.target.value)}
        />
      </label>
      {offerLeftover > 0 && (
        <p className="alert-fact contract-entry-note" role="status">
          Saving marks the whole offer filled, so the other {displayBushels(offerLeftover)} bu stop counting as pending. Farm Rx then opens a new offer for them, so you can keep it if the buyer is still holding them.
        </p>
      )}
      {/* step="any": grain is priced to the quarter cent, and a 0.01 step makes the browser refuse
          $4.1275 without saying why. */}
      {needsPrice ? (
        <label>
          <span>{priceLabel}</span>
          <input
            required
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
      ) : (
        <label>
          <span>Basis $/bu</span>
          {/* No inputMode: the iPhone decimal pad has no minus key, and basis is usually negative. */}
          <input
            required
            type="number"
            step="any"
            placeholder="-0.35"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
        </label>
      )}
      <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary>Delivery dates, contract #, premium (optional)</summary>
        <div>
          {initialOffer && initialOffer.offer_type !== "cash" && preset?.delivery_start && (
            <small className="contract-entry-hint">These dates came from the offer's futures month, which is not always when you deliver. Check them against the contract.</small>
          )}
          <label>
            Start
            <input
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            End
            <input
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <label>
            Contract #
            <input
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </label>
          <label>
            Premium, cents per bu
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="e.g. 15 for 15¢"
              value={premium}
              onChange={(event) => setPremium(event.target.value)}
            />
          </label>
        </div>
      </details>
      {error && (
        <p className="form-error grain-inline-error" role="alert">
          {error}
        </p>
      )}
      {saleLimitMessage && (
        <p className="form-error grain-inline-error" role="alert">
          {saleLimitMessage}
        </p>
      )}
      <button
        className="primary-action"
        type="submit"
        disabled={isSaving || submitting}
      >
        {isSaving || submitting
          ? "Saving…"
          : initialOffer
            ? "Save sale and mark filled"
            : "Add contract"}
      </button>
    </form>
  );
}

/** GL-3b: the way out of a contract typed wrong. A contract with any delivery recorded against it is
 * history and offers neither control -- the same test the server applies under a row lock, so the
 * screen never offers a button the database will refuse. The reason is required for both actions and
 * is stored with the change, so next season the farm can see why a number moved.
 *
 * What is NOT offered here is deliberate: crop year, commodity, contract type and every price. Those
 * are the contract's identity and its math, and a basis or HTA price belongs to the one-shot
 * finalization rule. Getting one of those wrong is what Delete is for. */
export function ContractRepair({ contract, workspace, services, onSaved, onDeleted }: { contract: GrainContract; workspace: GrainWorkspace; services: GrainServices; onSaved: () => Promise<void>; onDeleted?: (notice: string) => void }) {
  const [open, setOpen] = useState(false);
  const [buyer, setBuyer] = useState(contract.buyer);
  const [contractBushels, setContractBushels] = useState(String(contract.bushels));
  const [start, setStart] = useState(contract.delivery_start ?? "");
  const [end, setEnd] = useState(contract.delivery_end ?? "");
  const [number, setNumber] = useState(contract.contract_number ?? "");
  const [notes, setNotes] = useState(contract.notes ?? "");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(createSubmitLock());
  // One id for one correction attempt, held until that attempt succeeds. If the write commits but the
  // response is lost, pressing Save again sends the same id, and the server reports the correction it
  // already made instead of a stale-version error the farmer cannot tell apart from a failure.
  // Minted on the first save, never during render: an id generator is shared and ordered, and taking
  // one on every render of every contract row would shift the id the next real write gets.
  const operationId = useRef<string | null>(null);
  // This panel stays mounted across a workspace refresh, so the contract prop can move under a draft
  // that is still holding the values it was opened with. Without this, correcting only the buyer would
  // send the bushels as they were BEFORE another member corrected them -- and because the refreshed
  // updated_at now rides along, the compare-and-swap would accept it and quietly undo their work. The
  // version fence and a stale draft together are worse than either alone.
  //
  // The fields are rebased on the contract as it now stands and the farmer is told, rather than the
  // draft being discarded silently. The reason is kept: it is their words, not a copy of the row. The
  // operation id is dropped, because this is a different correction from the one they started.
  //
  // The panel's own successful save is NOT such a change. It produces a new version too, but the prop
  // does not carry it until the refresh lands -- so adopting the new version at save time only moved
  // the mismatch: the prop still held the old one, this branch fired on the next render, and the
  // farmer's own correction was reported back to them as somebody else's. The version this panel
  // wrote is therefore remembered separately and recognised when the refresh finally brings it.
  // The whole row this panel last wrote, not only its version. onSaved() reloads the workspace and
  // that reload CATCHES its own failure, so a correction can succeed and the refresh that follows it
  // fail on a lost signal -- leaving the prop on the row before the save. Holding the saved row means
  // the next correction still diffs against, and is versioned against, what the server actually has,
  // instead of sending a version the server moved past and being refused as stale.
  const [seenVersion, setSeenVersion] = useState(contract.updated_at);
  const [savedRow, setSavedRow] = useState<GrainContract | null>(null);
  if (contract.updated_at !== seenVersion && savedRow !== null && contract.updated_at === savedRow.updated_at) {
    // Our own save, arriving. Adopt it and keep the success message the farmer is reading.
    setSeenVersion(contract.updated_at);
    setSavedRow(null);
  } else if (contract.updated_at !== seenVersion) {
    setSeenVersion(contract.updated_at);
    setSavedRow(null);
    setBuyer(contract.buyer);
    setContractBushels(String(contract.bushels));
    setStart(contract.delivery_start ?? "");
    setEnd(contract.delivery_end ?? "");
    setNumber(contract.contract_number ?? "");
    setNotes(contract.notes ?? "");
    operationId.current = null;
    setMessage("This contract changed while you had it open. The fields now show the current values \u2014 check them before saving.");
  }
  // Touching any field makes this a different correction from the one a previous attempt sent, so it
  // must not reuse that attempt's id: the server would recognise the id, answer with what it already
  // saved, and the newly typed change would be dropped while the screen said it was corrected.
  const redraft = () => { operationId.current = null };
  // The freshest row this panel knows of: what it last saved, or the prop when it has caught up.
  const current = savedRow ?? contract;
  const available = workspace.capabilities?.contract_edit_delete !== false;
  if (!available) return null;
  // The way out stops at the first delivery, so say so and name the one undo there is, instead of the
  // control simply vanishing.
  if (!contractIsCorrectable(workspace, contract.id)) {
    const deliveries = workspace.grain_contract_deliveries.filter((delivery) => delivery.grain_contract_id === contract.id);
    return <small className="contract-locked-note">{deliveries.every((delivery) => delivery.grain_load_id)
      ? "Deliveries are recorded on this contract, so it can no longer be corrected or deleted. To undo a delivery, void its load ticket under Loads."
      : "Deliveries are recorded on this contract, so it can no longer be corrected or deleted. A delivery typed in by hand cannot be undone in Farm Rx yet."}</small>;
  }
  // Refusal audit (LD-010): grain_loads references a contract `on delete restrict`, and a voided
  // ticket keeps its row, so the database refuses this delete for good. Offering the button would
  // only lead to a failure the farmer cannot act on.
  const deletable = contractIsDeletable(workspace, contract.id);
  const correct = async () => {
    if (!lock.current.acquire()) return;
    try {
      // These three speak to the farmer directly. Routing them through the error taxonomy would turn
      // "say why" into "Farm Rx could not correct this contract right now", which is not what happened.
      const problem = validateContractCorrectionReason(reason);
      if (problem) { setMessage(problem); return }
      const value = Number(contractBushels);
      if (!Number.isFinite(value) || value <= 0) { setMessage("Bushels must be greater than zero."); return }
      if (start && end && end < start) { setMessage("Delivery end must be on or after delivery start."); return }
      // Only what this farmer actually changed. Sending the whole form would let a buyer correction
      // typed on a stale page quietly undo a bushels correction another member just saved, and the
      // audit would show both as deliberate. The contract's own updated_at goes with it, so the
      // server refuses the write outright if the row moved under this page.
      const changes = contractCorrectionDiff(current, { buyer, bushels: contractBushels, delivery_start: start, delivery_end: end, contract_number: number, notes });
      if (!Object.keys(changes).length) { setMessage("Nothing has changed on this contract yet."); return }
      setSaving(true);
      operationId.current ??= services.createGrainId();
      const saved = await services.grainRepository.editContract(contract.id, reason, changes, current.updated_at, operationId.current);
      operationId.current = null;
      // Adopt the version this save produced. The refresh below hands back the row we just wrote, and
      // without this the rebase branch would read our own save as somebody else's change and replace
      // "Contract corrected" with a warning. A version we did not write still warns, which is the point.
      setSavedRow(saved);
      setMessage("Contract corrected.");
      setReason("");
      await onSaved();
    } catch (error) { setMessage(farmerError(error, "correct this contract")) } finally { lock.current.release(); setSaving(false) }
  };
  const remove = async () => {
    if (!lock.current.acquire()) return;
    try {
      const problem = validateContractCorrectionReason(reason);
      if (problem) { setMessage(problem); return }
      if (!(await confirmDialog({ title: `Delete the ${contract.buyer} contract?`, body: "The contract is removed from your position. The reason you gave is kept. This cannot be undone.", confirmLabel: "Delete contract", destructive: true }))) return;
      setSaving(true);
      operationId.current ??= services.createGrainId();
      const result = await services.grainRepository.deleteContract(contract.id, reason, current.updated_at, operationId.current);
      // This row is about to vanish, so the news goes above the table. A contract that came from a
      // firm offer sent that offer back to open; entering a replacement contract by hand instead of
      // refilling the offer would leave the offer counted as pending AND fillable into a second one.
      // An offer whose expiry had already passed comes back expired, not open. It cannot be filled
      // and is not counted as pending, so sending the farmer to refill it would be sending them after
      // something that is not there.
      // Each state named explicitly. "Anything that is not open must be expired" was the looser half
      // of the same mistake: it would announce an expiry that never happened for any other value.
      onDeleted?.(result.reopenedFirmOfferId === null
        ? "Contract deleted."
        : result.reopenedFirmOfferStatus === "open"
          ? "Contract deleted. It came from a firm offer, and that offer is open again \u2014 fill it from Firm offers rather than entering a new contract, or the offer stays counted as pending."
          : result.reopenedFirmOfferStatus === "expired"
            ? "Contract deleted. It came from a firm offer whose expiry has passed, so that offer is marked expired rather than reopened \u2014 enter a new contract, or open the offer under Firm offers and change its expiry date to renew it."
            : "Contract deleted. It came from a firm offer \u2014 check that offer under Firm offers before entering a replacement contract.");
      await onSaved();
    } catch (error) { setMessage(farmerError(error, "delete this contract")) } finally { lock.current.release(); setSaving(false) }
  };
  return <div className="contract-repair">
    <button className="text-action" type="button" aria-expanded={open} onClick={() => {
      // Cancel means cancel: an abandoned edit must not be waiting, ready to save, when the panel reopens.
      if (open) { setBuyer(current.buyer); setContractBushels(String(current.bushels)); setStart(current.delivery_start ?? ""); setEnd(current.delivery_end ?? ""); setNumber(current.contract_number ?? ""); setNotes(current.notes ?? ""); setReason(""); setMessage(""); operationId.current = null }
      setOpen(!open);
    }}>{open ? "Cancel correction" : "Correct or delete"}</button>
    {open && <div className="contract-repair-body">
      <label>Buyer<input value={buyer} onChange={(event) => { redraft(); setBuyer(event.target.value) }} /></label>
      <label>Contract bushels<input type="number" min="0.01" step="0.01" inputMode="decimal" value={contractBushels} onChange={(event) => { redraft(); setContractBushels(event.target.value) }} /></label>
      <label>Delivery start<input type="date" value={start} onChange={(event) => { redraft(); setStart(event.target.value) }} /></label>
      <label>Delivery end<input type="date" value={end} onChange={(event) => { redraft(); setEnd(event.target.value) }} /></label>
      <label>Contract #<input value={number} onChange={(event) => { redraft(); setNumber(event.target.value) }} /></label>
      {/* Setting a basis or futures price tells the farmer to "add a contract note for any
          correction". Without this field that instruction had nowhere to land. */}
      <label>Contract note<textarea value={notes} rows={2} onChange={(event) => { redraft(); setNotes(event.target.value) }} /></label>
      <label>Why are you changing this?<textarea value={reason} rows={2} onChange={(event) => { redraft(); setReason(event.target.value) }} /></label>
      {deletable
        ? <small>Crop year, commodity, type and price cannot be corrected here. Delete the contract and enter it again if one of those is wrong.</small>
        : <small>A load ticket names this contract, so it can be corrected but not deleted. Crop year, commodity, type and price cannot be corrected here.</small>}
      <div className="contract-repair-buttons">
        <button className="text-action" type="button" disabled={saving} onClick={() => void correct()}>Save correction</button>
        {deletable && <button className="text-action destructive" type="button" disabled={saving} onClick={() => void remove()}>Delete contract</button>}
      </div>
      {message && <small>{message}</small>}
    </div>}
  </div>;
}

export function ContractActions({ contract, workspace, services, autoFocusDelivery = false, onSaved, onDeliverySaved, onDeleted, onReceipt }: { contract: GrainContract; workspace: GrainWorkspace; services: GrainServices; autoFocusDelivery?: boolean; onSaved: () => Promise<void>; onDeliverySaved: () => Promise<void>; onDeleted?: (notice: string) => void; onReceipt: (id: string) => void }) {
  const [price, setPrice] = useState(""); const [delivery, setDelivery] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false); const [deliveryUnconfirmed, setDeliveryUnconfirmed] = useState(false); const lock = useRef(createSubmitLock()); const deliveryDraft = useRef<GrainContractDelivery | null>(null);
  // A late entry for last week's truck carries last week's date, and the ticket number rides along as the delivery note.
  const [deliveredOn, setDeliveredOn] = useState(() => localCalendarDay(new Date())); const [deliveryNote, setDeliveryNote] = useState("");
  const missingLeg = contract.contract_type === "basis" ? "futures_price" : contract.contract_type === "hta" ? "basis" : null;
  // A load ticket that names this contract records its own delivery row, so the same truck typed here would count twice.
  const fromLoads = workspace.grain_contract_deliveries.filter((item) => item.grain_contract_id === contract.id && item.grain_load_id).reduce((sum, item) => sum + item.bushels, 0);
  const finalize = async () => { if (!missingLeg || !lock.current.acquire()) return; setSaving(true); try { const value = Number(price); if (price.trim() === "" || !Number.isFinite(value) || (missingLeg === "futures_price" && value <= 0)) { setMessage(missingLeg === "basis" ? "Enter a valid basis." : "Enter a futures price above zero."); return } const centsNote = missingLeg === "basis" && basisLooksLikeCents(value) ? ` ${basisCentsPrompt(value).body}` : ""; if (!(await confirmDialog({ title: `Set ${missingLeg === "basis" ? "basis" : "futures price"} to ${pricePerBu.format(value)}/bu?`, body: `This cannot be changed afterward. Add a contract note for any correction.${centsNote}`, confirmLabel: "Set price", destructive: true }))) return; await services.grainRepository.finalizeContractPriceLeg(contract.id, missingLeg, value); setMessage("Price leg set. Add a contract note for any correction."); await onSaved() } catch (error) { setMessage(farmerError(error, "set this price")) } finally { lock.current.release(); setSaving(false) } };
  const record = async () => {
    if (!lock.current.acquire()) return;
    let writeAccepted = false;
    try {
      // A retry resends the held draft exactly, so only a new entry is read from the boxes and checked.
      const value = deliveryDraft.current?.bushels ?? Number(delivery);
      if (!Number.isFinite(value) || value <= 0) { setMessage("Enter delivered bushels."); return }
      if (!deliveryDraft.current) {
        const today = localCalendarDay(new Date());
        if (!deliveredOn) { setMessage("Enter the delivery date."); return }
        if (deliveredOn > today) { setMessage("The delivery date cannot be in the future."); return }
        if (fromLoads > 0 && !(await confirmDialog({ title: "Record this delivery by hand?", body: "Load tickets already count deliveries on this contract. Recording the same truck here would count it twice.", confirmLabel: "Record delivery" }))) return;
      }
      const delivered = workspace.grain_contract_deliveries.filter((item) => item.grain_contract_id === contract.id).reduce((sum, item) => sum + item.bushels, 0);
      const excess = delivered + value - contract.bushels;
      const allow_overdelivery = excess > 0 && (await confirmDialog({ title: `This is ${displayBushels(excess)} bu more than the contract. Record anyway?`, body: "The contract will show as over-delivered.", confirmLabel: "Record anyway" }));
      if (excess > 0 && !allow_overdelivery) return;
      setSaving(true);
      deliveryDraft.current ??= { id: services.createGrainId(), farm_id: workspace.fields.farm.id, grain_contract_id: contract.id, bushels: value, delivered_on: deliveredOn, note: deliveryNote.trim() || null, created_at: new Date().toISOString(), allow_overdelivery };
      onReceipt(deliveryDraft.current.id);
      await services.grainRepository.recordContractDelivery(deliveryDraft.current);
      writeAccepted = true;
      await onDeliverySaved();
      deliveryDraft.current = null;
      setDeliveryUnconfirmed(false);
      setDelivery("");
      setDeliveredOn(localCalendarDay(new Date()));
      setDeliveryNote("");
      setMessage("Delivery recorded.");
    } catch (error) {
      const receipt = deliveryDraft.current ? getSaveReceipt(deliveryDraft.current.id) : null;
      if (deliveryDraft.current && (receipt === "confirmation needed" || writeAccepted)) {
        setDeliveryUnconfirmed(true);
        setMessage("Delivery may be recorded but could not be confirmed. Retry keeps the same delivery and will not create another.");
      } else {
        deliveryDraft.current = null;
        setDeliveryUnconfirmed(false);
        setMessage(farmerError(error, "record this delivery"));
      }
    } finally {
      lock.current.release();
      setSaving(false);
    }
  };
  // Each control is its own small form, so Go / Enter on a phone keyboard does what the button does.
  // This sits in the contracts table, never inside the Add contract form, so no form is nested.
  return <div className="contract-actions">
    {missingLeg && contract[missingLeg] === null && <form className="contract-action-form" onSubmit={(event) => { event.preventDefault(); void finalize() }}>
      {/* step="any" takes quarter cents; a basis box gets no inputMode, so the iPhone keyboard has a minus key. */}
      <label>{missingLeg === "basis" ? "Set basis $/bu" : "Set futures price $/bu"}<input type="number" step="any" inputMode={missingLeg === "basis" ? undefined : "decimal"} placeholder={missingLeg === "basis" ? "-0.35" : undefined} value={price} onChange={(event) => setPrice(event.target.value)} /></label>
      <button className="text-action" type="submit" disabled={saving || !workspace.capabilities?.contract_price_finalization}>{missingLeg === "basis" ? "Set basis" : "Set futures price"}</button>
      {!workspace.capabilities?.contract_price_finalization && <small>Price finalization arrives with the next database update. Reload the app after the update.</small>}
    </form>}
    <form className="contract-action-form" onSubmit={(event) => { event.preventDefault(); void record() }}>
      {/* Text, not a number box, so "1,200" copied off a ticket is kept: commas and spaces are dropped as typed. */}
      <label>Delivered bushels<input type="text" inputMode="decimal" autoComplete="off" value={delivery} disabled={deliveryUnconfirmed} autoFocus={autoFocusDelivery} onChange={(event) => setDelivery(event.target.value.replace(/[,\s]/g, ""))} /></label>
      <label>Delivered on<input type="date" max={localCalendarDay(new Date())} value={deliveredOn} disabled={deliveryUnconfirmed} onChange={(event) => setDeliveredOn(event.target.value)} /></label>
      <label>Ticket # or note (optional)<input type="text" maxLength={4000} value={deliveryNote} disabled={deliveryUnconfirmed} onChange={(event) => setDeliveryNote(event.target.value)} /></label>
      <button className="text-action" type="submit" disabled={saving || !workspace.capabilities?.contract_deliveries}>{deliveryUnconfirmed ? "Retry delivery" : "Record delivery"}</button>
      <small className="contract-action-hint">Use this only for trucks with no load ticket. Hauled it out of a bin? <Link to="/grain/loads">Record it on Loads</Link> instead: one ticket takes it out of the bin and records this delivery. Recording a delivery does not remove grain from a bin.</small>
      {fromLoads > 0 && <small className="contract-action-hint">{displayBushels(fromLoads)} bu came from load tickets.</small>}
      {!workspace.capabilities?.contract_deliveries && <small>Tracking arrives with the next database update. Reload the app after the update.</small>}
    </form>
    {message && <small className="contract-action-message" role="status">{message}</small>}
    <ContractRepair contract={contract} workspace={workspace} services={services} onSaved={onSaved} onDeleted={onDeleted} />
  </div>
}

/** LD-3: committed and free bushels for the whole farm, one line per lot.
 *
 * A lot is a commodity in a crop year, which is the point: carry-over grain is never charged
 * against a current-year contract. This appears ONCE, here, and is never allocated to a bin --
 * contracts are written against the farm, so splitting them across bins would be an invention, and
 * showing the farm figure on each bin would be the same bushels counted twice.
 *
 * Bushels in movements that carry no crop year are named separately and counted in no lot. Farm Rx
 * will not guess which year they were. */
/** A lot with more committed than stored is not always oversold. New crop still in the field is
 * normally sold ahead, so the gap is "not in the bins yet" while contracts stay within this crop's
 * estimate, and only "more sold than your estimate" past it. With no estimate there is nothing to
 * compare against, so it stays "short". Wording only: the committed/free maths is unchanged. */
function lotGapText(workspace: GrainWorkspace, commodityId: string, cropYear: number, free: number): { text: string; short: boolean } | null {
  if (free >= -0.000001) return null;
  const estimates = workspace.production_estimates.filter((estimate) => estimate.commodity_id === commodityId && estimate.crop_year === cropYear);
  if (estimates.length === 0) return { text: `${displayBushels(-free)} bu short`, short: true };
  const production = estimates.reduce((sum, estimate) => sum + activeProduction(estimate), 0);
  const contracted = workspace.grain_contracts.filter((contract) => contract.commodity_id === commodityId && contract.crop_year === cropYear).reduce((sum, contract) => sum + contract.bushels, 0);
  if (contracted > production + 0.000001) return { text: `${bushels.format(contracted - production)} bu more sold than your ${cropYear} crop estimate`, short: true };
  return { text: `${bushels.format(-free)} bu sold but not in the bins yet`, short: false };
}

/** HANDS-OP-b1: grain in the bins for a crop and year that has no estimate (old-crop carry-over, most
 * often) has no card on the Overview. Rather than leave it invisible, it is listed with what it is. */
function UntrackedStoredGrain({ workspace }: { workspace: GrainWorkspace }) {
  const untracked = deriveCommittedFree(workspace).filter((lot) => lot.onHand > 0.000001 && !workspace.production_estimates.some((estimate) => estimate.commodity_id === lot.commodity_id && estimate.crop_year === lot.crop_year));
  if (untracked.length === 0) return null;
  const commodityLabel = (id: string) => workspace.fields.commodities.find((item) => item.id === id)?.name ?? id;
  return (
    <section className="grain-section untracked-stored-grain" aria-label="Stored grain not tracked here">
      <div className="section-heading">
        <div>
          <h2>Stored grain not tracked here</h2>
          <p>Sales of this grain can&rsquo;t be recorded in Grain yet. It still counts on Bins &amp; basis.</p>
        </div>
      </div>
      <ul>
        {untracked.map((lot) => (
          <li key={`${lot.commodity_id}:${lot.crop_year}`}>
            <strong>{lot.crop_year} {commodityLabel(lot.commodity_id)}</strong> · <span className="numeric">{bushels.format(lot.onHand)} bu</span> in bins
          </li>
        ))}
      </ul>
      <NavLink to="/grain/storage" className="secondary-action">Open Bins &amp; basis</NavLink>
    </section>
  );
}

function CommittedFreeLine({ workspace }: { workspace: GrainWorkspace }) {
  const lots = deriveCommittedFree(workspace);
  // Kept by MOVEMENT COUNT, not by net bushels. An unresolved 1,000 in and 1,000 out net to zero
  // today, but they are still two movements with no crop year: naming their years can put the
  // thousand bushels in one year and take it out of another, moving both figures above. Filtering
  // on the net hid exactly the rows whose resolution changes the most.
  const unknown = deriveUnknownCropYearBushels(workspace.bin_transactions).filter((row) => row.movementCount > 0);
  if (lots.length === 0 && unknown.length === 0) return null;
  const unknownMovements = unknown.reduce((total, row) => total + row.movementCount, 0);
  const commodityLabel = (id: string) => workspace.fields.commodities.find((item) => item.id === id)?.name ?? id;
  return (
    <section className="committed-free" aria-label="Committed and free bushels">
      <h3>Committed and free</h3>
      {lots.length > 0 && (
        <ul>
          {lots.map((lot) => {
            const gap = lotGapText(workspace, lot.commodity_id, lot.crop_year, lot.free);
            return (
            <li key={`${lot.commodity_id}:${lot.crop_year}`}>
              <strong>{lot.crop_year} {commodityLabel(lot.commodity_id)}</strong>
              {" · "}
              <span className="numeric">{displayBushels(lot.onHand)}</span> stored
              {" · "}
              {lot.committed > 0.000001
                ? <><span className="numeric">{displayBushels(lot.committed)}</span> committed</>
                : "nothing committed"}
              {" · "}
              {gap
                ? <strong className={gap.short ? "committed-free-short" : undefined}>{gap.text}</strong>
                : <><strong className="numeric">{displayBushels(lot.free)}</strong> free</>}
            </li>
            );
          })}
        </ul>
      )}
      {unknown.length > 0 && (
        <p className="committed-free-unknown" role="status">
          {unknown.map((row) => {
            const movements = row.movementCount === 1 ? "1 movement" : `${row.movementCount} movements`;
            // The net is worth saying when there is one, and saying nothing about it is better than
            // printing "0 bu", which reads as "nothing to see here" about rows that still matter.
            return Math.abs(row.bushels) > 0.000001
              ? `${displayBushels(Math.abs(row.bushels))} bu of ${commodityLabel(row.commodity_id)} in ${movements}`
              : `${commodityLabel(row.commodity_id)} in ${movements} that cancel out today`;
          }).join(", ")}
          {" "}
          {unknownMovements === 1 ? "was" : "were"} recorded before Farm Rx kept crop years, so
          {" "}{unknownMovements === 1 ? "it is" : "they are"} in none of the figures above. Naming their crop year
          {" "}brings them in, and can change the figures above even where the movements cancel out today.
        </p>
      )}
    </section>
  );
}

export function Bins({
  workspace,
  services,
  onSaved,
  onMovementSaved,
  onReceipt,
  receipt,
  canManageFarm,
}: {
  workspace: GrainWorkspace;
  services: GrainServices;
  onSaved: () => Promise<void>;
  onMovementSaved: () => Promise<void>;
  onReceipt: (id: string) => void;
  receipt: ReturnType<typeof useSaveReceipt>;
  /** Whether this viewer sees "Which crop year were these?". Left out, the wording covers both. */
  canManageFarm?: boolean;
}) {
  const [editing, setEditing] = useState<GrainBin | null>(null);
  const [adding, setAdding] = useState(false);
  const [movingBinId, setMovingBinId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const saveBin = async (bin: GrainBin) => {
    try {
      onReceipt(bin.id);
      await services.grainRepository.upsertGrainBin(bin);
      setAdding(false);
      setEditing(null);
      setError("");
      await onSaved();
    } catch (caught) {
      const message = farmerError(caught, "save this bin");
      setError(message);
      throw new Error(message);
    }
  };
  const addMovement = async (transaction: BinTransaction) => {
    let writeAccepted = false;
    try {
      onReceipt(transaction.id);
      await services.grainRepository.appendBinTransaction(transaction);
      writeAccepted = true;
      setError("");
      await onMovementSaved();
    } catch (caught) {
      if (writeAccepted) setSaveReceipt(transaction.id, "confirmation needed");
      const message = writeAccepted ? "This bin movement may be recorded but could not be confirmed. Retry keeps the same movement and will not create another." : farmerError(caught, "add this movement");
      setError(message);
      throw new Error(message);
    }
  };
  return (
    <section className="bins-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Storage</span>
          <h2>Grain bins</h2>
        </div>
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            setAdding(true);
            setEditing(null);
          }}
        >
          Add bin
        </button>
      </div>
      <SaveReceipt state={receipt} />
      <CommittedFreeLine workspace={workspace} />
      {/* Add only. Editing opens inside the bin being edited, so the farmer can see which bin it is
          and a phone does not open the form off-screen. Each form is keyed to its bin, so its fields
          are always seeded from the bin that was tapped, never left over from another. */}
      {adding && (
        <BinForm
          key="new"
          bin={null}
          workspace={workspace}
          services={services}
          onCancel={() => setAdding(false)}
          onSave={saveBin}
        />
      )}
      <div className="bin-list">
        {workspace.grain_bins.length === 0 ? (
          <p className="panel-note">No bins yet. Tap Add bin to set up your first bin or elevator storage.</p>
        ) : workspace.grain_bins.map((bin) => {
          const position = binPosition(workspace, bin);
          // Only crops the bin still holds. A crop emptied out of the bin is history, not a badge.
          const heldLots = position.lots.filter((lot) => Math.abs(lot.onHand) > 0.000001);
          // A bin holding two crops is held to the stricter safe moisture of the two.
          const heldFamily = heldLots
            .map((lot) => workspace.fields.commodities.find((item) => item.id === lot.commodityId)?.crop_family ?? null)
            .reduce<Parameters<typeof safeStorageMoisture>[0]>((strictest, family) => family && (!strictest || safeStorageMoisture(family) < safeStorageMoisture(strictest)) ? family : strictest, null);
          const moisture = moistureStatus(bin, new Date(), heldFamily);
          const moistureText =
            bin.moisture_pct === null
              ? bin.moisture_checked_on === null
                ? "No moisture reading"
                : "Date recorded, moisture missing"
              : bin.moisture_checked_on === null
                ? `${bin.moisture_pct.toFixed(1)}% · date missing`
                : `${bin.moisture_pct.toFixed(1)}% · checked ${new Date(`${bin.moisture_checked_on}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
          const fill = (position.onHand / bin.capacity_bu) * 100;
          const fillText = Math.round(Math.max(0, fill));
          return (
            <article className="bin-card" key={bin.id}>
              <div className="bin-row">
                <div>
                  <strong>{bin.name}</strong>
                  <span>
                    {bin.location_type === "on_farm" ? "On farm" : "Commercial"}
                    {bin.location_name ? ` · ${bin.location_name}` : ""}
                  </span>
                </div>
                <button
                  className="text-action"
                  type="button"
                  onClick={() => {
                    setEditing(bin);
                    setAdding(false);
                  }}
                >
                  Edit bin
                </button>
              </div>
              {editing?.id === bin.id && (
                <BinForm
                  key={bin.id}
                  bin={bin}
                  workspace={workspace}
                  services={services}
                  onCancel={() => setEditing(null)}
                  onSave={saveBin}
                />
              )}
              <div className="bin-card-meta">
                {heldLots.length ? heldLots.map((lot) => {
                  const commodity = workspace.fields.commodities.find((item) => item.id === lot.commodityId);
                  return <span key={lot.commodityId} className={`commodity-badge ${commodity?.traits.identity_preserved ? "ip" : ""}`}>{commodity?.traits.identity_preserved ? "IP · " : ""}{commodity?.name ?? lot.commodityId} · {displayBushels(lot.onHand)} bu</span>
                }) : (
                  <span className="commodity-badge">Empty</span>
                )}
                <span
                  className={
                    moisture.flagged ? "moisture-flag" : "moisture-reading"
                  }
                >
                  {moistureText}
                </span>
              </div>
              {moisture.flagged && (
                <p className="bin-warning" role="status">
                  {moisture.message}
                </p>
              )}
               {position.lots.map((lot) => lot.inventory && <p className="bin-reconciliation" key={`${lot.commodityId}-baseline`}>Starting amount · {new Date(`${lot.baselineDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}: {displayBushels(lot.recordedInventory)} bu, after {lot.movementsSinceBaseline.length} movement{lot.movementsSinceBaseline.length === 1 ? "" : "s"} in or out since, {displayBushels(lot.onHand)} bu now.</p>)}
              <div className="bin-fill">
                <div>
                  <strong className="numeric">
                       {displayBushels(position.onHand)} bu
                  </strong>
                  <span className="numeric">
                    {" "}
                     / {displayBushels(bin.capacity_bu)} bu · {fillText}%
                  </span>
                </div>
                <span
                  aria-label={`${fillText} percent full`}
                  style={{ width: `${Math.min(100, Math.max(0, fill))}%` }}
                />
              </div>
              {position.exceedsRecordedInventory && (
                <p className="bin-warning" role="status">
                  This bin shows a negative grain balance — review its history.
                </p>
              )}
              {position.onHand > bin.capacity_bu && <p className="bin-warning" role="status">This bin shows more grain than it holds — review its history.</p>}
              {/* LD-3: the per-bin committed and free pair is gone rather than replaced. It read
                  bin_inventory.committed_bushels, a stored number per bin, while contracts are
                  written against the farm and not against particular bins -- so the same bushels
                  appeared again on every bin that held that crop. Committed and free are now one
                  farm-level figure per commodity and crop year, shown once at the top of this card. */}
              {/* Adding or taking out grain is the most common thing done to a bin, so it has its own
                  button rather than sitting inside the collapsed history. The form stays mounted while
                  closed: a movement waiting on a retry keeps its exact draft and id even if the farmer
                  closes it and comes back. */}
              <button
                className="secondary-action bin-move-toggle"
                type="button"
                aria-expanded={movingBinId === bin.id}
                aria-controls={`bin-move-${bin.id}`}
                aria-label={movingBinId === bin.id ? `Close add or take out grain for ${bin.name}` : undefined}
                onClick={() => setMovingBinId(movingBinId === bin.id ? null : bin.id)}
              >
                {movingBinId === bin.id ? "Close" : "Add or take out grain"}
              </button>
              <div className="bin-move" id={`bin-move-${bin.id}`} hidden={movingBinId !== bin.id}>
                <p className="panel-note">
                  Movements can’t be edited. To fix a mistake, add an opposite
                  movement.
                </p>
                <MovementForm
                  bin={bin}
                  commodityId={position.commodityId ?? ""}
                  workspace={workspace}
                  services={services}
                  canManageFarm={canManageFarm}
                  onSave={addMovement}
                />
              </div>
              <details className="bin-ledger">
                <summary>
                  Bin history ({position.transactions.length})
                </summary>
                {position.transactions.length ? (
                  <div className="movement-list">
                    {position.transactions.map((item) => {
                      const ledgerRow = buildBinLedgerRow(position.inventory, item);
                      return <div key={item.id}>
                        <strong
                          className={
                            item.direction === "in"
                              ? "movement-in"
                              : "movement-out"
                          }
                        >
                          {ledgerRow.label}
                        </strong>
                        <span>
                          {new Date(
                            `${item.occurred_on}T00:00:00`,
                          ).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                            · {workspace.fields.commodities.find((commodity) => commodity.id === item.commodity_id)?.name ?? item.commodity_id} · {movementSourceLabel(item.source_kind)}{ledgerRow.superseded ? " · replaced by a later bin count" : ""}
                        </span>
                        {item.note && <small>{item.note}</small>}
                      </div>;
                    })}
                  </div>
                ) : (
                  <p>No movements recorded yet.</p>
                )}
              </details>
            </article>
          );
        })}
      </div>
      {error && (
        <p className="form-error grain-inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function BinForm({
  bin,
  workspace,
  services,
  onCancel,
  onSave,
}: {
  bin: GrainBin | null;
  workspace: GrainWorkspace;
  services: GrainServices;
  onCancel: () => void;
  onSave: (bin: GrainBin) => Promise<void>;
}) {
  const [name, setName] = useState(bin?.name ?? "");
  const [capacity, setCapacity] = useState(bin?.capacity_bu.toString() ?? "");
  const [locationType, setLocationType] = useState<GrainBin["location_type"]>(
    bin?.location_type ?? "on_farm",
  );
  const [location, setLocation] = useState(bin?.location_name ?? "");
  const [moisture, setMoisture] = useState(bin?.moisture_pct?.toString() ?? "");
  const [checkedOn, setCheckedOn] = useState(bin?.moisture_checked_on ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(createSubmitLock());
  // Bring the form into view and put the cursor in Name, so on a phone the farmer is never left
  // looking at the button they tapped while the form opened somewhere else on the page.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    // preventScroll, so the jump to the input does not cut the smooth scroll short under the header.
    formRef.current?.querySelector("input")?.focus({ preventScroll: true });
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!submitLock.current.acquire()) return;
    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const next: GrainBin = {
        id: bin?.id ?? services.createGrainId(),
        farm_id: workspace.fields.farm.id,
        name,
        capacity_bu: Number(capacity),
        location_type: locationType,
        location_name: location.trim() || null,
        notes: bin?.notes ?? null,
        moisture_pct: moisture.trim() === "" ? null : Number(moisture),
        moisture_checked_on: checkedOn || null,
        created_at: bin?.created_at ?? timestamp,
        updated_at: timestamp,
      };
      const errors = validateGrainBin(next);
      if (errors.length) {
        setError(errors.join(" "));
        return;
      }
      try {
        await onSave(next);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Unable to save this bin.",
        );
      }
    } finally {
      submitLock.current.release();
      setSaving(false);
    }
  };
  return (
    <form ref={formRef} className="bin-form" onSubmit={(event) => void submit(event)}>
      <h3>{bin ? "Edit bin" : "Add bin"}</h3>
      <label>
        Name
        <input
          required
          maxLength={160}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Capacity bushels
        <input
          required
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
        />
      </label>
      <label>
        Location
        <select
          value={locationType}
          onChange={(event) =>
            setLocationType(event.target.value as GrainBin["location_type"])
          }
        >
          <option value="on_farm">On farm</option>
          <option value="commercial">Commercial</option>
        </select>
      </label>
      <label>
        Location name <small>optional</small>
        <input
          maxLength={200}
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
      </label>
      <label>
        Moisture % <small>optional, 0–40%</small>
        <input
          type="number"
          min="0"
          max="40"
          step="0.01"
          inputMode="decimal"
          value={moisture}
          onChange={(event) => setMoisture(event.target.value)}
        />
      </label>
      <label>
        Moisture checked on <small>optional</small>
        <input
          type="date"
          value={checkedOn}
          onChange={(event) => setCheckedOn(event.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button className="primary-action" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save bin"}
        </button>
        <button className="text-action" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MovementForm({
  bin,
  commodityId,
  workspace,
  services,
  canManageFarm,
  onSave,
}: {
  bin: GrainBin;
  commodityId: string;
  workspace: GrainWorkspace;
  services: GrainServices;
  canManageFarm?: boolean;
  onSave: (transaction: BinTransaction) => Promise<void>;
}) {
  const inventory = workspace.bin_inventory.find((item) => item.grain_bin_id === bin.id);
  const prior = workspace.bin_transactions.filter((item) => item.grain_bin_id === bin.id);
  const activeCommodityIds = activeBinCommodityIds(inventory, prior);
  const allowedCommodities = movementCommodityOptions(workspace.fields.commodities, inventory, prior);
  // An empty bin offers every crop. The ones this farm grew this year or last come first, and the
  // first of them is the starting choice, so the default is a crop the farm actually has.
  const thisYear = Number(localCalendarDay(new Date()).slice(0, 4));
  const grown = new Set(workspace.fields.crop_assignments.filter((assignment) => assignment.crop_year >= thisYear - 1).map((assignment) => assignment.commodity_id));
  const commodityChoices = [...allowedCommodities].sort((a, b) => Number(grown.has(b.id)) - Number(grown.has(a.id)) || a.name.localeCompare(b.name));
  const [direction, setDirection] = useState<BinTransaction["direction"]>("in");
  const [bushelsValue, setBushelsValue] = useState("");
  const [occurredOn, setOccurredOn] = useState(localCalendarDay(new Date()));
  const [note, setNote] = useState("");
  const [commodity, setCommodity] = useState(
    commodityId || commodityChoices[0]?.id || "",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(createSubmitLock());
  const movementDraft = useRef<BinTransaction | null>(null);
  const [movementUnconfirmed, setMovementUnconfirmed] = useState(false);
  const baselineDate = inventory?.measured_at.slice(0, 10) ?? null;
  const minimumOccurredOn = baselineDate ? new Date(`${baselineDate}T00:00:00.000Z`).getTime() + 86_400_000 : null;
  const minimumOccurredOnDate = minimumOccurredOn === null ? undefined : new Date(minimumOccurredOn).toISOString().slice(0, 10);
  useEffect(() => {
    if (activeCommodityIds.length) setCommodity(activeCommodityIds[0]);
  }, [commodityId, activeCommodityIds.join("|")]);
  // LD-5: which crop year this grain is. Until now this form never asked, so every hand-entered
  // movement joined the unknown-year bucket that LD-3's committed and free figures leave out, and
  // it was the last place in Grain where bushels moved without naming a lot.
  //
  // It follows the load form's bin origin rather than inventing its own rules, because that form
  // took many review rounds to get right:
  // - the bin's lots are asked of the database (public.bin_lots), since the workspace read is capped
  //   and can drop an older lot that still holds grain;
  // - the answer is kept WITH the bin and refresh it was read for, so a stale list is never read;
  // - a year is filled in only from a settled list, and only when the bin holds exactly one lot.
  // Both capabilities, because the server needs LD-2 to store a movement's crop year and LD-4 to
  // answer what the bin holds.
  // Written with ?? rather than !== false on purpose: the load form's own checks are pinned by
  // exact text in the foundation guards, and a second identical line here would shadow them.
  const cropYearReady = (workspace.capabilities?.grain_load_effects ?? true)
    && (workspace.capabilities?.grain_load_bin_lot ?? true);
  const [cropYear, setCropYear] = useState("");
  const [lotRead, setLotRead] = useState<{ binId: string; refresh: number; lots: BinLotOnHand[] | null } | null>(null);
  const [lotsRefresh, setLotsRefresh] = useState(0);
  const lotsForThisBin = lotRead && lotRead.binId === bin.id && lotRead.refresh === lotsRefresh ? lotRead : null;
  const lotsState: "loading" | "ready" | "unavailable" = !lotsForThisBin ? "loading" : lotsForThisBin.lots ? "ready" : "unavailable";
  useEffect(() => {
    if (!cropYearReady) return;
    let current = true;
    const forBin = bin.id;
    const forRefresh = lotsRefresh;
    // Started inside a promise so a repository without the read fails into "unavailable" rather
    // than throwing out of the effect.
    void Promise.resolve()
      .then(() => services.grainRepository.listBinLots(forBin))
      .then((lots) => { if (current) setLotRead({ binId: forBin, refresh: forRefresh, lots }) })
      .catch(() => { if (current) setLotRead({ binId: forBin, refresh: forRefresh, lots: null }) });
    const cancel = () => { current = false };
    return cancel;
  }, [services, bin.id, lotsRefresh, cropYearReady]);
  const binLots = lotsForThisBin?.lots ?? recordedBinLots(workspace, bin.id);
  const plantedYears = workspace.fields.crop_assignments
    .filter((assignment) => assignment.commodity_id === commodity)
    .map((assignment) => assignment.crop_year);
  const { years: cropYears, defaultYear } = manualMovementCropYears(direction, commodity, binLots, plantedYears, thisYear);
  const commodityName = workspace.fields.commodities.find((item) => item.id === commodity)?.name ?? "this crop";
  // "Which crop year were these?" is shown only to someone who can manage the farm, so anyone else
  // is sent to the person who can answer it rather than to a section they will never see.
  const nameOlderMovements = canManageFarm === true
    ? "name those movements under \u201cWhich crop year were these?\u201d first."
    : canManageFarm === false
      ? "ask the farm owner to name the crop year of those older movements first."
      : "name those movements under \u201cWhich crop year were these?\u201d first, or ask the farm owner to.";
  const noLotToTakeOut = `This bin has no ${commodityName} with a crop year on record to take out. If it holds grain from before crop years were recorded, ${nameOlderMovements}`;
  // Fill in a lone lot, from a settled list only, and never under a retry: the outstanding draft
  // already carries the year it was sent with.
  useEffect(() => {
    if (!cropYearReady || lotsState !== "ready" || movementUnconfirmed) return;
    if (cropYear || defaultYear === null) return;
    setCropYear(String(defaultYear));
  }, [cropYearReady, lotsState, movementUnconfirmed, cropYear, defaultYear]);
  // Drop a year the form no longer offers -- after a change of direction or crop, or once a save
  // has emptied that lot -- so the picker can always repair the draft it is showing. Only against a
  // settled list: while a re-read is in flight the fallback can lack a lot the farmer just chose.
  useEffect(() => {
    if (!cropYearReady || movementUnconfirmed || !cropYear || lotsState !== "ready") return;
    if (!cropYears.includes(Number(cropYear))) setCropYear("");
  }, [cropYearReady, movementUnconfirmed, cropYear, lotsState, cropYears.join("|")]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!submitLock.current.acquire()) return;
    setSaving(true);
    try {
      // A word in the box would otherwise reach the bushel check as "must be greater than zero".
      if (!movementDraft.current && bushelsValue.trim() && !Number.isFinite(Number(bushelsValue))) {
        setError("Type bushels as a number, like 1000.");
        return;
      }
      if (activeCommodityIds.length && !activeCommodityIds.includes(commodity)) {
        setError("This bin still holds another commodity. Empty its active lot before storing a different crop.");
        return;
      }
      // A retry resends its outstanding draft unchanged, so these checks are for a new movement only.
      if (cropYearReady && !movementDraft.current) {
        if (direction === "out" && lotsState !== "ready") {
          setError(lotsState === "loading"
            ? "Still reading what this bin holds. Try again in a moment."
            : "Farm Rx could not read what this bin holds. Check your signal and try again.");
          return;
        }
        if (!cropYear || !cropYears.includes(Number(cropYear))) {
          setError(direction === "out" && !cropYears.length ? noLotToTakeOut : "Pick the crop year of this grain.");
          return;
        }
      }
      const transaction: BinTransaction = movementDraft.current ?? {
        id: services.createGrainId(),
        farm_id: workspace.fields.farm.id,
        grain_bin_id: bin.id,
        direction,
        bushels: Number(bushelsValue),
        commodity_id: commodity,
        occurred_on: occurredOn,
        note: note.trim() || null,
        source_kind: "manual entry",
        crop_year: cropYearReady ? Number(cropYear) : null, grain_load_id: null, created_at: new Date().toISOString(),
      };
      const errors = validateBinTransaction(transaction);
      if (errors.length) {
        setError(errors.join(" "));
        return;
      }
      movementDraft.current ??= transaction;
      try {
        await onSave(transaction);
        movementDraft.current = null;
        setMovementUnconfirmed(false);
        // What the bin holds has changed, so the list is re-read before it is trusted again.
        setLotsRefresh((value) => value + 1);
        setBushelsValue("");
        setNote("");
        setError("");
      } catch (caught) {
        if (getSaveReceipt(transaction.id) === "confirmation needed") setMovementUnconfirmed(true);
        else { movementDraft.current = null; setMovementUnconfirmed(false); }
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to add this movement.",
        );
      }
    } finally {
      submitLock.current.release();
      setSaving(false);
    }
  };
  return (
    <form className="movement-form" onSubmit={(event) => void submit(event)}>
      <label>
        Direction
        <select
          value={direction}
          disabled={movementUnconfirmed}
          onChange={(event) =>
            setDirection(event.target.value as BinTransaction["direction"])
          }
        >
          <option value="in">In</option>
          <option value="out">Out</option>
        </select>
      </label>
      <label>
        Bushels
        {/* Text, not a number box: a number box turns "1,000" typed off a ticket into nothing. The
            commas and spaces are dropped as they are typed, so what is kept is a plain number. */}
        <input
          required
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={bushelsValue}
          disabled={movementUnconfirmed}
          onChange={(event) => setBushelsValue(event.target.value.replace(/[,\s]/g, ""))}
        />
      </label>
      <label>
        Commodity
        <select
          value={commodity}
          disabled={movementUnconfirmed}
          onChange={(event) => setCommodity(event.target.value)}
        >
          {commodityChoices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {cropYearReady && (
        <label>
          Crop year
          <select
            value={cropYear}
            disabled={movementUnconfirmed}
            onChange={(event) => setCropYear(event.target.value)}
          >
            <option value="">Pick a crop year</option>
            {cropYears.map((year) => (
              <option key={year} value={String(year)}>
                {year}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Date
        <input
          required
          type="date"
          min={minimumOccurredOnDate}
          value={occurredOn}
          disabled={movementUnconfirmed}
          onChange={(event) => setOccurredOn(event.target.value)}
        />
      </label>
      <label className="movement-note">
        Note <small>optional</small>
        <input
          maxLength={4000}
          value={note}
          disabled={movementUnconfirmed}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!workspace.capabilities?.bin_movements && <p className="form-error">Bin movements arrive with the next database update. Reload the app after the update.</p>}
      <p className="panel-note">Hauled it on a truck? Record the load under Loads instead. A saved load already moves the grain in or out of the bin, so don&rsquo;t add it here too.</p>
      {direction === "out" && <p className="panel-note">Bin-out changes this bin only. It does not mark a contract delivered.</p>}
      {cropYearReady && direction === "out" && lotsState === "ready" && !cropYears.length && <p className="panel-note">{noLotToTakeOut}</p>}
      <button className="secondary-action" type="submit" disabled={saving || !workspace.capabilities?.bin_movements}>
        {saving ? "Saving…" : movementUnconfirmed ? "Retry movement" : "Add movement"}
      </button>
    </form>
  );
}

export function Basis({
  workspace,
  services,
  onSaved,
}: {
  workspace: GrainWorkspace;
  services: GrainServices;
  onSaved: () => Promise<void>;
}) {
  const [elevator, setElevator] = useState("");
  // The first crop this farm actually grows, rather than a fixed corn default.
  const [commodity, setCommodity] = useState(() =>
    workspace.fields.commodities.find((item) => workspace.fields.crop_assignments.some((assignment) => assignment.commodity_id === item.id))?.id
      ?? workspace.fields.commodities[0]?.id
      ?? "");
  const [basis, setBasis] = useState("");
  const [cashPrice, setCashPrice] = useState("");
  const today = farmLocalCalendarDate();
  const [bidDate, setBidDate] = useState(today);
  const [error, setError] = useState("");
  const submitLock = useRef(createSubmitLock());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedCashPrice = cashPrice === "" ? null : Number(cashPrice);
    if (
      parsedCashPrice !== null &&
      (!Number.isFinite(parsedCashPrice) || parsedCashPrice < 0)
    ) {
      setError("Cash price must be zero or more.");
      return;
    }
    if (!bidDate || bidDate > farmLocalCalendarDate()) {
      setError("Pick the date of this bid. It cannot be after today.");
      return;
    }
    if (!submitLock.current.acquire()) return;
    const timestamp = new Date().toISOString();
    try {
      // A basis typed in cents ("-35" for 35 under) would save as -$35.00. Ask before saving it,
      // and keep what was typed if the farmer goes back to fix it.
      const parsedBasis = Number(basis);
      if (basisLooksLikeCents(parsedBasis) && !(await confirmDialog(basisCentsPrompt(parsedBasis)))) return;
      await services.grainRepository.saveCashBid({
        id: services.createGrainId(),
        farm_id: workspace.fields.farm.id,
        elevator,
        commodity_id: commodity,
        bid_date: bidDate,
        basis: parsedBasis,
        cash_price: parsedCashPrice,
        delivery_start: null,
        delivery_end: null,
        notes: null,
        feed_source: null,
        feed_report_id: null,
        feed_geography: null,
        created_at: timestamp,
        updated_at: timestamp,
      });
      setBasis("");
      setCashPrice("");
      // Back to today, so the next bid is not quietly saved under the date of the last one.
      setBidDate(farmLocalCalendarDate());
      setError("");
      await onSaved();
    } catch (exception) {
      setError(farmerError(exception, "save this cash bid"));
    } finally {
      submitLock.current.release();
    }
  };
  // Before an elevator is typed the chart shows this crop's recent bids from every elevator, so it
  // is never empty just because the box is.
  const allElevators = !elevator.trim();
  const history = workspace.cash_bids
    .filter(
      (bid) => (allElevators || bid.elevator === elevator) && bid.commodity_id === commodity,
    )
    .sort((left, right) => left.bid_date.localeCompare(right.bid_date))
    .slice(-8);
  const max = Math.max(0.01, ...history.map((bid) => Math.abs(bid.basis)));
  // GL-1: the feed's presence and age are judged over every feed row for this commodity, whatever elevator the chart shows.
  const mars = workspace.cash_bids
    .filter((bid) => bid.commodity_id === commodity && isMarsBid(bid))
    .sort((left, right) => left.bid_date.localeCompare(right.bid_date));
  const lastMars = mars.at(-1)?.bid_date;
  // GL-1: the feed reaches a farm only through its explicit market region and a verified USDA report for that state.
  const marketRegion = workspace.fields.farm.market_region ?? null;
  const regionReports = workspace.usda_market_reports.filter(
    (report) => report.geography === marketRegion,
  );
  const verifiedReports = regionReports.filter(
    (report) => report.verified_at !== null,
  );
  const feedRegionSentence =
    marketRegion === null
      ? "Set your farm's market region in Farm settings to receive USDA cash bids for your state."
      : verifiedReports.length === 0
        ? `No verified USDA report covers ${marketRegion} yet, so no feed bids are written for this farm.`
        : `USDA feed for ${marketRegion}: ${verifiedReports.map((report) => `${report.name} (${report.report_id})`).join(", ")}.`;
  const stale =
    !!lastMars &&
    Date.now() - new Date(`${lastMars}T23:59:59Z`).getTime() >
      36 * 60 * 60 * 1000;
  return (
    <section className="basis-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Cash market</span>
          <h2>Basis history</h2>
          <p>
            Recent basis by elevator and commodity.{" "}
            {mars.length
              ? `${[...new Set(mars.map(marsBidLabel))].join(", ")}, display-only; last dated ${lastMars}.`
              : ""}
          </p>
          {stale && (
            <p role="status">
              Basis feed unavailable — last updated {lastMars}.
            </p>
          )}
          <p className="basis-feed-region">{feedRegionSentence}</p>
        </div>
      </div>
      <form className="basis-entry" onSubmit={(event) => void submit(event)}>
        {/* GL-3: free text with suggestions, not a dropdown. A farm with no bids yet had an empty list
            and no way to record its first one. GL-004 still holds: knownCounterparties never offers a
            USDA market location as somewhere to save a manual bid. */}
        <label>
          Elevator
          <input
            required
            type="text"
            list="basis-elevator-suggestions"
            maxLength={200}
            value={elevator}
            onChange={(event) => setElevator(event.target.value)}
          />
        </label>
        <datalist id="basis-elevator-suggestions">
          {knownCounterparties(workspace).map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <label>
          Crop
          <select
            value={commodity}
            onChange={(event) => setCommodity(event.target.value)}
          >
            {workspace.fields.commodities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {/* No inputMode: the iPhone decimal keypad has no minus key, and most basis is negative.
            step="any" so a quarter-cent basis is not refused by the browser. */}
        <label>
          Basis ($/bu)
          <input
            required
            type="number"
            step="any"
            placeholder="Basis $/bu (e.g. -0.35)"
            aria-describedby="basis-sign-hint"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
        </label>
        {/* Outside the label, so it is not read as part of the box's name and does not push the
            Basis box out of line with its neighbours. It runs the full width under this row. */}
        <p className="basis-hint" id="basis-sign-hint">Under futures is negative. Type -0.35 for 35&cent; under, 0.10 for 10&cent; over.</p>
        <label>
          Cash price ($/bu) <small>optional</small>
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={cashPrice}
            onChange={(event) => setCashPrice(event.target.value)}
          />
        </label>
        <label>
          Bid date
          <input
            required
            type="date"
            max={today}
            value={bidDate}
            onChange={(event) => setBidDate(event.target.value)}
          />
        </label>
        <button className="secondary-action" type="submit">
          Add basis
        </button>
      </form>
      {error && (
        <p className="form-error grain-inline-error" role="alert">
          {error}
        </p>
      )}
      {/* Bars side by side read as one elevator's trend, so the chart waits for an elevator. Until
          then the list below names each bid's elevator. */}
      {allElevators ? (
        history.length > 0 && <p className="panel-note basis-chart-note">Latest bids from every elevator. Type an elevator to see its trend.</p>
      ) : (
      <svg
        className="basis-chart"
        viewBox="0 0 320 150"
        role="img"
        aria-label={`Basis history for ${elevator}`}
      >
        <line x1="0" x2="320" y1="75" y2="75" className="basis-zero" />
        {history.map((bid, index) => {
          const height = (Math.abs(bid.basis) / max) * 60;
          const x = 16 + index * 38;
          const y = bid.basis >= 0 ? 75 - height : 75;
          return (
            <g key={bid.id}>
              <rect
                x={x}
                y={y}
                width="24"
                height={height}
                className={bid.basis >= 0 ? "basis-positive" : "basis-negative"}
              />
              <text x={x + 12} y="142" textAnchor="middle">
                {bid.bid_date.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
      )}
      <div className="basis-list">
        {history
          .slice()
          .reverse()
          .map((bid) => (
            <div key={bid.id}>
              <span>
                {new Date(`${bid.bid_date}T00:00:00`).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric" },
                )}
                {allElevators ? ` · ${bid.elevator}` : ""}
              </span>
              <strong>
                {bid.basis > 0 ? "+" : ""}
                {pricePerBu.format(bid.basis)}
              </strong>
              {bid.cash_price !== null && (
                <small>Cash {pricePerBu.format(bid.cash_price)}</small>
              )}
            </div>
          ))}
      </div>
    </section>
  );
}

function UsdaCalendar({
  reports,
  timeZone,
}: {
  reports: GrainWorkspace["usda_report_dates"];
  timeZone: string | null | undefined;
}) {
  // Only today and later, by the farm's own day: a past report is not "upcoming".
  const today = farmCalendarDate(new Date(), timeZone);
  const upcoming = reports
    .filter((report) => report.report_date >= today)
    .sort((left, right) => left.report_date.localeCompare(right.report_date))
    .slice(0, 8);
  return (
    <section className="grain-section usda-calendar">
      <div className="section-heading">
        <div>
          <h2>Upcoming USDA reports</h2>
          <p>WASDE, Grain Stocks, Prospective Plantings, and Crop Progress.</p>
        </div>
      </div>
      {upcoming.length === 0 ? (
        <div className="usda-empty">
          <p>No upcoming USDA report dates are loaded.</p>
          <a className="text-action" href="https://www.nass.usda.gov/Publications/Calendar/reports_by_date.php" target="_blank" rel="noreferrer">See the USDA report calendar</a>
        </div>
      ) : (
      <div className="report-grid">
        {upcoming.map((report) => (
          <a
            key={report.id}
            href={report.source_url ?? undefined}
            target="_blank"
            rel="noreferrer"
          >
            <strong>{report.report_name}</strong>
            <span>
              {new Date(`${report.report_date}T00:00:00`).toLocaleDateString(
                "en-US",
                { weekday: "short", month: "short", day: "numeric", year: "numeric" },
              )}
              {report.release_at
                ? ` · ${new Date(report.release_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                : ""}
            </span>
          </a>
        ))}
      </div>
      )}
    </section>
  );
}

export function TargetEditor({
  month,
  commodity,
  target,
  scope,
  services,
  workspace,
  error = "",
  onClose,
  onSave,
  onRemove,
}: {
  month: number;
  commodity: string;
  target?: MarketingPlanTarget;
  scope: PositionScope;
  services: GrainServices;
  workspace: GrainWorkspace;
  /** A save or remove that failed; shown inside the modal, where the farmer is looking. */
  error?: string;
  onClose: () => void;
  onSave: (values: {
    pct: number;
    price: number | null;
    relativePct: number | null;
    deadline: string | null;
  }) => void;
  /** Offered only for a month that already has a target. */
  onRemove?: () => void;
}) {
  const [formError, setFormError] = useState("");
  const [pct, setPct] = useState(
    String(target?.target_pct_of_production ?? ""),
  );
  const [price, setPrice] = useState(target?.target_price?.toString() ?? "");
  const [relative, setRelative] = useState(
    target?.breakeven_relative_pct?.toString() ?? "",
  );
  const [deadline, setDeadline] = useState(target?.deadline ?? "");
  const [breakeven, setBreakeven] = useState<number | null>(null);
  useEffect(() => {
    void services.profitabilityRepository
      .getBreakeven(scope, workspace.fields)
      .then(setBreakeven);
  }, [
    services,
    scope.farm_id,
    scope.crop_year,
    scope.commodity_id,
    scope.operating_entity_id,
    scope.enterprise_label,
    workspace.fields,
  ]);
  const relativeValue = relative === "" ? null : Number(relative);
  const computedPrice =
    breakeven !== null &&
    relativeValue !== null &&
    Number.isFinite(relativeValue)
      ? breakeven * (1 + relativeValue / 100)
      : null;
  return (
    <div className="target-modal-backdrop" role="presentation">
      <form
        className="target-modal"
        onSubmit={(event) => {
          event.preventDefault();
          // The plan's months together cannot pass 100% of the crop; say so here, with the total, before a save is tried.
          const others = scopeRows(workspace.marketing_plan_targets, scope)
            .filter((row) => row.id !== target?.id)
            .reduce((sum, row) => sum + row.target_pct_of_production, 0);
          if (others + Number(pct) > MARKETING_PLAN_PERCENT_TOLERANCE) {
            setFormError(`Your plan would add up to ${Math.round(others + Number(pct))}% of the crop. Lower this month or another so the total is 100% or less.`);
            return;
          }
          // A % over breakeven is stored as the price it works out to. With no breakeven there is no price,
          // and saving the old cash price beside the new % would store a number the screen is not showing.
          if (relative !== "" && computedPrice === null) {
            setFormError("Breakeven isn't available for this crop yet, so a % over breakeven can't be turned into a price. Clear that box and enter a cash price, or add this crop's costs in Profitability.");
            return;
          }
          setFormError("");
          onSave({
            pct: Number(pct),
            price: relative !== "" ? computedPrice : (price === "" ? null : Number(price)),
            relativePct: relativeValue,
            deadline: deadline || null,
          });
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{months[month - 1]} {scope.crop_year} plan</span>
            <h2>{commodity}</h2>
          </div>
          <button className="text-action" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <label>
          Target % of production
          <input
            required
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            inputMode="decimal"
            value={pct}
            onChange={(event) => setPct(event.target.value)}
          />
        </label>
        <label>
          Cash price target ($/bu) <small>optional; all-in cash price, including any premiums</small>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={relative !== "" ? (computedPrice === null ? "" : computedPrice.toFixed(2)) : price}
            disabled={relative !== ""}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
        <label>
          ROI target: % over breakeven{" "}
          <small>optional; computed price is stored</small>
          <input
            type="number"
            step="0.1"
            inputMode="decimal"
            value={relative}
            onChange={(event) => setRelative(event.target.value)}
          />
        </label>
        {relative !== "" && (
          <p className="computed-price">
            Breakeven{" "}
            {breakeven === null ? "not available" : money.format(breakeven)} →
            target {computedPrice === null ? "—" : money.format(computedPrice)}
          </p>
        )}
        <label>
          Deadline <small>optional</small>
          <input
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          />
        </label>
        {(formError || error) && (
          <p className="form-error" role="alert">{formError || error}</p>
        )}
        <div className="target-modal-actions">
          <button className="primary-action" type="submit">
            Save target
          </button>
          {onRemove && (
            <button className="secondary-action" type="button" onClick={onRemove}>
              Remove this month
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** LD-1: the load record. A scale ticket is the farm's primary field record of grain leaving a bin or
 * a field, and every figure LD-2 and LD-3 derive is built on it, so the ticket is captured exactly
 * once and never edited afterwards -- a wrong one is voided with a reason and re-entered. */
export function LoadsTab({ workspace, services, onSaved }: { workspace: GrainWorkspace; services: GrainServices; onSaved: () => Promise<void> }) {
  const available = workspace.capabilities?.grain_loads !== false;
  // A farm with no bins starts on "Off a field" rather than on an empty bin list.
  const [draft, setDraft] = useState<GrainLoadDraft>(() => ({ ...emptyLoadDraft(), origin_kind: workspace.grain_bins.length ? "bin" : "field" }));
  const [message, setMessage] = useState("");
  // Every problem with the form at once, listed beside the Save button, rather than one per tap.
  // Turned on by a Save that found problems and off by one that worked. While it is on, the list is
  // the live one, so a problem the farmer fixes drops off and the rest stay where they are.
  const [showProblems, setShowProblems] = useState(false);
  // What happened to a void, shown beside the Recent loads list where the Void button was tapped.
  const [voidMessage, setVoidMessage] = useState("");
  // The net bushels Farm Rx last filled in from the scale weights. While the box still holds exactly
  // that figure it follows the weights; once the farmer types their own, it is left alone.
  const netAuto = useRef<string | null>(null);
  // The contract the server last refused an over-delivery on. This screen's delivery list can be
  // behind (another device, or the capped list), and then it would never ask; the next Save on that
  // contract asks regardless, so the farmer is not refused the same way forever.
  const overdeliveryRefusedFor = useRef<string | null>(null);
  // Whether the ticket waiting on a retry failed with no signal at all, so letting it go can say so.
  const outstandingOffline = useRef(false);
  const formTop = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(createSubmitLock());
  // One id for one ticket, held until that ticket is saved. If the write commits but the response is
  // lost, pressing Save again sends the same id and the server replays the load it already recorded
  // instead of writing a second one. Minted at save time, never during render: the id generator is
  // shared and ordered, and taking one per render would shift the id the next real write gets.
  const loadId = useRef<string | null>(null);
  // LD-1: the farm's trucks, read only while this tab is open. They are deliberately not part of the
  // grain workspace, because Today serves its front door from the same load and a named rep's Today
  // must make no equipment read at all. A read that fails leaves the picker empty and the typed
  // truck name still works, so a truck is never the reason a ticket cannot be saved.
  const [trucks, setTrucks] = useState<LoadTruck[]>([]);
  useEffect(() => {
    let current = true;
    void services.grainRepository.listLoadTrucks().then((rows) => { if (current) setTrucks(rows) }).catch(() => { if (current) setTrucks([]) });
    return () => { current = false };
  }, [services]);
  // LD-4 repair (Codex P1 on ba64007): ask the database what THIS bin holds, rather than deriving
  // it from workspace.bin_transactions -- which loadWorkspace reads unbounded, so PostgREST's row
  // cap can drop the oldest movements and an older still-active crop year with them. The browser
  // would then see one lot where save_grain_load sees two, offer no choice, send no crop year, and
  // the save would be refused with "pick which one this load came from" while the form shows no
  // picker to answer with: a load the farmer simply cannot record.
  //
  // `undefined` means not asked yet or not answerable (offline, or the migration is not applied);
  // the derivation below is the fallback for exactly those cases, and it is the right answer there
  // because the pre-migration server reads the bin's baseline alone anyway.
  // LD-4 repair (Codex P2 on b8d5087, found by a journey that would not go green against the bug):
  // the answer is stored WITH the bin it is about, and with the refresh it was fetched for.
  //
  // It used to be two pieces of state -- the lots, and a status -- and they could disagree for a
  // render. Selecting a different bin changed originBinId immediately, while the status still said
  // 'ready' and the lots still belonged to the bin just left, because both are only corrected in an
  // effect that runs after the render. In that window the form auto-selected a lot from ANOTHER
  // BIN's list. That is the same defect this whole feature exists to prevent -- a lot chosen from a
  // list that is not the bin's -- one layer up from the truncation it was built for.
  //
  // Keyed this way a stale answer cannot be read at all, rather than merely being corrected soon.
  // The refresh count is part of the key for the same reason: after a save the list is known to be
  // out of date, and 'ready' must not be true again until the new read lands.
  const [lotRead, setLotRead] = useState<{ binId: string; refresh: number; lots: BinLotOnHand[] | null } | null>(null);
  const [lotsRefresh, setLotsRefresh] = useState(0);
  const originBinId = draft.origin_kind === "bin" ? draft.origin_grain_bin_id : "";
  const lotsForThisBin = lotRead && lotRead.binId === originBinId && lotRead.refresh === lotsRefresh ? lotRead : null;
  const lotsState: 'idle' | 'loading' | 'ready' | 'unavailable' = !originBinId ? 'idle'
    : !lotsForThisBin ? 'loading'
    : lotsForThisBin.lots ? 'ready' : 'unavailable';
  const authoritativeLots = lotsForThisBin?.lots ?? undefined;
  const lotsUnavailable = lotsState === 'unavailable';
  useEffect(() => {
    if (!originBinId) return;
    let current = true;
    const forBin = originBinId;
    const forRefresh = lotsRefresh;
    void services.grainRepository.listBinLots(forBin)
      // Null is "the database could not say" -- the function is not installed, or there is no
      // signal. Either way it is not an empty bin, and it must not be read as one.
      .then((lots) => { if (current) setLotRead({ binId: forBin, refresh: forRefresh, lots }) })
      .catch(() => { if (current) setLotRead({ binId: forBin, refresh: forRefresh, lots: null }) });
    return () => { current = false };
  }, [services, originBinId, lotsRefresh]);
  // LD-4 repair (Codex P1 on bba6b10): while a ticket id is outstanding -- a save whose outcome is
  // unknown, which LD-1 keeps deliberately so a retry replays rather than duplicating -- THE LOT
  // MUST NOT MOVE. Three separate mechanisms were free to change it: the post-attempt refresh, the
  // effect that drops a vanished year, and the effect that fills in a lone one. Together they could
  // retry the same ticket id under a different crop year, and save_grain_load would answer
  // FARM_RX_LOAD_ID_REUSED -- refusing a load that was already recorded.
  //
  // The list still refreshes, because the picker should show the truth. What is frozen is the
  // DRAFT'S CHOICE, which is what the outstanding ticket was sent with. A ref cannot be watched by
  // an effect, so it is mirrored here.
  const [ticketOutstanding, setTicketOutstanding] = useState(false);
  const redraft = () => { loadId.current = null; setTicketOutstanding(false) };
  // The effect flags are a preference and deliberately survive a change of shape: a box the farmer
  // never touched keeps its default, and one they unticked stays unticked. What a load will
  // actually do is narrowed once, where it is sent.
  // Any edit starts a new ticket, so the last ticket's "Load saved" goes with it. While a ticket is
  // outstanding every input is disabled, so an edit can never drop the id a retry needs.
  const update = (patch: Partial<GrainLoadDraft>) => { redraft(); setMessage(""); setDraft((current) => ({ ...current, ...patch })) };

  const effectsReady = workspace.capabilities?.grain_load_effects !== false;
  const binLotReady = workspace.capabilities?.grain_load_bin_lot !== false;
  const recordedLots = draft.origin_kind === "bin" && binLotReady
    ? (authoritativeLots ?? originBinLots(workspace, draft.origin_grain_bin_id))
    : [];
  // What the bin can actually give up today. Defaulting uses only these, exactly as the server
  // does: a lot at zero is a real lot with nothing left in it, and is no answer to "which year".
  const onHandLots = recordedLots.filter((binLot) => binLot.bushels > 0.000001);
  // LD-4 repair (Codex P2 on 46d5252): what a farmer may NAME is a wider list than what the form
  // may default to. A load that moves no bushels is a record of something that already happened,
  // so an emptied lot is a legitimate answer for it, and save_grain_load accepts one. A load that
  // does move bushels would be refused by the bin, so those years are not offered at all.
  const movesBushels = effectsReady && draft.origin_kind === "bin" && draft.effect_bin_out;
  const originLots = movesBushels ? onHandLots : recordedLots;
  // The same split decides the lot itself: a year the farmer named is resolved against everything
  // the bin has a record of, and a year nobody named is defaulted from whatever this load could
  // legitimately have been offered.
  //
  // LD-4 repair (Codex P2 on 2e7e6d4): that second list is originLots, not onHandLots. A bin whose
  // only record is an emptied lot shows one line rather than a picker -- correctly, there is
  // nothing to choose between -- and defaulting against what the bin still HOLDS would then find
  // nothing, so a ticket that moves no bushels was refused with no control on screen to answer
  // with. Defaulting against the same list the form offered keeps the two in step: when the load
  // moves bushels, originLots is onHandLots and nothing changes.
  const lotsForResolution = draft.origin_crop_year.trim() ? recordedLots : originLots;
  const lot = loadLotFor(workspace, draft, binLotReady ? lotsForResolution : undefined);
  const todayLocal = localCalendarDay(new Date());
  const futureDate = loadDateInFutureProblem(draft.load_date, todayLocal);
  const problems = [...validateGrainLoad(draft, workspace, binLotReady ? lotsForResolution : undefined), ...(futureDate ? [futureDate] : [])];
  const cropAssignments = workspace.fields.crop_assignments;
  // Pounds per bushel for the crop this load is, once the origin has said which crop that is.
  const lbsPerBushel = lot ? STANDARD_BUSHEL_LBS[workspace.fields.commodities.find((item) => item.id === lot.commodity_id)?.crop_family ?? "corn"] : null;
  // Gross and tare fill in net bushels while the net box is empty or still holds the last figure
  // worked out here. Commas and spaces typed off a ticket are dropped, so the draft holds a number.
  const updateWeight = (patch: { gross_lbs?: string; tare_lbs?: string }) => {
    const next = { ...draft, ...patch };
    const worked = lbsPerBushel ? netBushelsFromWeights(next.gross_lbs, next.tare_lbs, lbsPerBushel) : null;
    if (worked !== null && (!draft.net_bushels.trim() || draft.net_bushels === netAuto.current)) {
      netAuto.current = worked;
      update({ ...patch, net_bushels: worked });
    } else update(patch);
  };
  // The figure the weights give for the crop this load is now. The hint is judged against this,
  // not against what was filled in earlier, so it never vouches for a figure worked at another
  // crop's lb/bu.
  const workedNet = lbsPerBushel ? netBushelsFromWeights(draft.gross_lbs, draft.tare_lbs, lbsPerBushel) : null;
  // When the crop changes under typed weights -- another field crop, another bin, or the bin's lot
  // read landing after the weights were typed -- the filled-in figure is worked again. A net the
  // farmer typed is left alone, and a ticket waiting on a retry is never touched.
  const lastLbsPerBushel = useRef(lbsPerBushel);
  useEffect(() => {
    if (lastLbsPerBushel.current === lbsPerBushel) return;
    lastLbsPerBushel.current = lbsPerBushel;
    if (ticketOutstanding || workedNet === null || draft.net_bushels === workedNet) return;
    if (draft.net_bushels.trim() && draft.net_bushels !== netAuto.current) return;
    netAuto.current = workedNet;
    setDraft((current) => ({ ...current, net_bushels: workedNet }));
  }, [lbsPerBushel, workedNet, ticketOutstanding, draft.net_bushels]);
  const numberTyped = (value: string) => value.replace(/[,\s]/g, "");
  const contractLeft = (contract: GrainContract) => contractUndeliveredBushels(contract, workspace.grain_contract_deliveries);
  // The contracts this load could go against, with what is still left to deliver on each. The one
  // already chosen always stays in the list, so the box never looks blank while the draft holds it;
  // if it no longer fits the load, Save says why.
  const contractOptions = workspace.grain_contracts
    .filter((contract) => contract.id === draft.destination_grain_contract_id || !lot || (contract.commodity_id === lot.commodity_id && contract.crop_year === lot.crop_year))
    .map((contract) => ({ contract, left: contractLeft(contract) }))
    .sort((a, b) => Number(b.left > 0) - Number(a.left > 0) || a.contract.buyer.localeCompare(b.contract.buyer));
  const chosenContract = contractOptions.find((option) => option.contract.id === draft.destination_grain_contract_id) ?? null;
  // An open contract with the buyer typed in, for this load's crop and year: the load probably fills
  // it, and only a load against the contract counts as delivered.
  const typedBuyer = draft.destination_buyer.trim().toLowerCase();
  const buyerContract = draft.destination_kind === "buyer" && typedBuyer && lot
    ? workspace.grain_contracts
      .filter((contract) => contract.buyer.trim().toLowerCase() === typedBuyer && contract.commodity_id === lot.commodity_id && contract.crop_year === lot.crop_year)
      .map((contract) => ({ contract, left: contractLeft(contract) }))
      .find((option) => option.left > 0) ?? null
    : null;
  const problemAbout = (pattern: RegExp) => (showProblems && problems.some((problem) => pattern.test(problem))) || undefined;
  const commodityLabel = (id: string) => workspace.fields.commodities.find((item) => item.id === id)?.name ?? id;
  const binName = (id: string | null) => workspace.grain_bins.find((bin) => bin.id === id)?.name ?? "a bin";
  const fieldName = (assignmentId: string | null) => {
    const assignment = cropAssignments.find((row) => row.id === assignmentId);
    if (!assignment) return "a field";
    const field = workspace.fields.fields.find((row) => row.id === assignment.field_id);
    return field ? field.name : "a field";
  };
  const contractLabel = (id: string | null) => {
    const contract = workspace.grain_contracts.find((row) => row.id === id);
    return contract ? `${contract.buyer} (${contract.crop_year})` : "the contract";
  };
  // LD-2: the effects this load's shape can reach, and the ones the farmer has actually ticked.
  // While the migration is not applied the columns do not exist, so no effect is offered at all --
  // ticking one would produce a database error rather than a moved bushel.
  // LD-4: the lots this bin actually holds. While the migration is not applied the installed RPC
  // still reads the bin's baseline alone, so no choice is offered -- offering one would let a
  // farmer pick a year and be refused on save, which is LD-006 finding 1 with the roles reversed.

  // LD-4 repair (Codex P1 on 1b441f6): when the bin offers exactly one lot the form shows it as a
  // sentence and asks nothing -- and used to send nothing, leaving the server to work the lot out
  // again at save time. Between the read and the save another device can empty that lot and add a
  // different one, and the server would then resolve to the NEW sole lot: the ticket records a crop
  // the screen never named, with no error and nothing to undo it.
  //
  // So the form now states what it showed. This is not the browser deciding the lot -- LD-1 was
  // right that it must not -- it is the browser asserting what the farmer was looking at, exactly
  // as a contract edit sends the updated_at it was shown. The server still decides: it refuses a
  // lot the bin has no record of, and append_bin_movement still refuses to draw bushels that are
  // not there. A stale expectation becomes a loud refusal instead of a quiet wrong ticket.
  // Only from a SETTLED list. While the read is in flight originLots falls back to the workspace
  // derivation -- the truncated list this whole repair exists to stop trusting -- and a bin that
  // really holds two lots can look like one for those few hundred milliseconds. Filling the draft
  // from that would silently answer a question the farmer was about to be asked. Caught by the
  // browser journey, not by reading: the picker still appeared, but with a choice already made.
  useEffect(() => {
    if (!binLotReady || lotsState !== 'ready' || ticketOutstanding) return;
    if (draft.origin_crop_year.trim() || originLots.length !== 1) return;
    const only = originLots[0]!;
    setDraft((current) => ({ ...current, origin_crop_year: String(only.crop_year), origin_commodity_id: only.commodity_id }));
  }, [binLotReady, lotsState, ticketOutstanding, draft.origin_crop_year, originLots]);

  // LD-4 repair (Codex P2 on da028bf): the form keeps the origin and the chosen crop year for the
  // next ticket, and a save can empty the lot that year names. The picker then drops to one lot and
  // stops rendering, while the draft still holds the emptied year -- so validation refuses every
  // further save and the control that could fix it is no longer on screen. Dropping a year the bin
  // no longer offers puts the form back in a state the farmer can actually act on.
  //
  // LD-4 repair (Codex P2 on a05ee47): and an EMPTY list is the case that matters most, not the one
  // to skip. Hauling the last bushels out of a one-lot bin leaves originLots empty, the screen
  // saying the bin holds no crop year, and the draft still naming the year it just emptied -- which
  // resolves against the recorded list, passes validation, and reaches the RPC only to come back
  // FR001, with no picker on screen to repair it. The early return on length 0 was the hole.
  //
  // It was there to stop a transient empty list from wiping a real choice, and that danger is real:
  // every refresh clears authoritativeLots first, so the fallback derivation -- the truncated one --
  // stands in for a moment. The answer is the gate its twin already had. Waiting for a SETTLED list
  // makes an empty one mean what it says, and the two effects now read the same list under the same
  // condition instead of one trusting it and the other guessing around it.
  useEffect(() => {
    if (!binLotReady || lotsState !== 'ready' || ticketOutstanding) return;
    if (!draft.origin_crop_year.trim()) return;
    if (originLots.some((binLot) => String(binLot.crop_year) === draft.origin_crop_year.trim()
      && (!draft.origin_commodity_id || binLot.commodity_id === draft.origin_commodity_id))) return;
    setDraft((current) => ({ ...current, origin_crop_year: "", origin_commodity_id: "" }));
  }, [binLotReady, lotsState, ticketOutstanding, draft.origin_crop_year, draft.origin_commodity_id, originLots]);
  const availableEffects = effectsReady ? loadEffectsAvailable(draft) : [];
  const confirmedEffects = confirmedLoadEffects(draft);
  const typedNet = Number(draft.net_bushels);
  const bushelLabel = draft.net_bushels.trim() && Number.isFinite(typedNet) && typedNet > 0
    ? `${typedNet.toLocaleString()} bu`
    : "these bushels";
  // The same four effects said as a sentence, so what is about to happen reads as English rather
  // than as a column of ticked boxes -- and, once saved, as what already happened.
  const effectWords = (past: boolean) => {
    const phrases = confirmedEffects.map((key) => {
      if (key === "bin_out") return `${past ? "took" : "takes"} ${bushelLabel} out of ${binName(draft.origin_grain_bin_id)}`;
      if (key === "bin_in") return `${past ? "put" : "puts"} ${bushelLabel} into ${binName(draft.destination_grain_bin_id)}`;
      if (key === "contract_delivery") return `${past ? "recorded" : "records"} ${bushelLabel} delivered against ${contractLabel(draft.destination_grain_contract_id)}`;
      return `${past ? "counted" : "counts"} ${bushelLabel} toward ${fieldName(draft.origin_crop_assignment_id)}\u2019s harvest`;
    });
    return phrases.length <= 1 ? phrases.join("") : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
  };
  const effectSentence = effectWords(false);

  const save = async () => {
    if (!lock.current.acquire()) return;
    try {
      // These speak to the farmer directly about the form in front of them. Routing them through the
      // error taxonomy would turn "pick the bin" into "Farm Rx could not record this load right now".
      // LD-4 repair: the capability says the server reads lots, but this bin's lots could not be
      // read. Falling back to the workspace derivation here would be the guess that causes the
      // defect -- a short movement list looks exactly like a one-lot bin. Fail closed instead.
      if (binLotReady && originBinId && lotsState !== 'ready') {
        setMessage(lotsState === 'loading'
          ? "Still reading what this bin holds. Try again in a moment."
          : "Farm Rx could not read what this bin holds. Check your signal and try again.");
        return;
      }
      if (problems.length) { setMessage(""); setShowProblems(true); return }
      // The same scale ticket entered twice is the classic double count. Asked only for a fresh
      // ticket: a retry is the same ticket by definition. Best effort, because the recent-loads list
      // is capped, and never a hard stop, because two elevators can use the same ticket number.
      if (!loadId.current) {
        const ticket = draft.ticket_number.trim().toLowerCase();
        const duplicate = ticket ? workspace.grain_loads.find((row) => !row.voided_at && (row.ticket_number ?? "").trim().toLowerCase() === ticket) : undefined;
        if (duplicate && !(await confirmDialog({
          title: `Ticket ${draft.ticket_number.trim()} is already entered`,
          body: `It was saved on ${formatFarmDate(duplicate.load_date)} for ${displayBushels(duplicate.net_bushels)} bu. Save another load with the same ticket number?`,
          confirmLabel: "Save anyway",
        }))) return;
      }
      // The last load on a contract often runs a little over. The server refuses that unless it is
      // confirmed, exactly as a delivery recorded on the contract itself is, so ask first and send the
      // answer with the save. Asked again on a retry, as the contract's own delivery does.
      let allowOverdelivery = false;
      if (effectsReady && normalizeLoadEffects(draft).effect_contract_delivery) {
        const contract = workspace.grain_contracts.find((row) => row.id === draft.destination_grain_contract_id);
        const excess = contract ? Number(draft.net_bushels) - contractLeft(contract) : 0;
        const refusedBefore = !!contract && overdeliveryRefusedFor.current === contract.id;
        if (excess > 0.000001 || refusedBefore) {
          if (!(await confirmDialog({
            title: excess > 0.000001
              ? `This load is ${preciseBushels.format(excess)} bu more than is left on the contract. Record anyway?`
              : "This load is more than is left on the contract. Record anyway?",
            body: excess > 0.000001
              ? "The contract will show as over-delivered."
              : "Farm Rx has more deliveries on this contract than this screen shows. The contract will show as over-delivered.",
            confirmLabel: "Record anyway",
          }))) return;
          allowOverdelivery = true;
        }
      }
      setSaving(true);
      loadId.current ??= services.createGrainId();
      setTicketOutstanding(true);
      // The effect flags are a preference that survives a change of shape, and they default to
      // ticked. While the migration is not applied this page shows no effects at all and says the
      // save records only the ticket -- but the flags are still true underneath. If the migration
      // lands while this page stays open, the very next save would reach the new RPC and perform
      // bin, contract and harvest effects the farmer was never shown. What the screen says it will
      // do is what gets sent, so the flags are cleared here rather than trusted.
      const outgoing0 = effectsReady
        ? draft
        : { ...draft, effect_bin_out: false, effect_bin_in: false, effect_contract_delivery: false, effect_harvest: false };
      // LD-4, for the same reason as the line above: while the capability is false the form shows no
      // crop year choice, so it must send none either. A stale value surviving in the draft would
      // reach an RPC that reads the baseline alone and be refused.
      // LD-4 repair (Codex P2 on 85074fb): the lot that goes on the wire is the one THIS RENDER
      // resolved, taken straight from `lot` rather than from a draft field an effect has to fill in
      // afterwards.
      //
      // "The form states the lot it showed" was already the rule, but it was implemented by an
      // effect that runs after the render commits -- so between the read landing and that effect
      // flushing, the screen said "this bin holds one crop year" while Save was enabled and the
      // payload still carried nothing. Saving in that window let the server default instead: to a
      // replacement lot if another device had swapped it, recording a crop the screen never named,
      // or to nothing at all for a lone emptied lot, refusing a ticket the screen was offering.
      //
      // `lot` is what loadLotFor resolved from the same list the screen rendered, so this cannot
      // disagree with what the farmer was looking at, and it no longer depends on effect timing.
      const outgoing = !binLotReady
        ? { ...outgoing0, origin_crop_year: "", origin_commodity_id: "" }
        : draft.origin_kind === "bin" && lot
          ? { ...outgoing0, origin_crop_year: String(lot.crop_year), origin_commodity_id: lot.commodity_id }
          : outgoing0;
      // What this save did beyond the ticket, captured before the draft is cleared below.
      const didAlso = effectsReady && confirmedEffects.length ? effectWords(true) : "";
      const movedOrDelivered = effectsReady && confirmedEffects.some((key) => key !== "harvest");
      const saved = await services.grainRepository.saveLoad(loadId.current, allowOverdelivery ? { ...outgoing, allow_overdelivery: true } : outgoing);
      loadId.current = null;
      setTicketOutstanding(false);
      setShowProblems(false);
      overdeliveryRefusedFor.current = null;
      // The next ticket almost always shares the date, the truck and the origin -- a farmer hauling
      // out of one bin all afternoon should not retype them. The weights, moisture and ticket number
      // are what change per load, so only those are cleared.
      netAuto.current = null;
      setDraft((current) => ({ ...current, gross_lbs: "", tare_lbs: "", net_bushels: "", moisture_pct: "", ticket_number: "", notes: "" }));
      // The load already did its bin movement and delivery, so the farmer is told not to add them
      // again by hand -- three ways to record the same grain is how it gets counted twice.
      setMessage(`Load saved: ${displayBushels(saved.net_bushels)} bu of ${commodityLabel(saved.commodity_id)}, ${saved.crop_year} crop. ${didAlso
        ? `It ${didAlso}.${movedOrDelivered ? " Don’t add a separate bin movement or delivery for it." : ""}`
        : "It changed nothing else in Farm Rx."}`);
      await onSaved();
    } catch (error) {
      // LD-4 repair (Codex P2 on c6790ca): a DEFINITIVE refusal rolled the transaction back, so no
      // ticket exists and the lot must be free to move again. Leaving it frozen after, say, an
      // FR001 stranded the farmer: the refresh below shows the lot that replaced theirs, the
      // auto-select and clear-vanished effects stay disabled, and every retry resubmits the stale
      // one until they switch bins. The freeze is only ever right while the outcome is UNKNOWN.
      //
      // isTransportFailure is the codebase's existing answer to exactly this question -- it is what
      // decides "confirmation needed" from "needs attention" on a bin movement or a delivery. A
      // second classifier here would be a second thing to keep in step, which is the mistake this
      // tranche has now made twice. Offline counts as unknown: the queued repository refuses before
      // sending, so nothing was committed, but the lot has nowhere to go until the signal is back.
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      // Kept in the exact shape the foundation guard pins (ld4:a-refused-save-lets-its-lot-go).
      if (!isTransportFailure(error, typeof navigator !== 'undefined' && navigator.onLine === false)) {
        loadId.current = null;
        setTicketOutstanding(false);
      }
      if (loadId.current === null) {
        setMessage(farmerError(error, "record this load"));
        // The server counts more delivered on this contract than this screen does. Read the contracts
        // again, and ask about the over-delivery on the next Save whatever the list then says.
        if (isOverdeliveryRefusal(error)) {
          overdeliveryRefusedFor.current = draft.destination_grain_contract_id || null;
          await onSaved().catch(() => undefined);
        }
      } else {
        outstandingOffline.current = offline;
        // The outcome is unknown, so the ticket is kept and the form is locked to it. Offline, the
        // queued repository refused before sending, so nothing can have been saved yet; otherwise the
        // write may have committed with only its answer lost, and the farmer has to know that before
        // entering the load a second time.
        setMessage(offline
          ? `${farmerError(error, "record this load")} Tap Retry load when you have signal: it keeps the same ticket.`
          : "This load may already be saved, but Farm Rx could not confirm it. Tap Retry load: it keeps the same ticket and will not create a second one.");
      }
    } finally {
      // LD-4 repair (Codex P2 on f4b614d): read the bin's lots again after ANY attempt, not only
      // after one that worked. A save refused because another truck changed the bin is exactly the
      // moment the form's list is known to be wrong, and refreshing only on success left the
      // farmer retrying against the same stale list until they switched bins or reloaded.
      //
      // Three findings on this tranche were the same asymmetry -- refresh after a save, then also
      // after a void, then also after a failure. One line covering every outcome replaces all
      // three, because the rule was never "after a success": it is "after touching this bin".
      if (originBinId) setLotsRefresh((count) => count + 1);
      lock.current.release();
      setSaving(false);
    }
  };

  const voidLoad = async (load: GrainLoad) => {
    if (!lock.current.acquire()) return;
    try {
      setVoidMessage("");
      // The title names the load, so the farmer can see it is the right ticket before voiding it.
      const reason = await promptDialog({
        title: `Void the ${formatFarmDate(load.load_date)} load of ${displayBushels(load.net_bushels)} bu${load.ticket_number ? ` (ticket ${load.ticket_number})` : ""}?`,
        body: "Say why this ticket is being voided. The ticket stays on the record with your reason. Recording the correct one is a separate entry.",
        confirmLabel: "Void this load",
        label: "Reason",
        placeholder: "Weighed on a broken scale",
        required: true,
        destructive: true,
      });
      if (reason === null) return;
      const problem = validateLoadVoidReason(reason);
      if (problem) { setVoidMessage(problem); return }
      setSaving(true);
      const result = await services.grainRepository.voidLoad(load.id, reason);
      // LD-2: a void the bin cannot take changed NOTHING -- not the ledger, not the delivery, not
      // the ticket. Reporting it as done would leave the farmer believing bushels moved back when
      // they did not, so the blocked answer gets its own words and names what is in the way.
      if (result.status === "blocked") {
        const movements = result.blockedBy
          .map((entry) => `${displayBushels(entry.bushels)} bu ${entry.direction === "in" ? "into" : "out of"} ${binName(entry.grain_bin_id)} on ${formatFarmDate(entry.occurred_on)}`)
          .join("; ");
        // Movements cannot be edited, so "deal with it" is spelled out as the two things that work.
        setVoidMessage(movements
          ? `This ticket cannot be voided yet, because grain moved through that bin after it: ${movements}. To undo it, first void the later load that moved that grain. If that later movement was itself a mistake, undo it with “Add or take out grain” on that bin under Bins & basis. Then void this ticket. Nothing was changed.`
          : "This ticket cannot be voided yet, because the bins it touched have changed since. Nothing was changed.");
        await onSaved();
        return;
      }
      setVoidMessage("Load voided. Everything it did has been undone, and it stays on the list with your reason.");
      await onSaved();
    } catch (error) {
      setVoidMessage(farmerError(error, "void this load"));
    } finally {
      // LD-4 repair (Codex P2 on 46d5252, corrected on c231a00): a void writes compensating
      // movements, so a lot the voided load had emptied is holding grain again -- and onSaved
      // refreshes the workspace but not this read, whose answer wins over it.
      //
      // After ANY attempt, not just a successful one. A BLOCKED void returns early, and a blocked
      // void is precisely the case where later movements changed the bins: the one outcome that
      // most needs a fresh list was the one that skipped it. This is the same success-only
      // asymmetry the save path had, fixed the same way rather than patched a second time.
      setLotsRefresh((count) => count + 1);
      lock.current.release();
      setSaving(false);
    }
  };

  const fieldCropYears = [...new Set(cropAssignments.map((assignment) => assignment.crop_year))].sort((a, b) => b - a);
  const destinationBins = workspace.grain_bins.filter((bin) => bin.id !== draft.origin_grain_bin_id);
  const typedTicket = draft.ticket_number.trim().toLowerCase();
  const duplicateTicket = typedTicket && !ticketOutstanding
    ? workspace.grain_loads.find((row) => !row.voided_at && (row.ticket_number ?? "").trim().toLowerCase() === typedTicket)
    : undefined;
  // What the recent tickets add up to, per crop and crop year. Voided tickets count toward nothing.
  const loadTotals = [...activeLoads(workspace.grain_loads).reduce((groups, row) => {
    const key = `${row.commodity_id}:${row.crop_year}`;
    const group = groups.get(key) ?? { commodityId: row.commodity_id, cropYear: row.crop_year, count: 0, bushels: 0 };
    groups.set(key, { ...group, count: group.count + 1, bushels: group.bushels + row.net_bushels });
    return groups;
  }, new Map<string, { commodityId: string; cropYear: number; count: number; bushels: number }>()).values()]
    .sort((a, b) => b.cropYear - a.cropYear || commodityLabel(a.commodityId).localeCompare(commodityLabel(b.commodityId)));

  // Letting go of an outstanding ticket is deliberate: it may already be saved, and entering it
  // again under a new id would count it twice. So its weights, net and ticket number are cleared as a
  // saved ticket's are, and the loads are read again so Recent loads and the same-ticket check can
  // see it if it did land.
  const startDifferentTicket = async () => {
    if (!(await confirmDialog({
      title: "Start a different ticket?",
      body: outstandingOffline.current
        ? "There was no signal, so the last load most likely was not saved. Its weights and ticket number are cleared. Check Recent loads when your signal is back before entering it again."
        : "The last load may already be saved. Its weights and ticket number are cleared. Check Recent loads before entering it again.",
      confirmLabel: "Start a different ticket",
    }))) return;
    redraft();
    setMessage("");
    netAuto.current = null;
    setDraft((current) => ({ ...current, gross_lbs: "", tare_lbs: "", net_bushels: "", moisture_pct: "", ticket_number: "", notes: "" }));
    await onSaved().catch(() => undefined);
  };

  // Fill the form from a voided ticket so it can be fixed and saved as a new one. It goes through
  // update(), so it is a fresh ticket with a fresh id; nothing is saved until the farmer taps Save.
  // What the voided ticket did comes with it, so a record-only ticket is not copied into one that
  // moves bushels; and a ticket half typed in the form is not replaced without asking.
  const copyToNewTicket = async (load: GrainLoad) => {
    if ([draft.gross_lbs, draft.tare_lbs, draft.net_bushels, draft.ticket_number].some((value) => value.trim()) && !(await confirmDialog({
      title: "Replace the ticket you are typing?",
      body: "The form already has a ticket in it. Copying the voided ticket replaces what you typed.",
      confirmLabel: "Replace it",
    }))) return;
    netAuto.current = null;
    update({
      load_date: load.load_date,
      origin_kind: load.origin_kind,
      origin_grain_bin_id: load.origin_grain_bin_id ?? "",
      origin_crop_assignment_id: load.origin_crop_assignment_id ?? "",
      origin_crop_year: load.origin_kind === "bin" ? String(load.crop_year) : "",
      origin_commodity_id: load.origin_kind === "bin" ? load.commodity_id : "",
      destination_kind: load.destination_kind,
      destination_buyer: load.destination_buyer ?? "",
      destination_grain_contract_id: load.destination_grain_contract_id ?? "",
      destination_grain_bin_id: load.destination_grain_bin_id ?? "",
      gross_lbs: load.gross_lbs?.toString() ?? "",
      tare_lbs: load.tare_lbs?.toString() ?? "",
      net_bushels: String(load.net_bushels),
      moisture_pct: load.moisture_pct?.toString() ?? "",
      ticket_number: load.ticket_number ?? "",
      truck_equipment_id: load.truck_equipment_id ?? "",
      truck_name: load.truck_equipment_id ? "" : load.truck_name ?? "",
      notes: "",
      effect_bin_out: load.effect_bin_out,
      effect_bin_in: load.effect_bin_in,
      effect_contract_delivery: load.effect_contract_delivery,
      effect_harvest: load.effect_harvest,
    });
    setVoidMessage("");
    setMessage("Copied from the voided ticket. Fix what was wrong, then tap Save load.");
    formTop.current?.scrollIntoView?.({ block: "start" });
  };

  if (!available) {
    return (
      <section className="grain-section loads-card">
        <div className="section-heading"><div><span className="eyebrow">Scale tickets</span><h2>Loads</h2></div></div>
        <p role="status">{LOAD_RECORD_PENDING} Reload the app after the update.</p>
      </section>
    );
  }

  return (
    <section className="grain-section loads-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Scale tickets</span>
          <h2>Loads</h2>
          <p>Enter each load as it is hauled. To fix a saved ticket, void it and enter it again.</p>
        </div>
      </div>

      <div className="load-form" ref={formTop}>
        {/* While a ticket's outcome is unknown every field is locked to what was sent, so Retry load
            resends that same ticket and no edit can quietly start a second one. The Save button sits
            outside, because it is how the retry is made. */}
        <fieldset className="load-fields" disabled={ticketOutstanding}>
        <label>Date hauled<input type="date" max={todayLocal} aria-invalid={problemAbout(/date/i)} value={draft.load_date} onChange={(event) => update({ load_date: event.target.value })} /></label>

        <fieldset className="load-origin">
          <legend>Where it came from</legend>
          <label><input type="radio" name="load-origin" checked={draft.origin_kind === "bin"} onChange={() => update({ origin_kind: "bin", origin_crop_assignment_id: "", origin_crop_year: "", origin_commodity_id: "" })} /> Out of a bin</label>
          <label><input type="radio" name="load-origin" checked={draft.origin_kind === "field"} onChange={() => update({ origin_kind: "field", origin_grain_bin_id: "", origin_crop_year: "", origin_commodity_id: "" })} /> Off a field</label>
          {draft.origin_kind === "bin" ? (
            <>
              {/* A year chosen for one bin means nothing in another, so picking a bin clears it. */}
              <label>Bin<select value={draft.origin_grain_bin_id} aria-invalid={problemAbout(/^Pick the bin this load came from|^That bin holds no crop|^That bin has no recorded/)} onChange={(event) => update({ origin_grain_bin_id: event.target.value, origin_crop_year: "", origin_commodity_id: "" })}>
                <option value="">Pick a bin</option>
                {workspace.grain_bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.name}</option>)}
              </select></label>
              {workspace.grain_bins.length === 0 && <small className="load-hint">No bins yet. <Link to="/grain/storage">Add one under Bins &amp; basis</Link>, or pick &ldquo;Off a field&rdquo;.</small>}
              {/* LD-4: the amendment's rule, on screen. A bin holding one lot answers for itself and
                  the farmer taps nothing; a bin holding several asks, because guessing between a
                  carry-over lot and this year's crop is the defect the whole initiative exists to
                  stop. The bushels beside each year are what that lot holds, so the choice is made
                  against the bin rather than from memory. */}
              {binLotReady && draft.origin_grain_bin_id && lotsUnavailable ? (
                <p className="load-lot">Farm Rx could not read what this bin holds right now, so it cannot say which crop year this load is.</p>
              ) : binLotReady && draft.origin_grain_bin_id ? (
                originLots.length === 0 ? (
                  <p className="load-lot">This bin holds no crop with a crop year yet. If it has grain in it, tap &ldquo;Add or take out grain&rdquo; on that bin under Bins &amp; basis and add an &ldquo;In&rdquo; for it.</p>
                ) : originLots.length === 1 ? (
                  <p className="load-lot">This bin holds one crop year: <strong>{originLots[0].crop_year} {commodityLabel(originLots[0].commodity_id)}</strong>, {Math.round(originLots[0].bushels).toLocaleString()} bu.</p>
                ) : (
                  <label>Crop year<select
                    value={draft.origin_crop_year ? `${draft.origin_commodity_id}:${draft.origin_crop_year}` : ""}
                    aria-invalid={problemAbout(/crop year/i)}
                    onChange={(event) => {
                      // LD-4 repair: the value is the whole lot, not half of it. A bin can have a
                      // record of 2025 soybeans and 2025 corn, so a year on its own names neither.
                      const [commodity, year] = event.target.value.split(":");
                      update({ origin_commodity_id: commodity ?? "", origin_crop_year: year ?? "" });
                    }}>
                    <option value="">Pick which crop year</option>
                    {originLots.map((binLot) => (
                      <option key={`${binLot.commodity_id}:${binLot.crop_year}`} value={`${binLot.commodity_id}:${binLot.crop_year}`}>
                        {binLot.crop_year} {commodityLabel(binLot.commodity_id)} &middot; {Math.round(binLot.bushels).toLocaleString()} bu
                      </option>
                    ))}
                  </select></label>
                )
              ) : null}
            </>
          ) : (
            <label>Field crop<select value={draft.origin_crop_assignment_id} aria-invalid={problemAbout(/field crop/i)} onChange={(event) => update({ origin_crop_assignment_id: event.target.value })}>
              <option value="">Pick a field crop</option>
              {/* Newest crop year first, fields A to Z within it. Older years stay for carry-over loads. */}
              {fieldCropYears.map((year) => (
                <optgroup key={year} label={`${year} crop`}>
                  {cropAssignments
                    .filter((assignment) => assignment.crop_year === year)
                    .sort((a, b) => fieldName(a.id).localeCompare(fieldName(b.id)))
                    .map((assignment) => (
                      <option key={assignment.id} value={assignment.id}>
                        {fieldName(assignment.id)} &middot; {commodityLabel(assignment.commodity_id)} &middot; {assignment.crop_year}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select></label>
          )}
          {/* The origin decides the lot, and the farmer is shown what it decided. A load that guessed
              between carry-over and current-year grain of the same commodity would let old bushels pay
              down a new contract, so this is never a field the farmer types. */}
          <p className="load-lot" role="status">
            {lot
              ? `This load is ${commodityLabel(lot.commodity_id)}, ${lot.crop_year} crop.`
              : draft.origin_kind === "bin"
                ? binLotReady
                  ? "Pick a bin. If it shows no crop year yet but has grain in it, tap “Add or take out grain” on that bin under Bins & basis and add an “In” for it."
                  : "Pick a bin. A bin with no recorded starting amount cannot name its crop year until the next database update."
                : "Pick the field crop, and Farm Rx takes the crop and year from it."}
          </p>
        </fieldset>

        <fieldset className="load-destination">
          <legend>Where it went</legend>
          <label><input type="radio" name="load-destination" checked={draft.destination_kind === "buyer"} onChange={() => update({ destination_kind: "buyer", destination_grain_contract_id: "", destination_grain_bin_id: "" })} /> A buyer or elevator</label>
          <label><input type="radio" name="load-destination" checked={draft.destination_kind === "contract"} onChange={() => update({ destination_kind: "contract", destination_buyer: "", destination_grain_bin_id: "" })} /> Against a contract</label>
          <label><input type="radio" name="load-destination" checked={draft.destination_kind === "bin"} onChange={() => update({ destination_kind: "bin", destination_buyer: "", destination_grain_contract_id: "" })} /> Into a bin</label>
          {draft.destination_kind === "buyer" && (
            <>
              <label>Buyer or elevator<input type="text" list="load-buyer-suggestions" autoComplete="off" aria-invalid={problemAbout(/buyer/i)} value={draft.destination_buyer} onChange={(event) => update({ destination_buyer: event.target.value })} /></label>
              <datalist id="load-buyer-suggestions">
                {knownCounterparties(workspace).map((item) => <option key={item} value={item} />)}
              </datalist>
              {/* A load sold this way is not a sale anywhere in Farm Rx's position yet, so the farmer
                  is told so, and offered the open contract it most likely fills. */}
              <small className="load-hint">A load sold without a contract is not counted as sold anywhere in Farm Rx. If it fills a contract, pick &ldquo;Against a contract&rdquo;.</small>
              {buyerContract && (
                <button className="text-action" type="button" onClick={() => update({ destination_kind: "contract", destination_grain_contract_id: buyerContract.contract.id, destination_buyer: "" })}>
                  Apply to the {buyerContract.contract.buyer} {buyerContract.contract.crop_year} contract ({displayBushels(buyerContract.left)} bu left)
                </button>
              )}
            </>
          )}
          {draft.destination_kind === "contract" && (
            <>
              <label>Contract<select value={draft.destination_grain_contract_id} aria-invalid={problemAbout(/contract/i)} onChange={(event) => update({ destination_grain_contract_id: event.target.value })}>
                <option value="">Pick a contract</option>
                {/* Only the contracts this load could actually go against. A contract for another crop or
                    another crop year is refused by the server, so offering it would be offering a dead end. */}
                {contractOptions.map(({ contract, left }) => (
                  <option key={contract.id} value={contract.id}>{contract.buyer} &middot; {contract.crop_year} &middot; {left > 0 ? `${displayBushels(left)} bu left of ${displayBushels(contract.bushels)}` : "delivered in full"}</option>
                ))}
              </select></label>
              {chosenContract && <small className="load-hint">{displayBushels(chosenContract.left)} bu left to deliver on this contract.</small>}
              {contractOptions.length === 0 && (
                <small className="load-hint">No {lot ? `${lot.crop_year} ${commodityLabel(lot.commodity_id)} ` : ""}contracts yet. <Link to="/grain/contracts">Add one under Contracts</Link>, or pick &ldquo;A buyer or elevator&rdquo;.</small>
              )}
            </>
          )}
          {draft.destination_kind === "bin" && (
            <>
              <label>Bin<select value={draft.destination_grain_bin_id} aria-invalid={problemAbout(/bin this load went into|same bin/)} onChange={(event) => update({ destination_grain_bin_id: event.target.value })}>
                <option value="">Pick a bin</option>
                {destinationBins.map((bin) => <option key={bin.id} value={bin.id}>{bin.name}</option>)}
              </select></label>
              {destinationBins.length === 0 && <small className="load-hint">No {workspace.grain_bins.length ? "other " : ""}bins yet. <Link to="/grain/storage">Add one under Bins &amp; basis</Link>.</small>}
            </>
          )}
        </fieldset>

        {/* Text boxes, not number boxes: a number box turns "1,000" typed off a ticket into nothing.
            Commas and spaces are dropped as they are typed, so the draft only ever holds a number. */}
        <label>Gross weight (lb)<input type="text" inputMode="decimal" autoComplete="off" aria-invalid={problemAbout(/gross|loaded truck/i)} value={draft.gross_lbs} onChange={(event) => updateWeight({ gross_lbs: numberTyped(event.target.value) })} /></label>
        <label>Tare weight (lb)<input type="text" inputMode="decimal" autoComplete="off" aria-invalid={problemAbout(/tare|loaded truck/i)} value={draft.tare_lbs} onChange={(event) => updateWeight({ tare_lbs: numberTyped(event.target.value) })} /></label>
        <div className="load-field">
          <label>Net bushels<input type="text" inputMode="decimal" autoComplete="off" aria-invalid={problemAbout(/net bushels/i)} value={draft.net_bushels} onChange={(event) => update({ net_bushels: numberTyped(event.target.value) })} /></label>
          {workedNet !== null && draft.net_bushels === workedNet
            ? <small className="load-hint">Worked out from the scale weights at {lbsPerBushel} lb/bu. Change it to match your ticket if it differs.</small>
            : !lot && <small className="load-hint">Pick where the load came from first, and Farm Rx works out net bushels from the weights you type.</small>}
        </div>
        <label>Moisture %<input type="number" min="0" max="40" step="0.1" inputMode="decimal" aria-invalid={problemAbout(/moisture/i)} value={draft.moisture_pct} onChange={(event) => update({ moisture_pct: event.target.value })} /></label>
        <div className="load-field">
          <label>Ticket number<input type="text" value={draft.ticket_number} onChange={(event) => update({ ticket_number: event.target.value })} /></label>
          {duplicateTicket && <small className="load-hint">Ticket {draft.ticket_number.trim()} was already saved on {formatFarmDate(duplicateTicket.load_date)}.</small>}
        </div>
        {/* An Equipment truck or a typed name, never both -- the database refuses a ticket carrying
            two answers, so choosing one here clears the other rather than letting the save fail. */}
        <label>Truck<select value={draft.truck_equipment_id} onChange={(event) => update({ truck_equipment_id: event.target.value, truck_name: event.target.value ? "" : draft.truck_name })}>
          <option value="">Other truck (type its name)</option>
          {trucks.map((truck) => <option key={truck.id} value={truck.id}>{truck.name}</option>)}
        </select></label>
        {!draft.truck_equipment_id && (
          <label>Truck name<input type="text" value={draft.truck_name} onChange={(event) => update({ truck_name: event.target.value })} /></label>
        )}
        <label>Note<input type="text" value={draft.notes} onChange={(event) => update({ notes: event.target.value })} /></label>

        {/* LD-2: every effect a save can have, shown as a box the farmer ticks. Only the effects this
            load's shape can actually reach are offered, and the sentence underneath says in plain
            words what the ticked boxes will do. Nothing happens that is not on this list. */}
        <fieldset className="load-effects">
          <legend>What saving this will do</legend>
          {!effectsReady ? (
            <p className="panel-note">Saving records the ticket. Moving bushels, paying down a contract and counting toward a harvest arrive with the next database update &mdash; keep recording those the way you do now. Reload the app after the update.</p>
          ) : availableEffects.length === 0 ? (
            <p className="panel-note">This ticket is a record only. Nothing else in Farm Rx changes when you save it.</p>
          ) : (
            <>
              {availableEffects.includes("bin_out") && (
                <label><input type="checkbox" checked={draft.effect_bin_out} onChange={(event) => update({ effect_bin_out: event.target.checked })} /> Take {bushelLabel} out of {binName(draft.origin_grain_bin_id)}</label>
              )}
              {availableEffects.includes("bin_in") && (
                <label><input type="checkbox" checked={draft.effect_bin_in} onChange={(event) => update({ effect_bin_in: event.target.checked })} /> Put {bushelLabel} into {binName(draft.destination_grain_bin_id)}</label>
              )}
              {availableEffects.includes("contract_delivery") && (
                <label><input type="checkbox" checked={draft.effect_contract_delivery} onChange={(event) => update({ effect_contract_delivery: event.target.checked })} /> Record {bushelLabel} delivered against {contractLabel(draft.destination_grain_contract_id)}</label>
              )}
              {availableEffects.includes("harvest") && (
                <label><input type="checkbox" checked={draft.effect_harvest} onChange={(event) => update({ effect_harvest: event.target.checked })} /> Count {bushelLabel} toward {fieldName(draft.origin_crop_assignment_id)}&rsquo;s harvest</label>
              )}
              <p className="load-effect-summary" role="status">
                {confirmedEffects.length === 0
                  ? "Saving this records the ticket and changes nothing else."
                  : `Saving this records the ticket and ${effectSentence}.`}
              </p>
              {/* A load's harvest contribution is never written into the manual harvest total. Harvest
                  and Fields show it beside that total so the farmer can compare the two and choose. */}
              {availableEffects.includes("harvest") && draft.effect_harvest && <small>This adds to the &ldquo;from loads&rdquo; figure on Harvest. It does not change a harvest total you typed.</small>}
            </>
          )}
        </fieldset>
        </fieldset>

        {showProblems && problems.length > 0 && (
          <ul className="form-error load-problems" role="alert">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}
        <button className="primary-action" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : ticketOutstanding ? "Retry load" : "Save load"}</button>
        {ticketOutstanding && !saving && (
          <button className="text-action" type="button" onClick={() => void startDifferentTicket()}>Start a different ticket</button>
        )}
        {message && <p className="load-message" role="status">{message}</p>}
      </div>

      <h3>Recent loads</h3>
      {voidMessage && <p className="load-message" role="status">{voidMessage}</p>}
      {workspace.grain_loads.length === 0 ? (
        <p>No loads recorded yet. Fill in the ticket above and tap Save load.</p>
      ) : (
        <>
          {loadTotals.length > 0 && (
            <p className="load-totals">
              {/* The recent list is capped, so this is said to be the listed loads, not the season. */}
              In the loads listed below:{" "}
              {loadTotals.map((total) => `${commodityLabel(total.commodityId)} ${total.cropYear}: ${total.count} load${total.count === 1 ? "" : "s"}, ${displayBushels(total.bushels)} bu`).join(" · ")} (not counting voided tickets)
            </p>
          )}
          <table className="load-table phone-stack">
            <thead><tr><th>Date</th><th>Crop</th><th>From</th><th>To</th><th>Net bu</th><th>Ticket</th><th /></tr></thead>
            <tbody>
              {workspace.grain_loads.map((load) => (
                <tr key={load.id} className={load.voided_at ? "load-voided" : undefined}>
                  <td data-label="Date">{formatFarmDate(load.load_date)}</td>
                  <td data-label="Crop">{commodityLabel(load.commodity_id)} {load.crop_year}</td>
                  <td data-label="From">{load.origin_kind === "bin" ? binName(load.origin_grain_bin_id) : fieldName(load.origin_crop_assignment_id)}</td>
                  <td data-label="To">{load.destination_kind === "buyer" ? load.destination_buyer : load.destination_kind === "bin" ? binName(load.destination_grain_bin_id) : workspace.grain_contracts.find((contract) => contract.id === load.destination_grain_contract_id)?.buyer ?? "a contract"}</td>
                  <td data-label="Net bu">{displayBushels(load.net_bushels)}</td>
                  <td data-label="Ticket">{load.ticket_number ?? ""}</td>
                  <td className="phone-full">{load.voided_at
                    ? <>
                      <span className="load-void-reason">Voided &mdash; {load.void_reason}</span>
                      {/* "Void it and enter it again" without retyping every field: the copy is a new
                          ticket with a new id, filled in for the farmer to fix and save. */}
                      <button className="text-action" type="button" disabled={saving || ticketOutstanding} onClick={() => void copyToNewTicket(load)}>Copy to a new ticket</button>
                    </>
                    : <button className="text-action" type="button" disabled={saving} onClick={() => void voidLoad(load)}>Void</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
