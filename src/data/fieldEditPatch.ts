import type {
  Arrangement,
  CropAssignment,
  Field,
  FieldDraft,
  FieldsData,
} from "./fields";

type EditableFieldValues = Pick<
  Field,
  | "name"
  | "operating_entity_id"
  | "total_acres"
  | "county"
  | "state"
  | "legal_description"
  | "fsa_farm_number"
  | "fsa_tract_number"
  | "soil_productivity_index"
>;
type EditableCropValues = Pick<
  CropAssignment,
  | "crop_year"
  | "commodity_id"
  | "planted_acres"
  | "planting_sequence"
  | "variety"
  | "planting_date"
  | "harvest_date"
  | "harvested_bushels"
  | "expected_yield_per_acre"
  | "expected_price_per_bu"
  | "notes"
>;

const agreementTermKeys = [
  "arrangement_type",
  "landlord_name",
  "landlord_phone",
  "landlord_contact_notes",
  "cash_rent_per_acre",
  "flex_bonus_formula",
  "landlord_crop_pct",
  "landlord_seed_pct",
  "landlord_fertilizer_pct",
  "landlord_chemical_pct",
  "landlord_fuel_pct",
  "landlord_labor_custom_pct",
  "landlord_crop_insurance_pct",
  "landlord_equipment_pct",
  "landlord_interest_pct",
  "landlord_other_input_pct",
  "notes",
] as const;

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function sameAgreementTerm(
  key: (typeof agreementTermKeys)[number],
  left: Arrangement,
  right: Arrangement,
) {
  return key === "flex_bonus_formula"
    ? JSON.stringify(canonicalJson(left[key])) ===
        JSON.stringify(canonicalJson(right[key]))
    : left[key] === right[key];
}

/** A card's intent, deliberately limited to the values that card can display. */
export interface FieldEditPatch {
  field?: Partial<EditableFieldValues>;
  arrangement?: Partial<Omit<FieldDraft["arrangement"], "id">>;
  cropAssignmentChanges?: Array<
    Pick<CropAssignment, "id"> & Partial<EditableCropValues>
  >;
  newCropAssignments?: EditableCropValues[];
}

export type FieldDetailResolution =
  | { kind: "ready"; field: Field; arrangement: Arrangement }
  | { kind: "missing_field" }
  | { kind: "missing_arrangement"; field: Field };

export type FieldFormResolution =
  | { kind: "add" }
  | { kind: "edit"; field: Field }
  | { kind: "missing_field" };

export function resolveFieldForm(
  data: FieldsData,
  fieldId: string | undefined,
): FieldFormResolution {
  if (fieldId === undefined) return { kind: "add" };
  const field = data.fields.find((item) => item.id === fieldId);
  return field ? { kind: "edit", field } : { kind: "missing_field" };
}

export function resolveFieldDetail(
  data: FieldsData,
  fieldId: string | undefined,
): FieldDetailResolution {
  const field = data.fields.find((item) => item.id === fieldId);
  if (!field) return { kind: "missing_field" };
  const arrangement = data.arrangements.find(
    (item) => item.field_id === field.id && item.effective_to === null,
  );
  return arrangement
    ? { kind: "ready", field, arrangement }
    : { kind: "missing_arrangement", field };
}

/**
 * Existing-field saves must preserve a real current agreement. Returning null
 * is reserved for the Add Field flow, whose explicit product default is owned.
 */
export function currentArrangementForFieldEdit(
  data: FieldsData,
  resolution: Extract<FieldFormResolution, { kind: "add" | "edit" }>,
): Arrangement | null {
  if (resolution.kind === "add") return null;
  const detail = resolveFieldDetail(data, resolution.field.id);
  if (detail.kind === "missing_field") throw new Error("The field no longer exists.");
  if (detail.kind === "missing_arrangement") {
    throw new Error("The field no longer has a current agreement.");
  }
  return detail.arrangement;
}

