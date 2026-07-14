import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { fieldsRepository, moduleYear } from "./data";
import type {
  Arrangement,
  CropAssignment,
  Field,
  FieldDraft,
  FieldsData,
  FlexBonusFormula,
  LandArrangementType,
  LegacyFlexBonusFormula,
  StructuredFlexBonusFormula,
  SupportedFlexMethod,
} from "./data/fields";
import { isLegacyFlexBonusFormula } from "./data/fields";
import { farmerError } from "./lib/farmerErrors";
import { farmLocalCalendarDate } from "./data/farmDates";
import { createSubmitLock } from "./lib/submitLock";
import {
  computeStructuredFlexRent,
  fieldCardLand,
} from "./data/profitabilityCalculations";
import { structuredFlexFormulaError } from "./data/flexLeaseValidation";
import { roundDecimalHalfUp } from "./data/decimal";
import {
  createFieldEditDraft,
  type FieldEditPatch,
} from "./data/fieldEditPatch";

type SortKey = "name" | "entity" | "crop" | "arrangement" | "acres";
type InputShareKey =
  | "landlord_seed_pct"
  | "landlord_fertilizer_pct"
  | "landlord_chemical_pct"
  | "landlord_fuel_pct"
  | "landlord_labor_custom_pct"
  | "landlord_crop_insurance_pct"
  | "landlord_equipment_pct"
  | "landlord_interest_pct"
  | "landlord_other_input_pct";
const inputShareKeys: InputShareKey[] = [
  "landlord_seed_pct",
  "landlord_fertilizer_pct",
  "landlord_chemical_pct",
  "landlord_fuel_pct",
  "landlord_labor_custom_pct",
  "landlord_crop_insurance_pct",
  "landlord_equipment_pct",
  "landlord_interest_pct",
  "landlord_other_input_pct",
];
const inputShareFields: Array<{ key: InputShareKey; label: string }> = [
  { key: "landlord_seed_pct", label: "Seed" },
  { key: "landlord_fertilizer_pct", label: "Fertilizer" },
  { key: "landlord_chemical_pct", label: "Chemical" },
  { key: "landlord_fuel_pct", label: "Fuel" },
  { key: "landlord_labor_custom_pct", label: "Labor & custom work" },
  { key: "landlord_crop_insurance_pct", label: "Crop insurance" },
  { key: "landlord_equipment_pct", label: "Equipment & repairs" },
  { key: "landlord_interest_pct", label: "Interest" },
  { key: "landlord_other_input_pct", label: "Other inputs" },
];
const arrangementOptions: Array<{ value: LandArrangementType; label: string }> =
  [
    { value: "owned", label: "Owned" },
    { value: "cash_rent", label: "Cash rent" },
    { value: "flex_cash_rent", label: "Flex cash rent" },
    { value: "crop_share", label: "Crop share" },
  ];
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const today = () => farmLocalCalendarDate();

function formatAcres(acres: number) {
  return `${number.format(acres)} ac`;
}
function currentArrangement(arrangements: Arrangement[], fieldId: string) {
  return arrangements.find(
    (item) => item.field_id === fieldId && item.effective_to === null,
  );
}
function cropRows(data: FieldsData, fieldId: string, year?: number) {
  return data.crop_assignments
    .filter(
      (item) =>
        item.field_id === fieldId &&
        (year === undefined || item.crop_year === year),
    )
    .slice()
    .sort(
      (a, b) =>
        a.crop_year - b.crop_year || a.planting_sequence - b.planting_sequence,
    );
}
function cropName(data: FieldsData, commodityId: string) {
  return (
    data.commodities.find((item) => item.id === commodityId)?.name ??
    commodityId
  );
}
function cropNames(data: FieldsData, fieldId: string) {
  return cropRows(data, fieldId, moduleYear).map((item) =>
    cropName(data, item.commodity_id),
  );
}
function cropKey(
  assignment: Pick<
    CropAssignment,
    "crop_year" | "commodity_id" | "planting_sequence"
  >,
) {
  return `${assignment.crop_year}|${assignment.commodity_id}|${assignment.planting_sequence}`;
}
const flexMethodOptions: Array<{ value: SupportedFlexMethod; label: string }> =
  [
    {
      value: "base_plus_bonus",
      label: "Base rent + bonus above a revenue trigger",
    },
    {
      value: "pct_of_revenue",
      label: "Percent of gross revenue (with min/max)",
    },
  ];
function flexSummaryText(arrangement: Arrangement) {
  const formula = arrangement.flex_bonus_formula;
  if (!formula)
    return `Flex rent · base ${money.format(arrangement.cash_rent_per_acre ?? 0)}/ac`;
  if (isLegacyFlexBonusFormula(formula))
    return `Flex rent · base ${money.format(arrangement.cash_rent_per_acre ?? 0)}/ac`;
  if (formula.method === "pct_of_revenue")
    return `Flex rent · ${number.format(formula.rate_pct ?? 0)}% of gross revenue`;
  if (formula.method === "base_plus_bonus")
    return `Flex rent · base ${money.format(formula.base_rent_per_acre ?? 0)}/ac + bonus`;
  return `Flex rent · base ${money.format(arrangement.cash_rent_per_acre ?? 0)}/ac`;
}
function arrangementText(arrangement?: Arrangement) {
  if (!arrangement) return "No agreement recorded";
  if (arrangement.arrangement_type === "owned") return "Owned";
  if (arrangement.arrangement_type === "cash_rent")
    return `Cash rent ${money.format(arrangement.cash_rent_per_acre ?? 0)}/ac`;
  if (arrangement.arrangement_type === "flex_cash_rent")
    return flexSummaryText(arrangement);
  return `Crop share · landlord ${number.format(arrangement.landlord_crop_pct ?? 0)}%`;
}
function cropPrice(assignment: CropAssignment) {
  return assignment.expected_price_per_bu ?? null;
}
/** Plain-English description of a legacy per-unit formula (editor no longer offers these — read-only until the owner switches methods). */
function legacyFlexDescription(formula: LegacyFlexBonusFormula) {
  if (formula.type === "price")
    return `plus ${money.format(formula.bonus_rate)}/ac for every $1/bu the price is above ${money.format(formula.trigger)}/bu`;
  if (formula.type === "yield")
    return `plus ${money.format(formula.bonus_rate)}/ac for every bu/ac the yield is above ${number.format(formula.trigger)} bu/ac`;
  return `plus ${number.format(formula.bonus_rate)}% of gross revenue above ${money.format(formula.trigger)}/ac`;
}
function zeroShares() {
  return Object.fromEntries(inputShareKeys.map((key) => [key, 0])) as Record<
    InputShareKey,
    number
  >;
}
function inputShareValues(arrangement: Arrangement) {
  return Object.fromEntries(
    inputShareKeys.map((key) => [key, String(arrangement[key])]),
  ) as Record<InputShareKey, string>;
}

