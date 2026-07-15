export type EntityType = 'individual' | 'sole_proprietorship' | 'partnership' | 'llc' | 'corporation' | 'trust'
export type LandArrangementType = 'owned' | 'cash_rent' | 'flex_cash_rent' | 'crop_share'

export interface Farm {
  id: string
  name: string
  share_with_rep: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface Entity {
  id: string
  farm_id: string
  name: string
  entity_type: EntityType
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Field {
  id: string
  farm_id: string
  operating_entity_id: string
  name: string
  legal_description: string | null
  county: string | null
  state: string | null
  total_acres: number
  fsa_farm_number: string | null
  fsa_tract_number: string | null
  soil_productivity_index: number | null
  latitude: number | null
  longitude: number | null
  location_source: 'gps' | 'manual' | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CropAssignment {
  id: string
  farm_id: string
  field_id: string
  crop_year: number
  commodity_id: string
  planting_sequence: number
  planted_acres: number
  variety: string | null
  planting_date: string | null
  harvest_date: string | null
  /** Local Module 1 harvest-entry value; the database harvest table will own this in production. */
  harvested_bushels: number | null
  expected_yield_per_acre: number | null
  expected_price_per_bu: number | null
  /** Realized harvest price. Harvest entry owns this; it never replaces expected price. */
  actual_price_per_bu: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type FlexBonusType = 'price' | 'yield' | 'revenue'

/**
 * Legacy per-unit flex shape (Module 1). Still readable and still computes exactly as it does
 * today (docs/flex-lease-research.md §3) — the arrangement editor no longer offers it for new
 * or edited leases because it matches no published University of Illinois lease structure.
 */
export interface LegacyFlexBonusFormula {
  type: FlexBonusType
  trigger: number
  bonus_rate: number
}

/**
 * v1 supported methods (docs/flex-lease-research.md §4, U of I farmdoc Types A and D).
 * `base_flex_price` / `base_flex_price_yield` are reserved field names for the lease-form
 * Option I / Option II structures (§1 Types B/C) — parked for later, not computed in v1.
 */
export type FlexMethod = 'base_plus_bonus' | 'pct_of_revenue' | 'base_flex_price' | 'base_flex_price_yield'
/** The subset of FlexMethod the v1 calculator and arrangement editor actually implement. */
export type SupportedFlexMethod = 'base_plus_bonus' | 'pct_of_revenue'

/**
 * Recommended single JSON schema (docs/flex-lease-research.md §3): one shape covers every U of
 * I structure. Store only the fields a given method uses; leave the rest null (never absent),
 * matching the schema's own example.
 */
export interface StructuredFlexBonusFormula {
  method: FlexMethod
  /** required for base_plus_bonus / base_flex_*; null for pct_of_revenue */
  base_rent_per_acre: number | null
  /** base_plus_bonus: landlord % of revenue above trigger. pct_of_revenue: % of gross revenue. null for base_flex_* */
  rate_pct: number | null
  /** base_plus_bonus only, else null */
  trigger_revenue_per_acre: number | null
  /** base_flex_price / base_flex_price_yield only, else null */
  base_price_per_bu: number | null
  /** base_flex_price_yield only, else null */
  base_yield_per_acre: number | null
  /** optional floor; for base_plus_bonus the base IS the floor — leave null */
  min_rent_per_acre?: number | null
  /** optional cap */
  max_rent_per_acre?: number | null
  /** free text, display-only */
  price_source_note?: string | null
}

export type FlexBonusFormula = LegacyFlexBonusFormula | StructuredFlexBonusFormula
/** Discriminates the two saved shapes without a runtime dependency cycle. */
export function isLegacyFlexBonusFormula(formula: FlexBonusFormula): formula is LegacyFlexBonusFormula { return 'type' in formula }

export interface Arrangement {
  id: string
  farm_id: string
  field_id: string
  arrangement_type: LandArrangementType
  landlord_name: string | null
  landlord_phone: string | null
  landlord_contact_notes: string | null
  effective_from: string
  effective_to: string | null
  cash_rent_per_acre: number | null
  flex_bonus_formula: FlexBonusFormula | null
  landlord_crop_pct: number | null
  landlord_seed_pct: number
  landlord_fertilizer_pct: number
  landlord_chemical_pct: number
  landlord_fuel_pct: number
  landlord_labor_custom_pct: number
  landlord_crop_insurance_pct: number
  landlord_equipment_pct: number
  landlord_interest_pct: number
  landlord_other_input_pct: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Commodity {
  id: string
  name: string
  crop_family: 'corn' | 'soybeans' | 'wheat'
  traits: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface FieldsData {
  farm: Farm
  entities: Entity[]
  fields: Field[]
  crop_assignments: CropAssignment[]
  arrangements: Arrangement[]
  commodities: Commodity[]
}

export interface FieldDraft {
  id?: string
  expected_versions?: {
    field_updated_at: string
    arrangement: { id: string; updated_at: string }
    crop_assignments: Array<{ id: string; updated_at: string }>
  } | null
  name: string
  operating_entity_id: string
  total_acres: number
  county: string | null
  state: string | null
  legal_description: string | null
  fsa_farm_number: string | null
  fsa_tract_number: string | null
  soil_productivity_index: number | null
  arrangement: Pick<Arrangement, 'arrangement_type' | 'landlord_name' | 'landlord_phone' | 'landlord_contact_notes' | 'effective_from' | 'cash_rent_per_acre' | 'flex_bonus_formula' | 'landlord_crop_pct' | 'landlord_seed_pct' | 'landlord_fertilizer_pct' | 'landlord_chemical_pct' | 'landlord_fuel_pct' | 'landlord_labor_custom_pct' | 'landlord_crop_insurance_pct' | 'landlord_equipment_pct' | 'landlord_interest_pct' | 'landlord_other_input_pct' | 'notes'>
  crop_assignments: Array<Omit<Pick<CropAssignment, 'id' | 'crop_year' | 'commodity_id' | 'planted_acres' | 'planting_sequence' | 'variety' | 'planting_date' | 'harvest_date' | 'harvested_bushels' | 'expected_yield_per_acre' | 'expected_price_per_bu' | 'notes'>, 'id'> & { id?: string; /** Required by the RPC after normalization. */ is_new?: boolean }>
}

export interface FieldsRepository {
  getData(): Promise<FieldsData>
  saveField(draft: FieldDraft): Promise<Field>
}
