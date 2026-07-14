import type { FieldsData } from './fields'

export type FarmViewerRole = 'owner' | 'manager' | 'worker' | 'read_only'

/** This shape is deliberately exact: it is the complete save_crop_harvest RPC contract. */
export interface HarvestDraft {
  crop_assignment_id: string
  harvested_bushels: number | null
  harvest_date: string | null
  actual_price_per_bu: number | null
}

export interface HarvestRecord extends HarvestDraft {
  id: string
  farm_id: string
  pending?: boolean
}

export interface HarvestData {
  fieldsData: FieldsData
  viewer: { user_id: string; role: FarmViewerRole }
}

export interface HarvestRepository {
  getData(): Promise<HarvestData>
  saveHarvest(draft: HarvestDraft): Promise<HarvestRecord>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isoDate = /^\d{4}-\d{2}-\d{2}$/
const exactKeys = ['crop_assignment_id', 'harvested_bushels', 'harvest_date', 'actual_price_per_bu'] as const

/** Audit P2-08: a harvest is a record of work already done — never a far-future date.
 * One day of tolerance covers device-clock skew, matching the Field Log rule. */
export function harvestMaximumDate(now = new Date()) {
  const maximum = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return `${maximum.getFullYear()}-${String(maximum.getMonth() + 1).padStart(2, '0')}-${String(maximum.getDate()).padStart(2, '0')}`
}
export const HARVEST_FUTURE_DATE_MESSAGE = 'The harvest date cannot be more than one day in the future.'

export function validateHarvestDraft(draft: HarvestDraft | Record<string, unknown>, now = new Date()): string | null {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || Object.keys(draft).length !== exactKeys.length || !exactKeys.every((key) => Object.hasOwn(draft, key))) return 'This harvest entry is incomplete. Please reopen the form and try again.'
  const row = draft as HarvestDraft
  if (!uuid.test(row.crop_assignment_id)) return 'This crop record is invalid. Please reopen the form and try again.'
  if (row.harvested_bushels !== null && (!Number.isFinite(row.harvested_bushels) || row.harvested_bushels < 0)) return 'Harvested bushels must be zero or greater.'
  if (row.actual_price_per_bu !== null && (!Number.isFinite(row.actual_price_per_bu) || row.actual_price_per_bu < 0)) return 'Actual price per bushel must be zero or greater.'
  if (row.harvest_date !== null && (!isoDate.test(row.harvest_date) || Number.isNaN(Date.parse(`${row.harvest_date}T00:00:00Z`)) || new Date(`${row.harvest_date}T00:00:00Z`).toISOString().slice(0, 10) !== row.harvest_date)) return 'Enter a valid harvest date.'
  if (row.harvest_date !== null && row.harvest_date > harvestMaximumDate(now)) return HARVEST_FUTURE_DATE_MESSAGE
  return null
}

export function canEditHarvest(role: FarmViewerRole) { return role === 'owner' || role === 'manager' || role === 'worker' }

export function yieldPerAcre(harvestedBushels: number | null, plantedAcres: number) { return harvestedBushels === null || !Number.isFinite(plantedAcres) || plantedAcres <= 0 ? null : harvestedBushels / plantedAcres }
export function yieldDelta(actualYield: number | null, expectedYield: number | null) { return actualYield === null || expectedYield === null ? null : actualYield - expectedYield }
export function harvestRevenue(harvestedBushels: number | null, actualPrice: number | null, expectedPrice: number | null) { const price = actualPrice ?? expectedPrice; return harvestedBushels === null || price === null ? null : { value: harvestedBushels * price, priceSource: actualPrice === null ? 'expected' as const : 'actual' as const } }
