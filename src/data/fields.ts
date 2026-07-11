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
  notes: string | null
  created_at: string
  updated_at: string
}

export type FlexBonusType = 'price' | 'yield' | 'revenue'

export interface FlexBonusFormula {
  type: FlexBonusType
  trigger: number
  bonus_rate: number
}

export interface Arrangement {
  id: string
  farm_id: string
  field_id: string
  arrangement_type: LandArrangementType
  landlord_name: string | null
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
  name: string
  operating_entity_id: string
  total_acres: number
  county: string | null
  state: string | null
  legal_description: string | null
  fsa_farm_number: string | null
  fsa_tract_number: string | null
  soil_productivity_index: number | null
  arrangement: Pick<Arrangement, 'arrangement_type' | 'landlord_name' | 'effective_from' | 'cash_rent_per_acre' | 'flex_bonus_formula' | 'landlord_crop_pct' | 'landlord_seed_pct' | 'landlord_fertilizer_pct' | 'landlord_chemical_pct' | 'landlord_fuel_pct' | 'landlord_labor_custom_pct' | 'landlord_crop_insurance_pct' | 'landlord_equipment_pct' | 'landlord_interest_pct' | 'landlord_other_input_pct' | 'notes'>
  crop_assignments: Array<Pick<CropAssignment, 'crop_year' | 'commodity_id' | 'planted_acres' | 'planting_sequence' | 'variety' | 'planting_date' | 'harvest_date' | 'harvested_bushels' | 'notes'>>
}

export interface FieldsRepository {
  getData(): Promise<FieldsData>
  saveField(draft: FieldDraft): Promise<Field>
}
