import type { GrainCarryGrid, GrainCarryGridRow, GrainCarrySettings, GrainSaleLimit } from './grain'

/** The carry grid always holds the harvest month plus twelve stored months. */
export const CARRY_GRID_ROWS = 13
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function defaultCarrySettings(farmId: string, updatedAt: string): GrainCarrySettings {
  return { farm_id: farmId, mode: 'monthly', monthly_rate_cents_per_bu_month: 4, flat_rate_per_bu: 0.18, interest_rate_pct: 7, trucking_per_bu: 0.12, updated_at: updatedAt }
}
export function emptyCarryRows(): GrainCarryGridRow[] { return Array.from({ length: CARRY_GRID_ROWS }, () => ({ market_price: null, basis: 0 })) }

export function validateGrainSaleLimit(value: GrainSaleLimit): string[] {
  const errors: string[] = []
  if (!Number.isInteger(value.crop_year) || value.crop_year < 1900 || value.crop_year > 2200) errors.push('Crop year must be between 1900 and 2200.')
  if (typeof value.commodity_id !== 'string' || !value.commodity_id.trim()) errors.push('Choose a commodity.')
  if (value.enterprise_label !== null && (typeof value.enterprise_label !== 'string' || !value.enterprise_label.trim() || value.enterprise_label.length > 160)) errors.push('Enterprise label must be 1 to 160 characters.')
  if (value.sale_limit_bushels !== null && (!finite(value.sale_limit_bushels) || value.sale_limit_bushels < 0)) errors.push('Sale limit must be zero or more bushels.')
  return errors
}

export function validateGrainCarrySettings(value: GrainCarrySettings): string[] {
  const errors: string[] = []
  if (value.mode !== 'monthly' && value.mode !== 'flat') errors.push('Choose monthly or flat storage.')
  for (const key of ['monthly_rate_cents_per_bu_month', 'flat_rate_per_bu', 'interest_rate_pct', 'trucking_per_bu'] as const) if (!finite(value[key]) || value[key] < 0) errors.push('Storage costs and rates cannot be negative.')
  if (finite(value.interest_rate_pct) && value.interest_rate_pct > 100) errors.push('Interest rate must be 100% or less.')
  return errors
}

export function validateGrainCarryGrid(value: GrainCarryGrid): string[] {
  const errors: string[] = []
  if (!Number.isInteger(value.harvest_month) || value.harvest_month < 0 || value.harvest_month > 11) errors.push('Choose a harvest month.')
  if (!finite(value.default_basis)) errors.push('Default basis must be a number.')
  if (!Array.isArray(value.rows) || value.rows.length !== CARRY_GRID_ROWS) errors.push(`The carry grid needs ${CARRY_GRID_ROWS} rows.`)
  else if (value.rows.some((row) => !row || typeof row !== 'object' || (row.market_price !== null && !finite(row.market_price)) || (row.basis !== null && !finite(row.basis)))) errors.push('Each price and basis must be a number or blank.')
  return errors
}