interface FlexEditValues {
  keepLegacy: boolean;
  method: SupportedFlexMethod;
  baseRent: string;
  ratePct: string;
  triggerRevenue: string;
  minRent: string;
  maxRent: string;
  priceSourceNote: string;
}
/** Seeds the editor: a saved legacy formula opens read-only (keepLegacy) so it is never silently rewritten; a saved structured formula opens pre-filled; a fresh flex lease defaults to percent-of-revenue (farmdoc's most-used v1 structure). */
function flexEditValuesFromArrangement(
  arrangement: Arrangement,
): FlexEditValues {
  const formula = arrangement.flex_bonus_formula;
  const legacy = formula !== null && isLegacyFlexBonusFormula(formula);
  const structured =
    formula !== null &&
    !legacy &&
    (formula as StructuredFlexBonusFormula).method !== undefined &&
    ((formula as StructuredFlexBonusFormula).method === "base_plus_bonus" ||
      (formula as StructuredFlexBonusFormula).method === "pct_of_revenue")
      ? (formula as StructuredFlexBonusFormula)
      : null;
  return {
    keepLegacy: legacy,
    method:
      structured?.method === "base_plus_bonus"
        ? "base_plus_bonus"
        : "pct_of_revenue",
    baseRent:
      structured?.base_rent_per_acre != null
        ? String(structured.base_rent_per_acre)
        : "",
    ratePct: structured?.rate_pct != null ? String(structured.rate_pct) : "",
    triggerRevenue:
      structured?.trigger_revenue_per_acre != null
        ? String(structured.trigger_revenue_per_acre)
        : "",
    minRent:
      structured?.min_rent_per_acre != null
        ? String(structured.min_rent_per_acre)
        : "",
    maxRent:
      structured?.max_rent_per_acre != null
        ? String(structured.max_rent_per_acre)
        : "",
    priceSourceNote: structured?.price_source_note ?? "",
  };
}
function numOrNull(value: string) {
  return value.trim() === "" ? null : Number(value);
}
function buildStructuredFlexFormula(
  method: SupportedFlexMethod,
  values: FlexEditValues,
): StructuredFlexBonusFormula {
  return {
    method,
    base_rent_per_acre:
      method === "base_plus_bonus" ? numOrNull(values.baseRent) : null,
    rate_pct: numOrNull(values.ratePct),
    trigger_revenue_per_acre:
      method === "base_plus_bonus" ? numOrNull(values.triggerRevenue) : null,
    base_price_per_bu: null,
    base_yield_per_acre: null,
    min_rent_per_acre:
      method === "pct_of_revenue" ? numOrNull(values.minRent) : null,
    max_rent_per_acre: numOrNull(values.maxRent),
    price_source_note: values.priceSourceNote.trim() || null,
  };
}
function flexPreviewText(
  formula: StructuredFlexBonusFormula,
  previewYield: number | null,
  previewPrice: number | null,
) {
  if (previewYield === null || previewPrice === null)
    return "Add an expected yield and a manual planned price on this field to preview the rent.";
  const rent = computeStructuredFlexRent(formula, previewYield, previewPrice);
  if (rent === null)
    return "Enter the fields above to preview this lease’s rent.";
  return `At ${number.format(previewYield)} bu and ${money.format(previewPrice)} this lease pays ${money.format(rent)}/ac.`;
}
function FlexMethodFields({
  values,
  legacyFormula,
  onChange,
  previewYield,
  previewPrice,
}: {
  values: FlexEditValues;
  legacyFormula: LegacyFlexBonusFormula | null;
  onChange: (patch: Partial<FlexEditValues>) => void;
  previewYield: number | null;
  previewPrice: number | null;
}) {
  if (values.keepLegacy)
    return (
      <div className="flex-legacy-note">
        <p>
          This lease keeps its current formula:{" "}
          {legacyFormula
            ? legacyFlexDescription(legacyFormula)
            : "an older bonus format."}{" "}
          Farm Rx will not change it unless you switch methods.
        </p>
        <button
          type="button"
          className="secondary-action"
          onClick={() => onChange({ keepLegacy: false })}
        >
          Switch to a supported method
        </button>
      </div>
    );
  const preview = flexPreviewText(
    buildStructuredFlexFormula(values.method, values),
    previewYield,
    previewPrice,
  );
  return (
    <>
      <FormControl label="Flex rent method">
        <select
          value={values.method}
          onChange={(event) =>
            onChange({ method: event.target.value as SupportedFlexMethod })
          }
        >
          {flexMethodOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FormControl>
      {values.method === "base_plus_bonus" && (
        <>
          <FormControl label="Base rent ($/ac)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={values.baseRent}
              onChange={(event) => onChange({ baseRent: event.target.value })}
            />
          </FormControl>
          <FormControl label="Bonus rate above trigger (%)">
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={values.ratePct}
              onChange={(event) => onChange({ ratePct: event.target.value })}
            />
          </FormControl>
          <FormControl label="Revenue trigger ($/ac)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={values.triggerRevenue}
              onChange={(event) =>
                onChange({ triggerRevenue: event.target.value })
              }
            />
          </FormControl>
          <FormControl label="Maximum rent — optional ($/ac)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={values.maxRent}
              onChange={(event) => onChange({ maxRent: event.target.value })}
            />
          </FormControl>
        </>
      )}
      {values.method === "pct_of_revenue" && (
        <>
          <FormControl label="Percent of gross revenue (%)">
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={values.ratePct}
              onChange={(event) => onChange({ ratePct: event.target.value })}
            />
          </FormControl>
          <FormControl label="Minimum rent — optional ($/ac)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={values.minRent}
              onChange={(event) => onChange({ minRent: event.target.value })}
            />
          </FormControl>
          <FormControl label="Maximum rent — optional ($/ac)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={values.maxRent}
              onChange={(event) => onChange({ maxRent: event.target.value })}
            />
          </FormControl>
        </>
      )}
      <FormControl label="Price source note — optional">
        <input
          placeholder="e.g. Fall average at ADM Decatur"
          value={values.priceSourceNote}
          onChange={(event) =>
            onChange({ priceSourceNote: event.target.value })
          }
        />
      </FormControl>
      <p className="flex-preview numeric">{preview}</p>
    </>
  );
}

function useFieldsData() {
  const [data, setData] = useState<FieldsData | null>(null);
  const [error, setError] = useState("");
  const refresh = async () => {
    try {
      const next = await fieldsRepository.getData();
      setData(next);
      setError("");
      return next;
    } catch (caught) {
      setError(farmerError(caught, "load your farm"));
      throw caught;
    }
  };
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, []);
  return { data, error, refresh };
}
function toDraft(
  field: Field,
  arrangement: Arrangement,
  assignments: CropAssignment[] = [],
  fieldPatch: Partial<Field> = {},
  arrangementPatch: Partial<Arrangement> = {},
): FieldDraft {
  const nextField = { ...field, ...fieldPatch };
  const nextArrangement = { ...arrangement, ...arrangementPatch };
  return {
    id: field.id,
    name: nextField.name,
    operating_entity_id: nextField.operating_entity_id,
    total_acres: nextField.total_acres,
    county: nextField.county,
    state: nextField.state,
    legal_description: nextField.legal_description,
    fsa_farm_number: nextField.fsa_farm_number,
    fsa_tract_number: nextField.fsa_tract_number,
    soil_productivity_index: nextField.soil_productivity_index,
    arrangement: {
      arrangement_type: nextArrangement.arrangement_type,
      landlord_name: nextArrangement.landlord_name,
      landlord_phone: nextArrangement.landlord_phone ?? null,
      landlord_contact_notes: nextArrangement.landlord_contact_notes ?? null,
      effective_from: nextArrangement.effective_from,
      cash_rent_per_acre: nextArrangement.cash_rent_per_acre,
      flex_bonus_formula: nextArrangement.flex_bonus_formula,
      landlord_crop_pct: nextArrangement.landlord_crop_pct,
      ...(Object.fromEntries(
        inputShareKeys.map((key) => [key, nextArrangement[key]]),
      ) as Record<InputShareKey, number>),
      notes: nextArrangement.notes,
    },
    crop_assignments: assignments.map((item) => ({
      id: item.id,
      is_new: !item.id,
      crop_year: item.crop_year,
      commodity_id: item.commodity_id,
      planted_acres: item.planted_acres,
      planting_sequence: item.planting_sequence,
      variety: item.variety,
      planting_date: item.planting_date,
      harvest_date: item.harvest_date,
      harvested_bushels: item.harvested_bushels,
      expected_yield_per_acre: item.expected_yield_per_acre ?? null,
      expected_price_per_bu: item.expected_price_per_bu ?? null,
      notes: item.notes,
    })),
  };
}

