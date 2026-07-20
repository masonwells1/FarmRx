import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { NeedsAttentionList } from "./components/NeedsAttentionList";
import { MarketQuoteSection } from "./components/MarketQuote";
import { SectionTabs } from "./SectionTabs";
import { farmerError } from "./lib/farmerErrors";
import { createSubmitLock, createSubmitLockMap } from "./lib/submitLock";
import type {
  BinTransaction,
  BinInventory,
  FirmOffer,
  FirmOfferStatus,
  FirmOfferType,
  GrainAlertSettings,
  GrainBin,
  GrainContract,
  GrainContractType,
  GrainServices,
  GrainWorkspace,
  MarketingAlertRule,
  MarketingAlertRuleType,
  MarketingPlanTarget,
  PositionScope,
  ProductionEstimate,
} from "./data/grain";
import { marketedPercent, sameScope, scopeKey, scopeOf } from "./data/grain";
import {
  captureGrainAlertOperationContext,
  evaluateGrainAlerts,
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
import { farmLocalCalendarDate } from "./data/farmDates";
import {
  deriveBinPosition,
  activeBinCommodityIds,
  deriveCommodityBinTotal,
  isBinTransactionSuperseded,
  moistureStatus,
  validateBinTransaction,
  validateGrainBin,
} from "./data/binLedger";
import { isMarsBid, latestBasis } from "./data/basisMath";
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

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const bushels = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const preciseBushels = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const displayBushels = (value: number) => Number.isInteger(value) ? bushels.format(value) : preciseBushels.format(value);
export const HARVEST_RECONCILIATION_SCOPE_SUPPRESSION_COPY = "Harvest-minus-bins is not shown because bins cover the whole farm and all years.";

/** Pure view data so every ledger label uses the same baseline supersession rule as bin math. */
export function buildBinLedgerRow(inventory: BinInventory | undefined, item: BinTransaction) {
  return { label: `${item.direction === "in" ? "In" : "Out"} · ${displayBushels(item.bushels)} bu`, superseded: isBinTransactionSuperseded(inventory, item) };
}

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
const GRAIN_TABS = [
  { slug: "", label: "Overview" },
  { slug: "plan", label: "Marketing plan" },
  { slug: "alerts", label: "Alerts" },
  { slug: "offers", label: "Firm offers" },
  { slug: "carry", label: "Cost of carry" },
  { slug: "contracts", label: "Contracts" },
  { slug: "storage", label: "Bins & basis" },
];
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
    description: "60% planned; 40% deliberately unplanned.",
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
    description: "65% planned; 35% deliberately unplanned.",
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
    description: "70% planned; 30% deliberately unplanned.",
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
    description: "55% planned; 45% deliberately unplanned.",
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
    description: "60% planned; 40% deliberately unplanned.",
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

export function GrainPage({ services }: { services: GrainServices }) {
  const [workspace, setWorkspace] = useState<GrainWorkspace | null>(null);
  const [attentionQueueKey, setAttentionQueueKey] = useState<string | null>(null);
  const [selectedEstimateId, setSelectedEstimateId] = useState("");
  const [editingTarget, setEditingTarget] = useState<{
    month: number;
    target?: MarketingPlanTarget;
  } | null>(null);
  const [savedAt, setSavedAt] = useState("");
  const [planError, setPlanError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [alerts, setAlerts] = useState<GrainAlert[]>([]);
  const [deliveryNotice, setDeliveryNotice] = useState("");
  // No existing per-scope settings field is suitable, so this farmer decision is
  // intentionally limited to the open session instead of being hidden in another record.
  const [saleLimits, setSaleLimits] = useState<Record<string, number | null>>({});
  const refreshWriteLock = useRef(createSubmitLock());
  const planLock = useRef(createSubmitLock());
  const rawTab = useLocation().pathname.split("/")[2] ?? "";
  const tabPath = [
    "plan",
    "alerts",
    "offers",
    "carry",
    "contracts",
    "storage",
  ].includes(rawTab)
    ? rawTab
    : "";
  const refresh = async () => {
    try {
      const alertOperationContext = await captureGrainAlertOperationContext();
      const [data, queueKey] = await Promise.all([services.grainRepository.getData(), services.grainRepository.getNeedsAttentionQueueKey?.().catch(() => null) ?? Promise.resolve(null)]);
      await verifyGrainAlertOperationContext(alertOperationContext);
      if (data.fields.farm.id !== alertOperationContext.farmId) throw new Error("The selected farm changed while grain alerts were loading.");
      setAttentionQueueKey(queueKey);
      const ruleEvaluation = evaluateMarketingAlertRules(data);
      const nextAlerts = evaluateGrainAlerts(data);
      setWorkspace(data);
      setAlerts(nextAlerts);
      void recordMarketingAlertTransitions(data.fields.farm.id, ruleEvaluation.conditions, alertOperationContext).then((transitioned) => {
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
      }).then(
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
      setSelectedEstimateId((current) =>
        data.production_estimates.some((estimate) => estimate.id === current)
          ? current
          : (data.production_estimates[0]?.id ?? ""),
      );
    } catch (caught) {
      const message =
        caught instanceof Error &&
        caught.message === "GRAIN_PRIVATE_ACCESS_DENIED"
          ? "Grain records are private on this farm. Ask the farm owner or manager if you need access."
          : farmerError(caught, "load your grain records");
      setLoadError(message);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const whisper = () =>
    setSavedAt(
      `Saved ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date())}`,
    );
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
    ) ?? workspace.production_estimates[0];
  if (!selectedEstimate)
    return (
      <FirstEstimate
        workspace={workspace}
        services={services}
        onSaved={refresh}
      />
    );
  const selectedScope = scopeOf(selectedEstimate);
  const selectedCommodityName =
    workspace.fields.commodities.find(
      (commodity) => commodity.id === selectedScope.commodity_id,
    )?.name ?? selectedScope.commodity_id;
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
      whisper();
      await refresh();
    } catch (error) {
      setPlanError(
        error instanceof Error ? error.message : "Unable to save this target.",
      );
    } finally {
      planLock.current.release();
    }
  };
  const applyTemplate = async (template: Template) => {
    if (!planLock.current.acquire()) return;
    const timestamp = new Date().toISOString();
    const targets = templates[template].schedule.map(([month, pct]) => ({
      id: services.createGrainId(),
      ...selectedScope,
      target_month: `${selectedScope.crop_year}-${String(month).padStart(2, "0")}-01`,
      target_pct_of_production: pct,
      target_price: null,
      breakeven_relative_pct: null,
      deadline: `${selectedScope.crop_year}-${String(month).padStart(2, "0")}-28`,
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
      whisper();
      await refresh();
    } catch (error) {
      setPlanError(
        error instanceof Error ? error.message : "Unable to apply this plan.",
      );
    } finally {
      planLock.current.release();
    }
  };
  return (
    <section className="page grain-page">
      <div className="page-heading grain-heading">
        <div>
          <h1>Grain</h1>
          <p>
            Your position, your targets, and nothing more.{" "}
            <span className="delayed-label">Market quotes are delayed.</span>
          </p>
        </div>
      </div>
      <NeedsAttentionList module="grain" queueKey={attentionQueueKey} onChanged={refresh} />
      <SectionTabs base="/grain" tabs={GRAIN_TABS} />
      {tabPath === "" && (
        <>
          {alerts.length > 0 && (
            <section className="grain-section" aria-label="Grain alerts">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Check-on-open alerts</span>
                  <h2>Items to review</h2>
                  <p>
                    These are checked only when the farm owner opens Grain; they
                    are not 24/7 monitoring.
                  </p>
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
          <MarketQuoteSection />
          <section aria-label="Commodity positions" className="position-grid">
            {workspace.production_estimates.map((estimate) => (
              <PositionCard
                key={estimate.id}
                estimate={estimate}
                workspace={workspace}
                services={services}
                saleLimit={saleLimitForScope(saleLimits, estimate)}
                onSaleLimitChange={(limit) =>
                  setSaleLimits((current) => ({ ...current, [scopeKey(scopeOf(estimate))]: limit }))
                }
                onSaved={async () => {
                  whisper();
                  await refresh();
                }}
              />
            ))}
          </section>
        </>
      )}
      {tabPath === "plan" && (
        <>
          <section className="grain-section plan-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Primary plan</span>
                <h2>Monthly marketing plan</h2>
                <p>
                  Set coverage by month. A plan can intentionally leave bushels
                  unplanned.
                </p>
              </div>
              <label className="commodity-picker">
                <span>Commodity</span>
                <select
                  value={selectedEstimate.id}
                  onChange={(event) =>
                    setSelectedEstimateId(event.target.value)
                  }
                >
                  {workspace.production_estimates.map((estimate) => (
                    <option key={estimate.id} value={estimate.id}>
                      {
                        workspace.fields.commodities.find(
                          (commodity) => commodity.id === estimate.commodity_id,
                        )?.name
                      }
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
                    onClick={() => setEditingTarget({ month: number, target })}
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
            {planError && (
              <p className="form-error grain-inline-error" role="alert">
                {planError}
              </p>
            )}
            <PlanStatus estimate={selectedEstimate} workspace={workspace} />
          </section>
          <ActualVsPlan estimate={selectedEstimate} workspace={workspace} />
        </>
      )}
      {tabPath === "carry" && (
        <GrainCostOfCarry
          workspace={workspace}
          selectedEstimate={selectedEstimate}
          selectedEstimateId={selectedEstimateId}
          onSelectEstimate={setSelectedEstimateId}
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
              <span className="eyebrow">15-second entry</span>
              <h2>Contracts</h2>
              <p>Record a sale; the position updates from it.</p>
            </div>
            {savedAt && (
              <span className="saved-whisper" role="status">
                {savedAt}
              </span>
            )}
          </div>
          <ContractEntry
            workspace={workspace}
            scope={selectedScope}
            services={services}
            saleLimit={saleLimits[scopeKey(selectedScope)] ?? null}
            onSaved={async () => {
              whisper();
              await refresh();
            }}
          />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Commodity</th>
                  <th>Type</th>
                  <th className="align-right">Bushels</th>
                  <th className="align-right">Price</th>
                  <th>Delivery</th>
                  <th className="align-right">Delivered / remaining</th>
                </tr>
              </thead>
              <tbody>
                {scopeRows(workspace.grain_contracts, selectedScope).map(
                  (contract) => {
                    const delivered = workspace.grain_contract_deliveries.filter((item) => item.grain_contract_id === contract.id).reduce((sum, item) => sum + item.bushels, 0);
                    const remaining = contract.bushels - delivered;
                    return (
                    <tr key={contract.id}>
                      <td>
                        <strong>{contract.buyer}</strong>
                        <small>
                          {contract.contract_number ?? "No contract #"}
                        </small>
                      </td>
                      <td>
                        {
                          workspace.fields.commodities.find(
                            (commodity) =>
                              commodity.id === contract.commodity_id,
                          )?.name
                        }
                      </td>
                      <td>{contractLabels[contract.contract_type]}</td>
                      <td className="align-right numeric">
                        {bushels.format(contract.bushels)}
                      </td>
                      <td className="align-right numeric">
                        {finalCashPrice(contract) === null
                          ? contract.contract_type === "hta"
                            ? "Basis open"
                            : "Futures open"
                          : money.format(finalCashPrice(contract)!)}
                      </td>
                      <td>
                        {contract.delivery_start?.slice(5).replace("-", "/") ??
                          "—"}
                      </td>
                      <td className="align-right numeric">{workspace.capabilities?.contract_deliveries ? <><strong>{preciseBushels.format(delivered)} / {preciseBushels.format(Math.max(0, remaining))} bu</strong>{remaining < 0 && <small className="negative-text">Over-delivered by {preciseBushels.format(-remaining)} bu</small>}</> : <strong>Tracking arrives with the next database update</strong>}<ContractActions contract={contract} workspace={workspace} services={services} onSaved={async () => { whisper(); await refresh(); }} /></td>
                    </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tabPath === "storage" && (
        <section className="grain-section storage-layout">
          <Bins
            workspace={workspace}
            services={services}
            onSaved={async () => {
              whisper();
              await refresh();
            }}
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
      )}
      {tabPath === "" && <UsdaCalendar reports={workspace.usda_report_dates} />}
      <aside className="compliance-note">
        <strong>For your records.</strong> Farm Rx shows your numbers and your
        targets. It does not give marketing advice.{" "}
        <span>
          Owner-only alerts are best-effort check-on-open notices, not 24/7
          monitoring.
        </span>
      </aside>
      {editingTarget && (
        <TargetEditor
          month={editingTarget.month}
          commodity={selectedCommodityName}
          target={editingTarget.target}
          scope={selectedScope}
          services={services}
          workspace={workspace}
          onClose={() => {
            setEditingTarget(null);
            setPlanError("");
          }}
          onSave={saveTarget}
        />
      )}
    </section>
  );
}

function MarketingAlerts({
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
    try {
      await services.grainRepository.saveMarketingAlertRule(rule);
      setError("");
      setDraftType(null);
      setEditing(null);
      await onSaved();
    } catch (caught) {
      const message = farmerError(caught, "save this alert");
      setError(message);
      throw new Error(message);
    } finally {
      alertLock.release();
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Delete this alert rule?")) return;
    const alertLock = alertLocks.current.get(id);
    if (!alertLock.acquire()) return;
    try {
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
            <span className="eyebrow">Check-on-open alerts</span>
            <h2>Marketing alerts</h2>
            <p>
              Farm Rx checks these when you open Grain. They are not 24/7
              monitoring.
            </p>
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
            <span>Remind me if I fall behind my marketing plan</span>
          </button>
          <button
            className="alert-template"
            type="button"
            onClick={() => start("deadline")}
          >
            <strong>Deadline</strong>
            <span>Remind me before a date</span>
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
                      Last fired{" "}
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

function FirmOffers({
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
  const [adding, setAdding] = useState(false);
  const [filling, setFilling] = useState<FirmOffer | null>(null);
  const [fillSaving, setFillSaving] = useState(false);
  const [error, setError] = useState("");
  const offerLocks = useRef(createSubmitLockMap());
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
  const save = async (offer: FirmOffer) => {
    const offerLock = offerLocks.current.get(offer.id);
    if (!offerLock.acquire()) return;
    try {
      await services.grainRepository.saveFirmOffer(offer);
      setEditing(null);
      setAdding(false);
      setError("");
      await onSaved();
    } catch (caught) {
      const message = farmerError(caught, "save this firm offer");
      setError(message);
      throw new Error(message);
    } finally {
      offerLock.release();
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Delete this firm offer?")) return;
    const offerLock = offerLocks.current.get(id);
    if (!offerLock.acquire()) return;
    try {
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
    try {
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
  const finishFill = async (contract: GrainContract, offer: FirmOffer) => {
    const offerLock = offerLocks.current.get(offer.id);
    if (fillSaving || !offerLock.acquire()) return;
    setFillSaving(true);
    try {
      try {
        await services.grainRepository.fillFirmOffer(offer, contract);
        setFilling(null);
        setError("");
        await onSaved();
        return;
      } catch (caught) {
        if (!(caught instanceof Error) || caught.message !== "FIRM_OFFER_FILL_RPC_UNAVAILABLE") {
          setError(farmerError(caught, "record this firm-offer sale"));
          return;
        }
      }
      try {
        await fillFirmOfferFallback(
          services.grainRepository,
          offer,
          { ...contract, id: await firmOfferContractId(offer) },
        );
        setFilling(null);
        setError("");
        await onSaved();
      } catch (caught) {
        setError(farmerError(caught, "mark this offer filled"));
      }
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
      {!adding && !editing && !filling && (
        <button
          className="primary-action"
          type="button"
          onClick={() => setAdding(true)}
        >
          Add firm offer
        </button>
      )}
      {(adding || editing) && (
        <FirmOfferForm
          key={editing?.id ?? "new"}
          offer={editing}
          scope={editing ? scopeOf(editing) : scope}
          services={services}
          workspace={workspace}
          saleLimit={saleLimitForScope(saleLimits, editing ?? scope)}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
            setError("");
          }}
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
          />
        </div>
      )}
      <OfferList
        offers={offers}
        workspace={workspace}
        saleLimits={saleLimits}
        onEdit={(offer) => {
          setEditing(offer);
          setAdding(false);
          setFilling(null);
        }}
        onCancel={cancel}
        onDelete={remove}
        onFill={(offer) => {
          setFilling(offer);
          setAdding(false);
          setEditing(null);
          setError("");
        }}
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
            onEdit={(offer) => {
              setEditing(offer);
              setAdding(false);
            }}
            onCancel={cancel}
            onDelete={remove}
            onFill={(offer) => setFilling(offer)}
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
}: {
  offers: FirmOffer[];
  workspace: GrainWorkspace;
  saleLimits: Record<string, number | null>;
  onEdit: (offer: FirmOffer) => void;
  onCancel: (offer: FirmOffer) => void;
  onDelete: (id: string) => void;
  onFill: (offer: FirmOffer) => void;
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
                  ? `${money.format(offer.basis ?? 0)}/bu basis`
                  : `${money.format(offer.price ?? 0)}/bu`;
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
                          Cancel
                        </button>
                      </>
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
  scope,
  services,
  workspace,
  saleLimit,
  onCancel,
  onSave,
}: {
  offer: FirmOffer | null;
  scope: PositionScope;
  services: GrainServices;
  workspace: GrainWorkspace;
  saleLimit: number | null;
  onCancel: () => void;
  onSave: (offer: FirmOffer) => Promise<void>;
}) {
  const [buyer, setBuyer] = useState(offer?.buyer ?? "");
  const [type, setType] = useState<FirmOfferType>(offer?.offer_type ?? "cash");
  const [amount, setAmount] = useState(offer?.bushels.toString() ?? "");
  const [price, setPrice] = useState(offer?.price?.toString() ?? "");
  const [basis, setBasis] = useState(offer?.basis?.toString() ?? "");
  const [month, setMonth] = useState(offer?.contract_month ?? "");
  const [expires, setExpires] = useState(offer?.expires_on ?? "");
  const [location, setLocation] = useState(offer?.delivery_location ?? "");
  const [notes, setNotes] = useState(offer?.notes ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(createSubmitLock());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!submitLock.current.acquire()) return;
    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const next: FirmOffer = {
        id: offer?.id ?? services.createGrainId(),
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
      const errors = validateFirmOffer(next);
      if (errors.length) {
        setError(errors.join(" "));
        return;
      }
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
  const otherPending = pendingFirmOfferBushels(workspace, scope) - (offer?.status === "open" ? offer.bushels : 0);
  const saleLimitMessage = saleLimitWarning(saleLimit, contracted, otherPending, Number(amount), "save");
  return (
    <form className="firm-offer-form" onSubmit={(event) => void submit(event)}>
      <h3>{offer ? "Edit firm offer" : "New firm offer"}</h3>
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
        <input
          required
          type="number"
          min={type === "basis" ? undefined : "0"}
          step="0.01"
          inputMode="decimal"
          value={type === "basis" ? basis : price}
          onChange={(event) =>
            type === "basis"
              ? setBasis(event.target.value)
              : setPrice(event.target.value)
          }
        />
      </label>
      <label>
        Contract month <small>optional</small>
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
          Cancel
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
  useEffect(() => {
    if (type === "price_target")
      void services.profitabilityRepository
        .getBreakeven(scope, workspace.fields)
        .then(setBreakeven);
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
    const timestamp = new Date().toISOString();
    const next: MarketingAlertRule = {
      id: rule?.id ?? services.createGrainId(),
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
    try {
      await onSave(next);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save this alert.",
      );
    }
  };
  return (
    <form className="alert-rule-form" onSubmit={(event) => void submit(event)}>
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
            <input
              required
              type="number"
              min="0.01"
              max="1000"
              step="0.01"
              inputMode="decimal"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
          </label>
          <p className="alert-fact">
            Price alerts use the newest cash price entered for this commodity.
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
            Currently {currentPct.toFixed(0)}% marketed
          </p>
        </>
      )}
      {type === "deadline" && (
        <label>
          Reminder date
          <input
            required
            type="date"
            value={remindOn}
            onChange={(event) => setRemindOn(event.target.value)}
          />
        </label>
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
        <button className="primary-action" type="submit">
          Save alert
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
            Add up to three addresses. If email is unavailable, your in-app
            alert stays here.
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

function FirstEstimate({
  workspace,
  services,
  onSaved,
}: {
  workspace: GrainWorkspace;
  services: GrainServices;
  onSaved: () => Promise<void>;
}) {
  const assignments = workspace.fields.crop_assignments;
  const [aph, setAph] = useState("");
  const [error, setError] = useState("");
  const submitLock = useRef(createSubmitLock());
  if (!assignments.length)
    return (
      <section className="page">
        <div className="loading-state">
          Add a crop assignment in Fields to begin your grain position.
        </div>
      </section>
    );
  const grouped = new Map<string, (typeof assignments)[number]>();
  for (const assignment of assignments)
    if (!grouped.has(`${assignment.crop_year}|${assignment.commodity_id}`))
      grouped.set(
        `${assignment.crop_year}|${assignment.commodity_id}`,
        assignment,
      );
  const create = async (assignment: (typeof assignments)[number]) => {
    if (!submitLock.current.acquire()) return;
    const now = new Date().toISOString();
    try {
      await services.grainRepository.saveProductionEstimate({
        id: services.createGrainId(),
        farm_id: workspace.fields.farm.id,
        crop_year: assignment.crop_year,
        commodity_id: assignment.commodity_id,
        operating_entity_id: null,
        enterprise_label: null,
        planted_acres: null,
        aph_yield: Number(aph),
        expected_bushels: 0,
        actual_bushels: null,
        drives_math: "projected",
        notes: null,
        created_at: now,
        updated_at: now,
      });
      setError("");
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to start this production estimate.",
      );
    } finally {
      submitLock.current.release();
    }
  };
  return (
    <section className="page grain-page">
      <div className="page-heading grain-heading">
        <div>
          <h1>Start your grain estimate</h1>
          <p>
            Your live crop assignments are ready. Add an expected yield to
            create the first estimate.
          </p>
        </div>
      </div>
      <label>
        APH / expected yield
        <input
          required
          type="number"
          min="0.01"
          step="any"
          value={aph}
          onChange={(event) => setAph(event.target.value)}
        />
      </label>
      <div className="position-grid">
        {[...grouped.values()].map((assignment) => (
          <article
            className="position-card"
            key={`${assignment.crop_year}|${assignment.commodity_id}`}
          >
            <h2>
              {workspace.fields.commodities.find(
                (item) => item.id === assignment.commodity_id,
              )?.name ?? assignment.commodity_id}
            </h2>
            <p>{assignment.crop_year} crop assignment</p>
            <button
              className="primary-action"
              type="button"
              disabled={!Number.isFinite(Number(aph)) || Number(aph) <= 0}
              onClick={() => void create(assignment)}
            >
              Create estimate
            </button>
          </article>
        ))}
      </div>
      {error && (
        <p className="form-error grain-inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function PositionCard({
  estimate,
  workspace,
  services,
  saleLimit,
  onSaleLimitChange,
  onSaved,
}: {
  estimate: ProductionEstimate;
  workspace: GrainWorkspace;
  services: GrainServices;
  saleLimit: number | null;
  onSaleLimitChange: (limit: number | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [aph, setAph] = useState(String(estimate.aph_yield));
  const [actual, setActual] = useState(
    estimate.actual_bushels?.toString() ?? "",
  );
  const [error, setError] = useState("");
  const submitLock = useRef(createSubmitLock());
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
  const harvestActual = workspace.fields.crop_assignments.filter((assignment) => assignment.crop_year === scope.crop_year && assignment.commodity_id === scope.commodity_id && (scope.operating_entity_id === null || workspace.fields.fields.some((field) => field.id === assignment.field_id && field.operating_entity_id === scope.operating_entity_id))).reduce((sum, assignment) => sum + (assignment.harvested_bushels ?? 0), 0);
  const binBalance = deriveCommodityBinTotal(workspace.grain_bins, workspace.bin_inventory, workspace.bin_transactions, scope.commodity_id);
  useEffect(() => {
    let active = true;
    setRpMarketingEstimate(null);
    setSavedCoverageBlocked(hasUnsupportedSavedCoverage(insurance, []));
    void services.profitabilityRepository
      .getWorkspace()
      .then((profitability) => {
        const matchingBudgets = profitability.budgets.filter((item) =>
          sameScope(item, scope),
        );
        if (hasUnsupportedSavedCoverage(insurance, matchingBudgets.map((budget) => budget.rp_coverage_pct))) {
          if (active) setSavedCoverageBlocked(true);
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
        if (!active || !hasAllocation) return;
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
  const insuranceEstimate = savedCoverageBlocked ? null : rpBushels ?? insuranceUnitEstimate;
  const remainingEstimate = insuranceEstimate === null ? null : remainingMarketingCapacity(insuranceEstimate, contractedBushels, pendingOffers);
  const remainingSaleLimit = saleLimit === null ? null : Math.max(0, saleLimit - contractedBushels - pendingOffers);
  const estimateNote = savedCoverageBlocked
    ? unsupportedCoverageMessage
    : rpAmbiguous
    ? "RP estimate not shown: a field is allocated to more than one budget; using insurance units."
    : rpMarketingEstimate !== null && !rpAmbiguous
      ? `From entered coverage: ${bushels.format(rpMarketingEstimate.guaranteedBushels)} bu.`
      : minRevenue === null
        ? "No insurance unit."
        : `${money.format(minRevenue)}/ac minimum revenue.`;
  const saveProduction = async (input: ProductionEstimate) => {
    if (!submitLock.current.acquire()) return;
    try {
      await services.grainRepository.saveProductionEstimate(input);
      setError("");
      await onSaved();
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "Unable to save production.",
      );
    } finally {
      submitLock.current.release();
    }
  };
  return (
    <article className="position-card">
      <div className="position-top">
        <div>
          <span className="eyebrow">
            {commodity.crop_family === "corn" ? "Corn" : commodity.crop_family}
          </span>
          <h2>{commodity.name}</h2>
        </div>
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
            disabled={estimate.actual_bushels === null}
            onClick={() => void saveProduction(buildProductionSaveInput(estimate, aph, actual, "actual"))}
          >
            Actual
          </button>
        </div>
      </div>
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
      <section className="grain-reconciliation"><h3>Harvest reconciliation</h3><p>Harvest actuals: <strong>{bushels.format(harvestActual)} bu</strong> · Grain actual production: <strong>{estimate.actual_bushels === null ? "not entered" : `${bushels.format(estimate.actual_bushels)} bu`}</strong> · <strong>All bins holding {commodity.name} (whole farm, all years): {bushels.format(binBalance)} bu</strong>.</p><p>{estimate.actual_bushels === null ? "Grain actual has not been entered. Bins are never changed by this action." : `Harvest minus Grain actual: ${bushels.format(harvestActual - estimate.actual_bushels)} bu. ${HARVEST_RECONCILIATION_SCOPE_SUPPRESSION_COPY}`}</p><button className="secondary-action" type="button" disabled={harvestActual <= 0} onClick={() => { if (window.confirm("Use the harvest total as Grain actual? This changes Grain actual only; it does not change bins.")) { setActual(String(harvestActual)); void saveProduction(buildHarvestReconciliationInput(estimate, harvestActual)); } }}>Use harvest total as Grain actual</button></section>
      <div className="position-stats">
        <Metric
          label="Fully priced"
          value={`${bushels.format(finalBushels)} bu`}
          note={`${Math.round(pricedPct)}%`}
        />
        <Metric
          label="Open legs"
          value={`${bushels.format(partiallyPricedBushels)} bu`}
          note="manual valuation"
        />
        <Metric
          label="Planned revenue"
          value={plannedRevenue === null ? "—" : money.format(plannedRevenue)}
          note={
            plannedRevenue === null
              ? "add a cash price target"
              : "cash-target plan estimate"
          }
        />
        <Metric
          label="Insurance-backed marketing estimate"
          value={insuranceEstimate === null ? "Blocked" : `${bushels.format(insuranceEstimate)} bu`}
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
          />
          <small>Used only in this open session; it is your limit, not an insurance guarantee.</small>
        </label>
        <Metric label="Insurance estimate guarantee" value={insuranceEstimate === null ? "Blocked" : `${bushels.format(insuranceEstimate)} bu`} note={estimateNote} />
        <Metric label="Already contracted" value={`${bushels.format(contractedBushels)} bu`} note="Signed contracts" />
        <Metric label="Pending offers" value={`${bushels.format(pendingOffers)} bu`} note="Open firm offers; not sold yet" />
        <Metric label="Insurance estimate remaining" value={remainingEstimate === null ? "Blocked" : `${bushels.format(remainingEstimate)} bu`} note={savedCoverageBlocked ? unsupportedCoverageMessage : "Guarantee − contracted − pending; never below zero"} />
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
          APH / expected yield
          <input
            type="number"
            min="0.01"
            step="any"
            value={aph}
            onChange={(event) => setAph(event.target.value)}
          />
        </label>
        <label>
          Actual bushels
          <input
            type="number"
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
      </div>
      {error && (
        <p className="form-error grain-inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="position-foot">
        <span>
          {estimate.drives_math === "actual" ? "Actual" : "Projected"}{" "}
          production: <strong>{bushels.format(production)} bu</strong>
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
  const month = new Date().getMonth() + 1;
  const targets = scopeRows(workspace.marketing_plan_targets, scope);
  const targetPct = targets
    .filter((target) => Number(target.target_month.slice(5, 7)) <= month)
    .reduce((total, target) => total + target.target_pct_of_production, 0);
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
  const inBins = deriveCommodityBinTotal(
    workspace.grain_bins,
    workspace.bin_inventory,
    workspace.bin_transactions,
    scope.commodity_id,
    scope.crop_year,
  );
  const wholeFarmBins =
    scope.operating_entity_id !== null || scope.enterprise_label !== null;
  return (
    <div className="plan-status">
      <div>
        <span>Plan progress through {months[month - 1]}</span>
        <strong>
          {Math.round(actualPct)}% contracted / {Math.round(targetPct)}% planned
          · {Math.max(0, 100 - totalPlanned).toFixed(0)}% unplanned remainder
        </strong>
        <small className="numeric">
          {bushels.format(inBins)} bu in bins
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
          <p>Signed contracts are shown against your cumulative plan.</p>
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
              <th className="align-right">Actual sales</th>
            </tr>
          </thead>
          <tbody>
            {targets.length ? (
              targets.map((target) => {
                cumulative += target.target_pct_of_production;
                return (
                  <tr key={target.id}>
                    <td>
                      {months[Number(target.target_month.slice(5, 7)) - 1]}
                    </td>
                    <td className="align-right numeric">
                      {target.target_pct_of_production}%
                    </td>
                    <td className="align-right numeric">
                      {bushels.format(
                        (production * target.target_pct_of_production) / 100,
                      )}
                    </td>
                    <td className="align-right numeric">{cumulative}%</td>
                    <td className="align-right numeric">
                      {bushels.format(sold)} bu
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5}>
                  No plan yet. Choose a template or tap a month to start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ContractEntry({
  workspace,
  scope,
  services,
  onSaved,
  initialOffer,
  onFilled,
  isSaving = false,
  saleLimit,
}: {
  workspace: GrainWorkspace;
  scope: PositionScope;
  services: GrainServices;
  onSaved: () => Promise<void>;
  initialOffer?: FirmOffer;
  onFilled?: (contract: GrainContract) => Promise<void>;
  isSaving?: boolean;
  saleLimit: number | null;
}) {
  const buyers = [
    ...new Set([
      ...workspace.cash_bids
        .filter((bid) => !isMarsBid(bid))
        .map((bid) => bid.elevator),
      ...(initialOffer ? [initialOffer.buyer] : []),
    ]),
  ];
  const preset = initialOffer
    ? offerToContract(
        initialOffer,
        "00000000-0000-4000-8000-000000000000",
        new Date().toISOString(),
      )
    : null;
  const [buyer, setBuyer] = useState(initialOffer?.buyer ?? buyers[0] ?? "");
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
  const [start, setStart] = useState(
    preset?.delivery_start ?? (initialOffer ? "" : `${scope.crop_year}-09-01`),
  );
  const [end, setEnd] = useState(
    preset?.delivery_end ?? (initialOffer ? "" : `${scope.crop_year}-11-30`),
  );
  const [number, setNumber] = useState("");
  const [premium, setPremium] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(createSubmitLock());
  const contracted = scopeRows(workspace.grain_contracts, scope).reduce((sum, item) => sum + item.bushels, 0);
  const pending = pendingFirmOfferBushels(workspace, scope);
  const proposedBushels = Number(bushelCount);
  const pendingBeforeProposal = pending - (initialOffer ? initialOffer.bushels : 0);
  const saleLimitMessage = saleLimitWarning(saleLimit, contracted, pendingBeforeProposal, proposedBushels, "record");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving || submitting || !submitLock.current.acquire()) return;
    try {
      setSubmitting(true);
      const timestamp = new Date().toISOString();
      const contractId = services.createGrainId();
      const contract: GrainContract = {
      id: contractId,
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
      notes: initialOffer
        ? offerToContract(initialOffer, contractId, timestamp).notes
        : null,
      created_at: timestamp,
      updated_at: timestamp,
      };
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
      setError(farmerError(exception, "record this contract"));
    } finally {
      submitLock.current.release();
      setSubmitting(false);
    }
  };
  const needsPrice = type !== "basis";
  const priceLabel = type === "hta" ? "Futures $/bu" : "Cash $/bu";
  return (
    <form className="contract-entry" onSubmit={(event) => void submit(event)}>
      <label>
        <span>Buyer</span>
        <select
          value={buyer}
          onChange={(event) => setBuyer(event.target.value)}
        >
          {buyers.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Type</span>
        <select
          value={type}
          onChange={(event) => setType(event.target.value as GrainContractType)}
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
      {needsPrice ? (
        <label>
          <span>{priceLabel}</span>
          <input
            required
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
      ) : (
        <label>
          <span>Basis $/bu</span>
          <input
            required
            type="number"
            step="0.01"
            inputMode="decimal"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
        </label>
      )}
      <details open={!!initialOffer}>
        <summary>Delivery, contract #, premium</summary>
        <div>
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
            IP premium ¢/bu
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
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

function ContractActions({ contract, workspace, services, onSaved }: { contract: GrainContract; workspace: GrainWorkspace; services: GrainServices; onSaved: () => Promise<void> }) {
  const [price, setPrice] = useState(""); const [delivery, setDelivery] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false); const lock = useRef(createSubmitLock()); const deliveryId = useRef<string | null>(null);
  const missingLeg = contract.contract_type === "basis" ? "futures_price" : contract.contract_type === "hta" ? "basis" : null;
  const finalize = async () => { if (!missingLeg || !lock.current.acquire()) return; setSaving(true); try { if (price.trim() === "") throw new Error(missingLeg === "basis" ? "Enter a valid basis." : "Enter a futures price above zero."); const value = Number(price); if (!Number.isFinite(value) || (missingLeg === "futures_price" && value <= 0)) throw new Error(missingLeg === "basis" ? "Enter a valid basis." : "Enter a futures price above zero."); const shown = `${missingLeg === "basis" && value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}/bu`; if (!window.confirm(`Set ${missingLeg === "basis" ? "basis" : "futures price"} to ${shown}? This cannot be changed afterward.`)) return; await services.grainRepository.finalizeContractPriceLeg(contract.id, missingLeg, value); setMessage("Price leg set. Add a contract note for any correction."); await onSaved() } catch (error) { setMessage(farmerError(error, "set this price")) } finally { lock.current.release(); setSaving(false) } };
  const record = async () => { if (!lock.current.acquire()) return; setSaving(true); try { const value = Number(delivery); if (!Number.isFinite(value) || value <= 0) throw new Error("Enter delivered bushels."); const delivered = workspace.grain_contract_deliveries.filter((item) => item.grain_contract_id === contract.id).reduce((sum, item) => sum + item.bushels, 0); const excess = delivered + value - contract.bushels; const allow_overdelivery = excess > 0 && window.confirm(`This is ${preciseBushels.format(excess)} bu more than the contract. Record anyway?`); if (excess > 0 && !allow_overdelivery) return; deliveryId.current ??= services.createGrainId(); await services.grainRepository.recordContractDelivery({ id: deliveryId.current, farm_id: workspace.fields.farm.id, grain_contract_id: contract.id, bushels: value, delivered_on: localCalendarDay(new Date()), note: null, created_at: new Date().toISOString(), allow_overdelivery }); deliveryId.current = null; setDelivery(""); setMessage("Delivery recorded."); await onSaved() } catch (error) { setMessage(farmerError(error, "record this delivery")) } finally { lock.current.release(); setSaving(false) } };
  return <div className="contract-actions">{missingLeg && contract[missingLeg] === null && <label>{missingLeg === "basis" ? "Set basis $/bu" : "Set futures price $/bu"}<input type="number" step="0.01" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} /><button className="text-action" type="button" disabled={saving || !workspace.capabilities?.contract_price_finalization} onClick={() => void finalize()}>{missingLeg === "basis" ? "Set basis" : "Set futures price"}</button>{!workspace.capabilities?.contract_price_finalization && <small>Price finalization arrives with the next database update. Reload the app after the update.</small>}</label>}<label>Delivered bushels<input type="number" min="0.01" step="0.01" inputMode="decimal" value={delivery} onChange={(event) => setDelivery(event.target.value)} /><button className="text-action" type="button" disabled={saving || !workspace.capabilities?.contract_deliveries} onClick={() => void record()}>Record delivery</button>{!workspace.capabilities?.contract_deliveries && <small>Tracking arrives with the next database update. Reload the app after the update.</small>}</label>{message && <small>{message}</small>}</div>
}

function Bins({
  workspace,
  services,
  onSaved,
}: {
  workspace: GrainWorkspace;
  services: GrainServices;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<GrainBin | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const saveBin = async (bin: GrainBin) => {
    try {
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
    try {
      await services.grainRepository.appendBinTransaction(transaction);
      setError("");
      await onSaved();
    } catch (caught) {
      const message = farmerError(caught, "add this movement");
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
          <p>A dated measurement is the baseline; only later movements change it.</p>
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
      {(adding || editing) && (
        <BinForm
          bin={editing}
          workspace={workspace}
          services={services}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSave={saveBin}
        />
      )}
      <div className="bin-list">
        {workspace.grain_bins.map((bin) => {
          const position = binPosition(workspace, bin);
          const moisture = moistureStatus(bin);
          const moistureText =
            bin.moisture_pct === null
              ? bin.moisture_checked_on === null
                ? "No moisture reading"
                : "Date recorded, moisture missing"
              : bin.moisture_checked_on === null
                ? `${bin.moisture_pct.toFixed(2)}% · date missing`
                : `${bin.moisture_pct.toFixed(2)}% · checked ${new Date(`${bin.moisture_checked_on}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
          const fill = (position.onHand / bin.capacity_bu) * 100;
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
              <div className="bin-card-meta">
                {position.lots.length ? position.lots.map((lot) => {
                  const commodity = workspace.fields.commodities.find((item) => item.id === lot.commodityId);
                  return <span key={lot.commodityId} className={`commodity-badge ${commodity?.traits.identity_preserved ? "ip" : ""}`}>{commodity?.traits.identity_preserved ? "IP · " : ""}{commodity?.name ?? lot.commodityId} · {displayBushels(lot.onHand)} bu</span>
                }) : (
                  <span className="commodity-badge">No commodity recorded</span>
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
               {position.lots.map((lot) => lot.inventory && <p className="bin-reconciliation" key={`${lot.commodityId}-baseline`}>Current baseline · {new Date(`${lot.baselineDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}: {bushels.format(lot.recordedInventory)} bu + {lot.movementsSinceBaseline.length} movements since = {bushels.format(lot.onHand)} bu.</p>)}
              <div className="bin-fill">
                <div>
                  <strong className="numeric">
                       {displayBushels(position.onHand)} bu
                  </strong>
                  <span className="numeric">
                    {" "}
                     / {displayBushels(bin.capacity_bu)} bu · {fill.toFixed(0)}%
                  </span>
                </div>
                <span
                  aria-label={`${fill.toFixed(0)} percent full`}
                  style={{ width: `${Math.min(100, Math.max(0, fill))}%` }}
                />
              </div>
              {position.exceedsRecordedInventory && (
                <p className="bin-warning" role="status">
                  This bin shows a negative grain balance — review its history.
                </p>
              )}
              {position.onHand > bin.capacity_bu && <p className="bin-warning" role="status">This bin shows more grain than it holds — review its history.</p>}
              {position.inventory && (
                <div className="bin-balance">
                         <span>
                    <strong className="numeric">
                      {displayBushels(position.inventory.committed_bushels)}
                    </strong>{" "}
                    committed
                  </span>
                  <span>
                    <strong className="numeric">
                      {displayBushels(
                        position.onHand - position.inventory.committed_bushels,
                      )}
                    </strong>{" "}
                    free
                  </span>
                </div>
              )}
              <details className="bin-ledger">
                <summary>
                  Movement ledger ({position.transactions.length})
                </summary>
                <p>
                  Movements can’t be edited. To fix a mistake, add an opposite
                  movement.
                </p>
                <MovementForm
                  bin={bin}
                  commodityId={position.commodityId ?? ""}
                  workspace={workspace}
                  services={services}
                  onSave={addMovement}
                />
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
                            · {workspace.fields.commodities.find((commodity) => commodity.id === item.commodity_id)?.name ?? item.commodity_id} · {item.source_kind ?? "Manual entry"}{ledgerRow.superseded ? " · superseded by baseline" : ""}
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
    <form className="bin-form" onSubmit={(event) => void submit(event)}>
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
      <p className="bin-form-fact">
        Commodity is stored with inventory and movements, keeping IP grain
        separated.
      </p>
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
  onSave,
}: {
  bin: GrainBin;
  commodityId: string;
  workspace: GrainWorkspace;
  services: GrainServices;
  onSave: (transaction: BinTransaction) => Promise<void>;
}) {
  const [direction, setDirection] = useState<BinTransaction["direction"]>("in");
  const [bushelsValue, setBushelsValue] = useState("");
  const [occurredOn, setOccurredOn] = useState(localCalendarDay(new Date()));
  const [note, setNote] = useState("");
  const [commodity, setCommodity] = useState(
    commodityId || workspace.fields.commodities[0]?.id || "",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(createSubmitLock());
  const movementId = useRef<string | null>(null);
  const inventory = workspace.bin_inventory.find((item) => item.grain_bin_id === bin.id);
  const baselineDate = inventory?.measured_at.slice(0, 10) ?? null;
  const minimumOccurredOn = baselineDate ? new Date(`${baselineDate}T00:00:00.000Z`).getTime() + 86_400_000 : null;
  const minimumOccurredOnDate = minimumOccurredOn === null ? undefined : new Date(minimumOccurredOn).toISOString().slice(0, 10);
  const prior = workspace.bin_transactions.filter((item) => item.grain_bin_id === bin.id);
  const activeCommodityIds = activeBinCommodityIds(inventory, prior);
  const allowedCommodities = movementCommodityOptions(workspace.fields.commodities, inventory, prior);
  useEffect(() => {
    if (activeCommodityIds.length) setCommodity(activeCommodityIds[0]);
  }, [commodityId, activeCommodityIds.join("|")]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!submitLock.current.acquire()) return;
    setSaving(true);
    try {
      if (activeCommodityIds.length && !activeCommodityIds.includes(commodity)) {
        setError("This bin still holds another commodity. Empty its active lot before storing a different crop.");
        return;
      }
      const transaction: BinTransaction = {
        id: movementId.current ?? (movementId.current = services.createGrainId()),
        farm_id: workspace.fields.farm.id,
        grain_bin_id: bin.id,
        direction,
        bushels: Number(bushelsValue),
        commodity_id: commodity,
        occurred_on: occurredOn,
        note: note.trim() || null,
        source_kind: "manual entry",
        created_at: new Date().toISOString(),
      };
      const errors = validateBinTransaction(transaction);
      if (errors.length) {
        setError(errors.join(" "));
        return;
      }
      try {
        await onSave(transaction);
        movementId.current = null;
        setBushelsValue("");
        setNote("");
        setError("");
      } catch (caught) {
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
        <input
          required
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={bushelsValue}
          onChange={(event) => setBushelsValue(event.target.value)}
        />
      </label>
      <label>
        Commodity
        <select
          value={commodity}
          onChange={(event) => setCommodity(event.target.value)}
        >
          {allowedCommodities.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input
          required
          type="date"
          min={minimumOccurredOnDate}
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
        />
      </label>
      <label className="movement-note">
        Note <small>optional</small>
        <input
          maxLength={4000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!workspace.capabilities?.bin_movements && <p className="form-error">Bin movements arrive with the next database update. Reload the app after the update.</p>}
      <button className="secondary-action" type="submit" disabled={saving || !workspace.capabilities?.bin_movements}>
        {saving ? "Saving…" : "Add movement"}
      </button>
    </form>
  );
}

function Basis({
  workspace,
  services,
  onSaved,
}: {
  workspace: GrainWorkspace;
  services: GrainServices;
  onSaved: () => Promise<void>;
}) {
  const [elevator, setElevator] = useState("Cargill - Olney");
  const [commodity, setCommodity] = useState("corn_yellow");
  const [basis, setBasis] = useState("");
  const [cashPrice, setCashPrice] = useState("");
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
    if (!submitLock.current.acquire()) return;
    const timestamp = new Date().toISOString();
    try {
      await services.grainRepository.saveCashBid({
        id: services.createGrainId(),
        farm_id: workspace.fields.farm.id,
        elevator,
        commodity_id: commodity,
        bid_date: farmLocalCalendarDate(),
        basis: Number(basis),
        cash_price: parsedCashPrice,
        delivery_start: null,
        delivery_end: null,
        notes: null,
        created_at: timestamp,
        updated_at: timestamp,
      });
      setBasis("");
      setCashPrice("");
      setError("");
      await onSaved();
    } catch (exception) {
      setError(farmerError(exception, "save this cash bid"));
    } finally {
      submitLock.current.release();
    }
  };
  const history = workspace.cash_bids
    .filter(
      (bid) => bid.elevator === elevator && bid.commodity_id === commodity,
    )
    .sort((left, right) => left.bid_date.localeCompare(right.bid_date))
    .slice(-8);
  const max = Math.max(0.01, ...history.map((bid) => Math.abs(bid.basis)));
  const mars = history.filter(isMarsBid);
  const lastMars = mars.at(-1)?.bid_date;
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
              ? `USDA MARS 2850 Iowa pilot, display-only; last dated ${lastMars}.`
              : ""}
          </p>
          {stale && (
            <p role="status">
              Basis feed unavailable — last updated {lastMars}.
            </p>
          )}
        </div>
      </div>
      <form className="basis-entry" onSubmit={(event) => void submit(event)}>
        <select
          value={elevator}
          onChange={(event) => setElevator(event.target.value)}
        >
          {[...new Set(workspace.cash_bids.map((bid) => bid.elevator))].map(
            (item) => (
              <option key={item}>{item}</option>
            ),
          )}
        </select>
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
        <input
          required
          type="number"
          step="0.01"
          inputMode="decimal"
          aria-label="Basis dollars per bushel"
          placeholder="Basis $/bu"
          value={basis}
          onChange={(event) => setBasis(event.target.value)}
        />
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          aria-label="Cash price dollars per bushel optional"
          placeholder="Cash price $/bu (optional)"
          value={cashPrice}
          onChange={(event) => setCashPrice(event.target.value)}
        />
        <button className="secondary-action" type="submit">
          Add basis
        </button>
      </form>
      {error && (
        <p className="form-error grain-inline-error" role="alert">
          {error}
        </p>
      )}
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
              </span>
              <strong>
                {bid.basis > 0 ? "+" : ""}
                {money.format(bid.basis)}
              </strong>
              {bid.cash_price !== null && (
                <small>Cash {money.format(bid.cash_price)}</small>
              )}
            </div>
          ))}
      </div>
    </section>
  );
}

function UsdaCalendar({
  reports,
}: {
  reports: GrainWorkspace["usda_report_dates"];
}) {
  const upcoming = reports
    .slice()
    .sort((left, right) => left.report_date.localeCompare(right.report_date));
  return (
    <section className="grain-section usda-calendar">
      <div className="section-heading">
        <div>
          <span className="eyebrow">USDA calendar</span>
          <h2>Market-moving report dates</h2>
          <p>
            2026 WASDE, Grain Stocks, Prospective Plantings, and Crop Progress
            dates.
          </p>
        </div>
      </div>
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
                { month: "short", day: "numeric" },
              )}
              {report.release_at
                ? ` · ${new Date(report.release_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                : ""}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function TargetEditor({
  month,
  commodity,
  target,
  scope,
  services,
  workspace,
  onClose,
  onSave,
}: {
  month: number;
  commodity: string;
  target?: MarketingPlanTarget;
  scope: PositionScope;
  services: GrainServices;
  workspace: GrainWorkspace;
  onClose: () => void;
  onSave: (values: {
    pct: number;
    price: number | null;
    relativePct: number | null;
    deadline: string | null;
  }) => void;
}) {
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
          onSave({
            pct: Number(pct),
            price: computedPrice ?? (price === "" ? null : Number(price)),
            relativePct: relativeValue,
            deadline: deadline || null,
          });
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{months[month - 1]} plan</span>
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
            value={price}
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
        <button className="primary-action" type="submit">
          Save target
        </button>
      </form>
    </div>
  );
}