function assignmentDraft(row: CropAssignment): FieldDraft["crop_assignments"][number] {
  return {
    id: row.id,
    crop_year: row.crop_year,
    commodity_id: row.commodity_id,
    planted_acres: row.planted_acres,
    planting_sequence: row.planting_sequence,
    variety: row.variety,
    planting_date: row.planting_date,
    harvest_date: row.harvest_date,
    harvested_bushels: row.harvested_bushels,
    expected_yield_per_acre: row.expected_yield_per_acre,
    expected_price_per_bu: row.expected_price_per_bu,
    notes: row.notes,
  };
}

/**
 * Rebuilds the RPC's required complete bundle from the latest canonical field.
 * A card can therefore never send sibling values captured when it opened.
 */
export function createFieldEditDraft(
  data: FieldsData,
  fieldId: string,
  patch: FieldEditPatch,
): FieldDraft {
  const detail = resolveFieldDetail(data, fieldId);
  if (detail.kind === "missing_field") throw new Error("The field no longer exists.");
  if (detail.kind === "missing_arrangement") throw new Error("The field no longer has a current agreement.");
  const { field, arrangement } = detail;
  const changedRows = new Map(
    (patch.cropAssignmentChanges ?? []).map((row) => [row.id, row]),
  );
  const allRows = data.crop_assignments.filter((row) => row.field_id === fieldId);
  const changedYears = new Set<number>();
  for (const row of allRows) {
    if (changedRows.has(row.id)) changedYears.add(row.crop_year);
  }
  for (const row of patch.newCropAssignments ?? []) changedYears.add(row.crop_year);
  const crop_assignments =
    changedYears.size === 0
      ? []
      : [
          ...allRows
            .filter((row) => changedYears.has(row.crop_year))
            .map((row) => assignmentDraft({ ...row, ...changedRows.get(row.id) })),
          ...(patch.newCropAssignments ?? []).map((row) => ({ ...row, is_new: true })),
        ];
  const nextField = { ...field, ...patch.field };
  const nextArrangement = { ...arrangement, ...patch.arrangement };
  const startsNewAgreementVersion =
    nextArrangement.effective_from > arrangement.effective_from &&
    agreementTermKeys.some(
      (key) => !sameAgreementTerm(key, nextArrangement, arrangement),
    );
  return {
    id: field.id,
    expected_versions: {
      field_updated_at: field.updated_at,
      arrangement: { id: arrangement.id, updated_at: arrangement.updated_at },
      crop_assignments: allRows.map((row) => ({
        id: row.id,
        updated_at: row.updated_at,
        crop_year: row.crop_year,
      })),
    },
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
      ...(startsNewAgreementVersion ? {} : { id: nextArrangement.id }),
      arrangement_type: nextArrangement.arrangement_type,
      landlord_name: nextArrangement.landlord_name,
      landlord_phone: nextArrangement.landlord_phone,
      landlord_contact_notes: nextArrangement.landlord_contact_notes,
      effective_from: nextArrangement.effective_from,
      cash_rent_per_acre: nextArrangement.cash_rent_per_acre,
      flex_bonus_formula: nextArrangement.flex_bonus_formula,
      landlord_crop_pct: nextArrangement.landlord_crop_pct,
      landlord_seed_pct: nextArrangement.landlord_seed_pct,
      landlord_fertilizer_pct: nextArrangement.landlord_fertilizer_pct,
      landlord_chemical_pct: nextArrangement.landlord_chemical_pct,
      landlord_fuel_pct: nextArrangement.landlord_fuel_pct,
      landlord_labor_custom_pct: nextArrangement.landlord_labor_custom_pct,
      landlord_crop_insurance_pct: nextArrangement.landlord_crop_insurance_pct,
      landlord_equipment_pct: nextArrangement.landlord_equipment_pct,
      landlord_interest_pct: nextArrangement.landlord_interest_pct,
      landlord_other_input_pct: nextArrangement.landlord_other_input_pct,
      notes: nextArrangement.notes,
    },
    crop_assignments,
  };
}