export function FieldsPage() {
  const { data, error, refresh } = useFieldsData();
  const navigate = useNavigate();
  const [cropFilter, setCropFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [arrangementFilter, setArrangementFilter] = useState("all");
  const [missingCropOnly, setMissingCropOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAscending, setSortAscending] = useState(true);
  const visibleFields = useMemo(
    () =>
      !data
        ? []
        : data.fields
            .filter((field) => field.is_active)
            .filter(
              (field) =>
                entityFilter === "all" ||
                field.operating_entity_id === entityFilter,
            )
            .filter(
              (field) =>
                arrangementFilter === "all" ||
                currentArrangement(data.arrangements, field.id)
                  ?.arrangement_type === arrangementFilter,
            )
            .filter((field) =>
              missingCropOnly
                ? cropRows(data, field.id, moduleYear).length === 0
                : cropFilter === "all" ||
                  cropRows(data, field.id, moduleYear).some(
                    (crop) => crop.commodity_id === cropFilter,
                  ),
            )
            .slice()
            .sort((left, right) => {
              const entity = (field: Field) =>
                data.entities.find(
                  (item) => item.id === field.operating_entity_id,
                )?.name ?? "";
              const value = (field: Field) =>
                sortKey === "entity"
                  ? entity(field)
                  : sortKey === "crop"
                    ? cropNames(data, field.id).join(", ")
                    : sortKey === "arrangement"
                      ? arrangementText(
                          currentArrangement(data.arrangements, field.id),
                        )
                      : sortKey === "acres"
                        ? field.total_acres
                        : field.name;
              const leftValue = value(left);
              const rightValue = value(right);
              const compared =
                typeof leftValue === "number" && typeof rightValue === "number"
                  ? leftValue - rightValue
                  : String(leftValue).localeCompare(String(rightValue));
              return sortAscending ? compared : -compared;
            }),
    [
      arrangementFilter,
      cropFilter,
      data,
      entityFilter,
      missingCropOnly,
      sortAscending,
      sortKey,
    ],
  );
  if (!data) return <LoadingState message={error || undefined} />;
  const activeFields = data.fields.filter((field) => field.is_active);
  const assigned = activeFields.filter(
    (field) => cropRows(data, field.id, moduleYear).length > 0,
  ).length;
  const totalAcres = activeFields.reduce(
    (total, field) => total + field.total_acres,
    0,
  );
  const changeSort = (key: SortKey) => {
    if (key === sortKey) setSortAscending((value) => !value);
    else {
      setSortKey(key);
      setSortAscending(true);
    }
  };
  const toggleMissingCrop = () =>
    setMissingCropOnly((value) => {
      const next = !value;
      if (next) setCropFilter("all");
      return next;
    });
  return (
    <section className="page fields-page">
      <div className="page-heading">
        <div>
          <h1>Fields</h1>
          <p>Every acre in one clear view.</p>
        </div>
        <Link className="secondary-action" to="/fields/new">
          Full field details
        </Link>
      </div>
      <div className="stats-grid" aria-label="Farm totals">
        <StatCard
          label="Total fields"
          value={number.format(activeFields.length)}
        />
        <StatCard
          label="Total acres"
          value={number.format(totalAcres)}
          unit="ac"
        />
        <button
          className={`stat-card crop-nudge${assigned < activeFields.length ? " needs-attention" : ""}`}
          type="button"
          onClick={toggleMissingCrop}
          aria-pressed={missingCropOnly}
        >
          <span className="stat-label">Crops assigned</span>
          <strong className="stat-value numeric">
            {assigned}/{activeFields.length}
          </strong>
          <span className="stat-note">
            {missingCropOnly
              ? "Showing fields missing a crop · tap to clear"
              : assigned < activeFields.length
                ? "Tap to finish setup"
                : "All current fields assigned"}
          </span>
        </button>
      </div>
      <section className="data-card" aria-labelledby="field-list-heading">
        <div className="card-heading" id="field-list-heading">
          Field list
        </div>
        <div className="filter-bar" aria-label="Filter fields">
          <FilterSelect
            label="Crop"
            value={cropFilter}
            onChange={setCropFilter}
          >
            <option value="all">All crops</option>
            {data.commodities.map((commodity) => (
              <option key={commodity.id} value={commodity.id}>
                {commodity.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Entity"
            value={entityFilter}
            onChange={setEntityFilter}
          >
            <option value="all">All entities</option>
            {data.entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Arrangement"
            value={arrangementFilter}
            onChange={setArrangementFilter}
          >
            <option value="all">All arrangements</option>
            {arrangementOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeader
                  label="Field"
                  active={sortKey === "name"}
                  ascending={sortAscending}
                  onClick={() => changeSort("name")}
                />
                <SortHeader
                  label="Entity"
                  active={sortKey === "entity"}
                  ascending={sortAscending}
                  onClick={() => changeSort("entity")}
                />
                <SortHeader
                  label="This year"
                  active={sortKey === "crop"}
                  ascending={sortAscending}
                  onClick={() => changeSort("crop")}
                />
                <SortHeader
                  label="Agreement"
                  active={sortKey === "arrangement"}
                  ascending={sortAscending}
                  onClick={() => changeSort("arrangement")}
                />
                <SortHeader
                  label="Acres"
                  align="right"
                  active={sortKey === "acres"}
                  ascending={sortAscending}
                  onClick={() => changeSort("acres")}
                />
              </tr>
            </thead>
            <tbody>
              {visibleFields.map((field) => (
                <FieldListRow
                  key={field.id}
                  data={data}
                  field={field}
                  onOpen={() => navigate(`/fields/${field.id}`)}
                />
              ))}
              <InlineAddRow data={data} onSaved={refresh} />
            </tbody>
          </table>
        </div>
        {visibleFields.length === 0 && (
          <div className="filter-empty">
            No fields match those filters. Add one below or clear the crop setup
            filter.
          </div>
        )}
        <div className="table-total">
          <span>Total acres</span>
          <span className="numeric">
            {formatAcres(
              visibleFields.reduce(
                (total, field) => total + field.total_acres,
                0,
              ),
            )}
          </span>
        </div>
      </section>
    </section>
  );
}

function FieldListRow({
  data,
  field,
  onOpen,
}: {
  data: FieldsData;
  field: Field;
  onOpen: () => void;
}) {
  const entity = data.entities.find(
    (item) => item.id === field.operating_entity_id,
  );
  return (
    <tr
      className="interactive-row"
      tabIndex={0}
      role="link"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
    >
      <td className="field-name">{field.name}</td>
      <td>{entity?.name ?? "Unknown entity"}</td>
      <td>
        {cropNames(data, field.id).join(" + ") || (
          <span className="status-chip not-started">Needs crop</span>
        )}
      </td>
      <td>
        {arrangementText(currentArrangement(data.arrangements, field.id))}
      </td>
      <td className="align-right numeric">{formatAcres(field.total_acres)}</td>
    </tr>
  );
}
function InlineAddRow({
  data,
  onSaved,
}: {
  data: FieldsData;
  onSaved: () => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [acres, setAcres] = useState("");
  const [county, setCounty] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const submitLock = useRef(createSubmitLock());
  const savedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );
  const save = async () => {
    const parsedAcres = Number(acres);
    if (!name.trim() || !Number.isFinite(parsedAcres) || parsedAcres <= 0) {
      setSaved("");
      setError("Enter a field name and acres above zero.");
      return;
    }
    const entity = data.entities.find((item) => item.is_active);
    if (!entity) {
      setError("Add an operating entity before adding a field.");
      return;
    }
    if (!submitLock.current.acquire()) return;
    try {
      await fieldsRepository.saveField({
        name,
        operating_entity_id: entity.id,
        total_acres: parsedAcres,
        county: county.trim() || null,
        state: null,
        legal_description: null,
        fsa_farm_number: null,
        fsa_tract_number: null,
        soil_productivity_index: null,
        arrangement: {
          arrangement_type: "owned",
          landlord_name: null,
          landlord_phone: null,
          landlord_contact_notes: null,
          effective_from: today(),
          cash_rent_per_acre: null,
          flex_bonus_formula: null,
          landlord_crop_pct: null,
          ...zeroShares(),
          notes: null,
        },
        crop_assignments: [],
      });
      setName("");
      setAcres("");
      setCounty("");
      setError("");
      try {
        await onSaved();
        setSaved("Saved");
      } catch {
        setSaved("Saved. Couldn't refresh the page — pull to reload.");
      }
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(""), 2500);
    } catch (reason) {
      setSaved("");
      setError(farmerError(reason, "save this field"));
    } finally {
      submitLock.current.release();
    }
  };
  const leaveRow = (event: FocusEvent<HTMLTableRowElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) void save();
  };
  return (
    <tr className="inline-add-row" onBlur={leaveRow}>
      <td>
        <input
          aria-label="New field name"
          placeholder="Field name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
        />
        <span className="inline-add-saved" aria-live="polite">
          {saved}
        </span>
        {error && (
          <span className="inline-add-error" role="alert">
            {error}
          </span>
        )}
      </td>
      <td className="inline-add-note" colSpan={2}>
        Quick add · details later
      </td>
      <td>
        <input
          aria-label="New field county or location"
          placeholder="County / location"
          value={county}
          onChange={(event) => setCounty(event.target.value)}
        />
      </td>
      <td>
        <input
          aria-label="New field acres"
          className="numeric"
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          placeholder="Acres"
          value={acres}
          onChange={(event) => setAcres(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
        />
      </td>
    </tr>
  );
}

export function FieldDetailPage() {
  const { data, error, refresh } = useFieldsData();
  const { id } = useParams();
  const location = useLocation();
  const fieldLock = useRef(createSubmitLock());
  const dataRef = useRef<FieldsData | null>(null);
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  const [pageNotice] = useState(
    () =>
      (location.state as { fieldsNotice?: string } | null)?.fieldsNotice ?? "",
  );
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  if (!data) return <LoadingState message={error || undefined} />;
  const field = data.fields.find((item) => item.id === id);
  if (!field) return <NotFoundState />;
  const arrangement = currentArrangement(data.arrangements, field.id);
  if (!arrangement) return <NotFoundState />;
  const save = (patch: FieldEditPatch) => {
    const queued = saveTail.current.then(async () => {
      const latest = dataRef.current;
      if (!latest) throw new Error("The field is still loading. Please try again.");
      if (!fieldLock.current.acquire()) return;
      try {
        await fieldsRepository.saveField(
          createFieldEditDraft(latest, field.id, patch),
        );
        try {
          dataRef.current = await refresh();
        } catch {
          dataRef.current = null;
          throw new Error("Saved. Couldn't refresh the page — reload to continue.");
        }
      } finally {
        fieldLock.current.release();
      }
    });
    // Keep the queue available after one rejected save while returning that error to its card.
    saveTail.current = queued.catch(() => undefined);
    return queued;
  };
  return (
    <section className="page detail-page">
      <div className="detail-topline">
        <Link className="back-link" to="/fields">
          ← All fields
        </Link>
        <Link className="secondary-action" to={`/fields/${field.id}/edit`}>
          Full editor
        </Link>
      </div>
      <div className="page-heading compact-heading">
        <div>
          <h1>{field.name}</h1>
          <p>
            {[field.county, field.state].filter(Boolean).join(", ") ||
              "Location not recorded"}
          </p>
        </div>
      </div>
      {pageNotice && (
        <p className="form-error" role="status">
          {pageNotice}
        </p>
      )}
      <BasicsCard
        data={data}
        field={field}
        onSave={save}
      />
      <AgreementCard
        data={data}
        field={field}
        arrangement={arrangement}
        onSave={save}
      />
      <YieldPriceCard
        data={data}
        field={field}
        onSave={save}
      />
      <RecordsCard
        data={data}
        field={field}
        onSave={save}
      />
    </section>
  );
}

function Card({
  title,
  editing,
  onEdit,
  children,
}: {
  title: string;
  editing: boolean;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section className="detail-card edit-card">
      <div className="card-heading">
        <span>{title}</span>
        <button className="card-edit" type="button" onClick={onEdit}>
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>
      {children}
    </section>
  );
}
function CardSave({ error, onSave }: { error: string; onSave: () => void }) {
  return (
    <div className="card-save">
      <button type="button" className="primary-action" onClick={onSave}>
        Save
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function BasicsCard({
  data,
  field,
  onSave,
}: {
  data: FieldsData;
  field: Field;
  onSave: (patch: FieldEditPatch) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const freshValues = () => ({
    name: field.name,
    acres: String(field.total_acres),
    county: field.county ?? "",
    state: field.state ?? "",
    fsaFarm: field.fsa_farm_number ?? "",
    fsaTract: field.fsa_tract_number ?? "",
  });
  const [values, setValues] = useState(freshValues);
  const [error, setError] = useState("");
  const submitLock = useRef(createSubmitLock());
  const save = async () => {
    const acres = Number(values.acres);
    if (!values.name.trim() || !Number.isFinite(acres) || acres <= 0) {
      setError("Enter a field name and acres above zero.");
      return;
    }
    if (!submitLock.current.acquire()) return;
    try {
      await onSave({
        field: {
          name: values.name.trim(),
          total_acres: acres,
          county: values.county.trim() || null,
          state: values.state.trim() || null,
          fsa_farm_number: values.fsaFarm.trim() || null,
          fsa_tract_number: values.fsaTract.trim() || null,
        },
      });
      setEditing(false);
      setError("");
    } catch (reason) {
      setError(farmerError(reason, "save basics"));
    } finally {
      submitLock.current.release();
    }
  };
  return (
    <Card
      title="Basics"
      editing={editing}
      onEdit={() => {
        if (!editing) setValues(freshValues());
        setEditing((value) => !value);
        setError("");
      }}
    >
      {editing ? (
        <div className="card-form">
          <FormControl label="Field name">
            <input
              value={values.name}
              onChange={(event) =>
                setValues({ ...values, name: event.target.value })
              }
            />
          </FormControl>
          <FormControl label="Acres">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={values.acres}
              onChange={(event) =>
                setValues({ ...values, acres: event.target.value })
              }
            />
          </FormControl>
          <FormControl label="County / location">
            <input
              value={values.county}
              onChange={(event) =>
                setValues({ ...values, county: event.target.value })
              }
            />
          </FormControl>
          <FormControl label="State">
            <input
              value={values.state}
              onChange={(event) =>
                setValues({ ...values, state: event.target.value })
              }
            />
          </FormControl>
          <FormControl label="FSA farm number">
            <input
              value={values.fsaFarm}
              onChange={(event) =>
                setValues({ ...values, fsaFarm: event.target.value })
              }
            />
          </FormControl>
          <FormControl label="FSA tract number">
            <input
              value={values.fsaTract}
              onChange={(event) =>
                setValues({ ...values, fsaTract: event.target.value })
              }
            />
          </FormControl>
          <CardSave error={error} onSave={() => void save()} />
        </div>
      ) : (
        <InfoGrid>
          <Info label="Acres" value={formatAcres(field.total_acres)} numeric />
          <Info
            label="County / location"
            value={
              [field.county, field.state].filter(Boolean).join(", ") || "—"
            }
          />
          <Info
            label="FSA farm / tract"
            value={
              [field.fsa_farm_number, field.fsa_tract_number]
                .filter(Boolean)
                .join(" / ") || "—"
            }
          />
          <Info
            label="Operating entity"
            value={
              data.entities.find(
                (entity) => entity.id === field.operating_entity_id,
              )?.name ?? "—"
            }
          />
        </InfoGrid>
      )}
    </Card>
  );
}
function AgreementCard({
  data,
  field,
  arrangement,
  onSave,
}: {
  data: FieldsData;
  field: Field;
  arrangement: Arrangement;
  onSave: (patch: FieldEditPatch) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const freshValues = () => ({
    type: arrangement.arrangement_type,
    landlord: arrangement.landlord_name ?? "",
    phone: arrangement.landlord_phone ?? "",
    contactNotes: arrangement.landlord_contact_notes ?? "",
    rent: arrangement.cash_rent_per_acre?.toString() ?? "",
    share: arrangement.landlord_crop_pct?.toString() ?? "",
    inputShares: inputShareValues(arrangement),
    effective: arrangement.effective_from,
    flex: flexEditValuesFromArrangement(arrangement),
  });
  const [values, setValues] = useState(freshValues);
  const [error, setError] = useState("");
  const submitLock = useRef(createSubmitLock());
  const currentRows = cropRows(data, field.id, moduleYear);
  const previewCrop = currentRows[0];
  const setFlex = (patch: Partial<FlexEditValues>) =>
    setValues((current) => ({
      ...current,
      flex: { ...current.flex, ...patch },
    }));
  const setInputShare = (key: InputShareKey, value: string) =>
    setValues((current) => ({
      ...current,
      inputShares: { ...current.inputShares, [key]: value },
    }));
  const useCropShareForInputs = () =>
    setValues((current) => ({
      ...current,
      inputShares: Object.fromEntries(
        inputShareKeys.map((key) => [key, current.share]),
      ) as Record<InputShareKey, string>,
    }));
  const savedLegacyFormula =
    arrangement.flex_bonus_formula &&
    isLegacyFlexBonusFormula(arrangement.flex_bonus_formula)
      ? arrangement.flex_bonus_formula
      : null;

  const save = async () => {
    const rent = values.rent === "" ? null : Number(values.rent);
    const share = values.share === "" ? null : Number(values.share);
    const inputShares = Object.fromEntries(
      inputShareKeys.map((key) => [
        key,
        roundDecimalHalfUp(Number(values.inputShares[key]), 2),
      ]),
    ) as Record<InputShareKey, number>;
    if (
      values.type === "cash_rent" &&
      (rent === null || !Number.isFinite(rent) || rent < 0)
    ) {
      setError("Enter a cash rent rate of zero or greater.");
      return;
    }
    if (
      values.type === "flex_cash_rent" &&
      values.flex.keepLegacy &&
      (rent === null || !Number.isFinite(rent) || rent < 0)
    ) {
      setError("Enter a base rent of zero or greater.");
      return;
    }
    if (
      values.type === "crop_share" &&
      (share === null || !Number.isFinite(share) || share <= 0 || share >= 100)
    ) {
      setError("Enter a landlord crop share between 0 and 100.");
      return;
    }
    if (
      values.type === "crop_share" &&
      inputShareKeys.some(
        (key) =>
          values.inputShares[key].trim() === "" ||
          !Number.isFinite(inputShares[key]) ||
          inputShares[key] < 0 ||
          inputShares[key] > 100,
      )
    ) {
      setError(
        "Enter each input share as a number from 0 to 100. Use 0 when the landlord does not pay that cost.",
      );
      return;
    }
    let flexFormula: FlexBonusFormula | null = null;
    let flexCashRent: number | null = rent;
    if (values.type === "flex_cash_rent") {
      if (values.flex.keepLegacy) {
        if (!savedLegacyFormula) {
          setError(
            "This lease no longer has a formula to keep. Choose a method below.",
          );
          return;
        }
        flexFormula = savedLegacyFormula;
      } else {
        const built = buildStructuredFlexFormula(
          values.flex.method,
          values.flex,
        );
        const problem = structuredFlexFormulaError(
          built as unknown as Record<string, unknown>,
        );
        if (problem) {
          setError(problem);
          return;
        }
        flexFormula = built;
        // The live arrangements table still requires a non-null cash_rent_per_acre for every
        // flex_cash_rent row (a pre-existing DB constraint this src-only change cannot alter);
        // the structured calculator never reads it — computeStructuredFlexRent uses only the
        // formula's own fields — so this is a display-only placeholder, not part of the math.
        flexCashRent =
          built.method === "base_plus_bonus"
            ? (built.base_rent_per_acre ?? 0)
            : (built.min_rent_per_acre ?? 0);
      }
    }
    if (!submitLock.current.acquire()) return;
    try {
      await onSave({
        arrangement: {
            arrangement_type: values.type,
            landlord_name: values.landlord.trim() || null,
            landlord_phone: values.phone.trim() || null,
            landlord_contact_notes: values.contactNotes.trim() || null,
            effective_from: values.effective || today(),
            cash_rent_per_acre:
              values.type === "cash_rent"
                ? rent
                : values.type === "flex_cash_rent"
                  ? flexCashRent
                  : null,
            flex_bonus_formula:
              values.type === "flex_cash_rent" ? flexFormula : null,
            landlord_crop_pct: values.type === "crop_share" ? share : null,
            ...(values.type === "crop_share" ? inputShares : zeroShares()),
        },
      });
      setEditing(false);
      setError("");
    } catch (reason) {
      setError(farmerError(reason, "save agreement"));
    } finally {
      submitLock.current.release();
    }
  };

  // This tested seam must receive the whole arrangement history; split-year leases fail closed.
  const fieldLand = fieldCardLand(field, currentRows, data.arrangements);
  const equivalent = fieldLand.status === "resolved" ? fieldLand.rentPerFieldAcre : null;
  const needs =
    arrangement.arrangement_type === "flex_cash_rent" &&
    savedLegacyFormula?.type === "price"
      ? "a manual planned price"
      : arrangement.arrangement_type === "flex_cash_rent" &&
          savedLegacyFormula?.type === "yield"
        ? "an expected yield"
        : "an expected yield and a manual planned price";

  return (
    <Card
      title="Land agreement"
      editing={editing}
      onEdit={() => {
        if (!editing) setValues(freshValues());
        setEditing((value) => !value);
        setError("");
      }}
    >
      {editing ? (
        <div className="card-form">
          <FormControl label="Arrangement type">
            <select
              value={values.type}
              onChange={(event) =>
                setValues({
                  ...values,
                  type: event.target.value as LandArrangementType,
                })
              }
            >
              {arrangementOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormControl>
          <FormControl label="Terms effective from">
            <input
              type="date"
              value={values.effective}
              onChange={(event) =>
                setValues({ ...values, effective: event.target.value })
              }
            />
          </FormControl>
          {values.type !== "owned" && (
            <>
              <FormControl label="Landlord name">
                <input
                  value={values.landlord}
                  onChange={(event) =>
                    setValues({ ...values, landlord: event.target.value })
                  }
                />
              </FormControl>
              <FormControl label="Landlord phone">
                <input
                  type="tel"
                  value={values.phone}
                  onChange={(event) =>
                    setValues({ ...values, phone: event.target.value })
                  }
                />
              </FormControl>
              <FormControl label="Landlord contact notes">
                <textarea
                  rows={2}
                  value={values.contactNotes}
                  onChange={(event) =>
                    setValues({ ...values, contactNotes: event.target.value })
                  }
                />
              </FormControl>
            </>
          )}
          {(values.type === "cash_rent" ||
            (values.type === "flex_cash_rent" && values.flex.keepLegacy)) && (
            <FormControl
              label={
                values.type === "flex_cash_rent"
                  ? "Base rent ($/ac)"
                  : "Cash rent ($/ac)"
              }
            >
              <input
                type="number"
                min="0"
                step="0.01"
                value={values.rent}
                onChange={(event) =>
                  setValues({ ...values, rent: event.target.value })
                }
              />
            </FormControl>
          )}
          {values.type === "flex_cash_rent" && (
            <FlexMethodFields
              values={values.flex}
              legacyFormula={savedLegacyFormula}
              onChange={setFlex}
              previewYield={previewCrop?.expected_yield_per_acre ?? null}
              previewPrice={previewCrop?.expected_price_per_bu ?? null}
            />
          )}
          {values.type === "crop_share" && (
            <>
              <FormControl label="Landlord crop share (%)">
                <input
                  className="numeric"
                  type="number"
                  min="0.01"
                  max="99.99"
                  step="0.01"
                  value={values.share}
                  onChange={(event) =>
                    setValues({ ...values, share: event.target.value })
                  }
                />
              </FormControl>
              <section
                className="input-shares"
                aria-labelledby="input-shares-heading"
              >
                <div className="input-shares-heading">
                  <div>
                    <h3 id="input-shares-heading">Input shares</h3>
                    <p>What share of each input cost does the landlord pay?</p>
                    <small>
                      These percentages drive the Landlord report's crop-share
                      settlement.
                    </small>
                  </div>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={useCropShareForInputs}
                  >
                    Same as crop share
                  </button>
                </div>
                <div className="input-share-grid">
                  {inputShareFields.map(({ key, label }) => (
                    <FormControl key={key} label={`${label} (%)`}>
                      <input
                        className="numeric"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={values.inputShares[key]}
                        disabled={key === "landlord_other_input_pct"}
                        onChange={(event) =>
                          setInputShare(key, event.target.value)
                        }
                      />
                      {key === "landlord_other_input_pct" && <small>Not used yet — budgets don't have an 'Other' cost category. Custom work is now shared under Labor & custom work.</small>}
                    </FormControl>
                  ))}
                </div>
              </section>
            </>
          )}
          <CardSave error={error} onSave={() => void save()} />
        </div>
      ) : (
        <>
          <InfoGrid>
            <Info label="Arrangement" value={arrangementText(arrangement)} />
            <Info label="Landlord" value={arrangement.landlord_name || "—"} />
            <Info label="Phone" value={arrangement.landlord_phone || "—"} />
            <Info
              label="Contact notes"
              value={arrangement.landlord_contact_notes || "—"}
            />
          </InfoGrid>
          <div className="equivalent-rent">
            <strong>
              {arrangement.arrangement_type === "cash_rent"
                ? "Field cash rent"
                : "Field equivalent cash rent"}
            </strong>
            {arrangement.arrangement_type === "owned" ? (
              <span>— · Owned ground has no rent estimate.</span>
            ) : currentRows.length === 0 ? (
              <span>— · Assign a current-year crop to estimate rent.</span>
            ) : (
              <>
                <span>
                  <b className="numeric">
                    {equivalent === null
                      ? "—"
                      : `${money.format(equivalent)}/ac`}
                  </b>
                  {equivalent === null && ` · ${fieldLand.status === "blocked" ? fieldLand.reason : `enter ${needs}`}`}
                </span>
                {equivalent !== null &&
                  arrangement.arrangement_type !== "cash_rent" && (
                    <small>
                      Base rent is counted once; crop components are weighted by
                      planted acres. Prices use the manual planned price.
                    </small>
                  )}
                {arrangement.arrangement_type === "flex_cash_rent" &&
                  savedLegacyFormula && (
                    <small>
                      This lease uses Farm Rx's older per-unit bonus format:{" "}
                      {legacyFlexDescription(savedLegacyFormula)}
                    </small>
                  )}
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
function YieldPriceCard({
  data,
  field,
  onSave,
}: {
  data: FieldsData;
  field: Field;
  onSave: (patch: FieldEditPatch) => Promise<void>;
}) {
  const rows = cropRows(data, field.id, moduleYear);
  const [editing, setEditing] = useState(false);
  const freshValues = () =>
    rows.map((row) => ({
      id: row.id,
      yield: row.expected_yield_per_acre?.toString() ?? "",
      price: row.expected_price_per_bu?.toString() ?? "",
    }));
  const [values, setValues] = useState(freshValues);
  const [error, setError] = useState("");
  const submitLock = useRef(createSubmitLock());
  const save = async () => {
    const changes = rows.map((row) => {
      const value = values.find((item) => item.id === row.id);
      return {
        ...row,
        expected_yield_per_acre:
          !value || value.yield === "" ? null : Number(value.yield),
        expected_price_per_bu:
          !value || value.price === "" ? null : Number(value.price),
      };
    });
    if (
      changes.some(
        (row) =>
          (row.expected_yield_per_acre !== null &&
            (!Number.isFinite(row.expected_yield_per_acre) ||
              row.expected_yield_per_acre <= 0)) ||
          (row.expected_price_per_bu !== null &&
            (!Number.isFinite(row.expected_price_per_bu) ||
              row.expected_price_per_bu < 0)),
      )
    ) {
      setError(
        "Expected yield must be above zero; planned price cannot be negative.",
      );
      return;
    }
    if (!submitLock.current.acquire()) return;
    try {
      await onSave({
        cropAssignmentChanges: changes.map((row) => ({
          id: row.id,
          expected_yield_per_acre: row.expected_yield_per_acre,
          expected_price_per_bu: row.expected_price_per_bu,
        })),
      });
      setEditing(false);
      setError("");
    } catch (reason) {
      setError(farmerError(reason, "save yield and price"));
    } finally {
      submitLock.current.release();
    }
  };
  return (
    <Card
      title="Yield & price"
      editing={editing}
      onEdit={() => {
        if (!editing) setValues(freshValues());
        setEditing((value) => !value);
        setError("");
      }}
    >
      {rows.length === 0 ? (
        <p className="card-empty">No current-year crop assigned yet.</p>
      ) : editing ? (
        <div className="card-form assignment-editor">
          {rows.map((row) => {
            const value = values.find((item) => item.id === row.id) ?? {
              yield: "",
              price: "",
            };
            return (
              <div className="assignment-edit-row" key={row.id}>
                <strong>{cropName(data, row.commodity_id)}</strong>
                <FormControl label="Expected yield (bu/ac)">
                  <input
                    type="number"
                    min="0.01"
                    step="0.1"
                    value={value.yield}
                    onChange={(event) =>
                      setValues(
                        values.map((item) =>
                          item.id === row.id
                            ? { ...item, yield: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </FormControl>
                <FormControl label="Manual planned price ($/bu)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={value.price}
                    onChange={(event) =>
                      setValues(
                        values.map((item) =>
                          item.id === row.id
                            ? { ...item, price: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </FormControl>
              </div>
            );
          })}
          <CardSave error={error} onSave={() => void save()} />
        </div>
      ) : (
        <div className="yield-list">
          {rows.map((row) => (
            <div key={row.id}>
              <strong>{cropName(data, row.commodity_id)}</strong>
              <span className="numeric">
                {row.expected_yield_per_acre === null
                  ? "—"
                  : `${number.format(row.expected_yield_per_acre)} bu/ac`}
              </span>
              <span className="numeric">
                {cropPrice(row) === null
                  ? "— · enter plan"
                  : `${money.format(cropPrice(row)!)} /bu plan`}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
function RecordsCard({
  data,
  field,
  onSave,
}: {
  data: FieldsData;
  field: Field;
  onSave: (patch: FieldEditPatch) => Promise<void>;
}) {
  const rows = cropRows(data, field.id);
  const [editing, setEditing] = useState(false);
  const freshValues = () =>
    rows.map((row) => ({
      ...row,
      acres: String(row.planted_acres),
      harvested: row.harvested_bushels?.toString() ?? "",
    }));
  const freshNewRecord = () => ({
    commodity: "",
    year: String(moduleYear),
    sequence: "1",
    acres: String(field.total_acres),
  });
  const [values, setValues] = useState(freshValues);
  const [newRecord, setNewRecord] = useState(freshNewRecord);
  const [error, setError] = useState("");
  const submitLock = useRef(createSubmitLock());
  const save = async () => {
    const changes = rows.map((row) => {
      const value = values.find((item) => item.id === row.id)!;
      return {
        ...row,
        planted_acres: Number(value.acres),
        harvested_bushels:
          value.harvested === "" ? null : Number(value.harvested),
      };
    });
    const additions = newRecord.commodity
      ? [{
        crop_year: Number(newRecord.year),
        commodity_id: newRecord.commodity,
        planted_acres: Number(newRecord.acres),
        planting_sequence: Number(newRecord.sequence),
        variety: null,
        planting_date: null,
        harvest_date: null,
        harvested_bushels: null,
        expected_yield_per_acre: null,
        expected_price_per_bu: null,
        notes: null,
      }]
      : [];
    const next = [...changes, ...additions];
    const unique = new Set(next.map(cropKey));
    if (unique.size !== next.length) {
      setError(
        "Each crop record must have a unique crop year, commodity, and sequence.",
      );
      return;
    }
    if (
      next.some(
        (row) =>
          !Number.isInteger(row.crop_year) ||
          !row.commodity_id ||
          !Number.isInteger(row.planting_sequence) ||
          row.planting_sequence <= 0 ||
          !Number.isFinite(row.planted_acres) ||
          row.planted_acres <= 0 ||
          row.planted_acres > field.total_acres ||
          (row.harvested_bushels !== null &&
            (!Number.isFinite(row.harvested_bushels) ||
              row.harvested_bushels < 0)),
      )
    ) {
      setError(
        "Choose a crop and valid year/sequence; planted acres must be above zero and within field acres.",
      );
      return;
    }
    if (!submitLock.current.acquire()) return;
    try {
      await onSave({
        cropAssignmentChanges: changes.map((row) => ({
          id: row.id,
          planted_acres: row.planted_acres,
          harvested_bushels: row.harvested_bushels,
        })),
        newCropAssignments: additions,
      });
      setEditing(false);
      setError("");
      setNewRecord(freshNewRecord());
    } catch (reason) {
      setError(farmerError(reason, "save records"));
    } finally {
      submitLock.current.release();
    }
  };
  return (
    <Card
      title="Records"
      editing={editing}
      onEdit={() => {
        if (!editing) {
          setValues(freshValues());
          setNewRecord(freshNewRecord());
        }
        setEditing((value) => !value);
        setError("");
      }}
    >
      {editing ? (
        <div className="card-form assignment-editor">
          {rows.map((row) => {
            const value = values.find((item) => item.id === row.id)!;
            return (
              <div className="assignment-edit-row" key={row.id}>
                <strong>
                  {row.crop_year} · {cropName(data, row.commodity_id)} · #
                  {row.planting_sequence}
                </strong>
                <FormControl label="Planted acres">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={value.acres}
                    onChange={(event) =>
                      setValues(
                        values.map((item) =>
                          item.id === row.id
                            ? { ...item, acres: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </FormControl>
                <FormControl label="Harvested bushels">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={value.harvested}
                    onChange={(event) =>
                      setValues(
                        values.map((item) =>
                          item.id === row.id
                            ? { ...item, harvested: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </FormControl>
              </div>
            );
          })}
          <div className="assignment-edit-row add-crop-record">
            <strong>Add crop record</strong>
            <FormControl label="Crop">
              <select
                value={newRecord.commodity}
                onChange={(event) =>
                  setNewRecord({ ...newRecord, commodity: event.target.value })
                }
              >
                <option value="">Choose crop</option>
                {data.commodities.map((commodity) => (
                  <option key={commodity.id} value={commodity.id}>
                    {commodity.name}
                  </option>
                ))}
              </select>
            </FormControl>
            <FormControl label="Crop year">
              <input
                type="number"
                min="1900"
                max="2200"
                value={newRecord.year}
                onChange={(event) =>
                  setNewRecord({ ...newRecord, year: event.target.value })
                }
              />
            </FormControl>
            <FormControl label="Sequence">
              <input
                type="number"
                min="1"
                step="1"
                value={newRecord.sequence}
                onChange={(event) =>
                  setNewRecord({ ...newRecord, sequence: event.target.value })
                }
              />
            </FormControl>
            <FormControl label="Planted acres">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={newRecord.acres}
                onChange={(event) =>
                  setNewRecord({ ...newRecord, acres: event.target.value })
                }
              />
            </FormControl>
          </div>
          <CardSave error={error} onSave={() => void save()} />
        </div>
      ) : rows.length === 0 ? (
        <p className="card-empty">
          No crop assignments recorded yet. Tap Edit to add a crop record.
        </p>
      ) : (
        <div className="record-list">
          {rows
            .slice()
            .reverse()
            .map((row) => (
              <div key={row.id}>
                <strong>
                  {row.crop_year} · {cropName(data, row.commodity_id)} · #
                  {row.planting_sequence}
                </strong>
                <span className="numeric">
                  {formatAcres(row.planted_acres)}
                </span>
                <span className="numeric">
                  {row.harvested_bushels === null
                    ? "Yield not entered"
                    : `${number.format(row.harvested_bushels)} bu · ${number.format(row.harvested_bushels / row.planted_acres)} bu/ac`}
                </span>
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}

export function FieldFormPage() {
  const { data, refresh } = useFieldsData();
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = data?.fields.find((field) => field.id === id);
  const [name, setName] = useState("");
  const [acres, setAcres] = useState("");
  const [county, setCounty] = useState("");
  const [error, setError] = useState("");
  const submitLock = useRef(createSubmitLock());
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setAcres(String(existing.total_acres));
      setCounty(existing.county ?? "");
    }
  }, [existing]);
  if (!data) return <LoadingState />;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = Number(acres);
    if (!name.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a field name and acres above zero.");
      return;
    }
    if (!submitLock.current.acquire()) return;
    try {
      const entity = existing
        ? data.entities.find((item) => item.id === existing.operating_entity_id)
        : data.entities.find((item) => item.is_active);
      const arrangement =
        existing && currentArrangement(data.arrangements, existing.id);
      if (!entity) {
        setError("No active operating entity is available.");
        return;
      }
      const base: Field = existing ?? {
      id: "",
      farm_id: data.farm.id,
      operating_entity_id: entity.id,
      name: name.trim(),
      total_acres: parsed,
      county: null,
      state: null,
      legal_description: null,
      fsa_farm_number: null,
      fsa_tract_number: null,
      soil_productivity_index: null,
      latitude: null,
      longitude: null,
      location_source: null,
      is_active: true,
      created_at: "",
      updated_at: "",
    };
      const agreement: Arrangement = arrangement ?? {
      id: "",
      farm_id: data.farm.id,
      field_id: "",
      arrangement_type: "owned",
      landlord_name: null,
      landlord_phone: null,
      landlord_contact_notes: null,
      effective_from: today(),
      effective_to: null,
      cash_rent_per_acre: null,
      flex_bonus_formula: null,
      landlord_crop_pct: null,
      ...zeroShares(),
      notes: null,
      created_at: "",
      updated_at: "",
    };
      const saved = await fieldsRepository.saveField(
        toDraft(
          {
            ...base,
            name: name.trim(),
            total_acres: parsed,
            county: county.trim() || null,
          },
          agreement,
          existing ? cropRows(data, existing.id, moduleYear) : [],
        ),
      );
      try {
        await refresh();
        navigate(`/fields/${saved.id}`);
      } catch {
        navigate(`/fields/${saved.id}`, {
          state: {
            fieldsNotice:
              "Saved. Couldn't refresh the page — pull to reload.",
          },
        });
      }
    } catch (reason) {
      setError(farmerError(reason, "save this field"));
    } finally {
      submitLock.current.release();
    }
  };
  return (
    <section className="page form-page">
      <div className="detail-topline">
        <Link
          className="back-link"
          to={existing ? `/fields/${existing.id}` : "/fields"}
        >
          ← Cancel
        </Link>
      </div>
      <div className="page-heading compact-heading">
        <div>
          <h1>{existing ? "Edit field basics" : "Add a field"}</h1>
          <p>
            Add crop, agreement, yield, and contact details from the field page.
          </p>
        </div>
      </div>
      <form className="field-form" onSubmit={submit}>
        <fieldset>
          <legend>Field basics</legend>
          <div className="form-grid">
            <FormControl label="Field name">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormControl>
            <FormControl label="Total acres">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={acres}
                onChange={(event) => setAcres(event.target.value)}
              />
            </FormControl>
            <FormControl label="County / location">
              <input
                value={county}
                onChange={(event) => setCounty(event.target.value)}
              />
            </FormControl>
          </div>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-action form-submit" type="submit">
          Save field
        </button>
      </form>
    </section>
  );
}

function InfoGrid({ children }: { children: ReactNode }) {
  return <dl className="info-grid">{children}</dl>;
}
function Info({
  label,
  value,
  numeric,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={numeric ? "numeric" : undefined}>{value}</dd>
    </div>
  );
}
function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value numeric">
        {value}
        {unit && <span className="stat-unit"> {unit}</span>}
      </strong>
    </div>
  );
}
function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="filter-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}
function SortHeader({
  label,
  active,
  ascending,
  onClick,
  align,
}: {
  label: string;
  active?: boolean;
  ascending?: boolean;
  onClick?: () => void;
  align?: "right";
}) {
  return (
    <th className={align === "right" ? "align-right" : undefined} scope="col">
      <button
        className={`sort-button${active ? " active" : ""}`}
        onClick={onClick}
        type="button"
      >
        {label}
        {active ? (ascending ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}
function FormControl({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="form-control">
      <span>{label}</span>
      {children}
    </label>
  );
}
function LoadingState({ message }: { message?: string }) {
  return (
    <section className="page">
      <div className="loading-state">{message || "Loading fields…"}</div>
    </section>
  );
}
function NotFoundState() {
  return (
    <section className="page">
      <div className="empty-state">
        <h1>Field not found</h1>
        <p>That field may have been removed from this device.</p>
        <Link className="primary-action" to="/fields">
          Back to fields
        </Link>
      </div>
    </section>
  );
}
