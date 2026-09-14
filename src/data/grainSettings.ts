import type { GrainCarryGrid, GrainCarryGridRow, GrainCarrySettings, GrainSaleLimit, PositionScope } from './grain'
import { boundedDecimal, nullableBoundedDecimal } from './decimal'

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

// The rows as the database will store them (numeric scale 2 for bushels, 4 for rates and prices, PostgreSQL rounding). Every
// repository saves and returns this shape, so a row kept as "last sent" by a screen equals the row the server (or a later queue
// replay) produces, and the screen can recognise its own write coming back. A value too large for its column throws here, before
// it is queued.
export function normalizeGrainSaleLimit(value: GrainSaleLimit): GrainSaleLimit {
  return { ...value, sale_limit_bushels: nullableBoundedDecimal(value.sale_limit_bushels, { precision: 16, scale: 2, label: 'the sale limit' }) }
}
export function normalizeGrainCarrySettings(value: GrainCarrySettings): GrainCarrySettings {
  const rate = (amount: number, label: string) => boundedDecimal(amount, { precision: 10, scale: 4, label })
  return { ...value, monthly_rate_cents_per_bu_month: rate(value.monthly_rate_cents_per_bu_month, 'the monthly storage rate'), flat_rate_per_bu: rate(value.flat_rate_per_bu, 'the flat storage rate'), interest_rate_pct: boundedDecimal(value.interest_rate_pct, { precision: 8, scale: 4, label: 'the interest rate' }), trucking_per_bu: rate(value.trucking_per_bu, 'the trucking rate') }
}
export function normalizeGrainCarryGrid(value: GrainCarryGrid): GrainCarryGrid {
  const price = (amount: number | null, label: string) => nullableBoundedDecimal(amount, { precision: 10, scale: 4, label })
  return { ...value, default_basis: boundedDecimal(value.default_basis, { precision: 10, scale: 4, label: 'the default basis' }), rows: value.rows.map(({ market_price, basis }) => ({ market_price: price(market_price, 'a market price'), basis: price(basis, 'a basis') })) }
}

// The first save of a sale limit or a carry grid is an insert whose id the browser chooses. Two tabs (or two visits) that both saw
// no row yet would each choose a random id, and the second insert would then break the table's natural key (one sale limit per
// position scope, one grid per production estimate) forever: a queued replay or a retry identifies the row by id, so it could never
// resolve. The id is therefore derived from the row's logical key, the same in every tab, so the second write is an update of the
// same row (the queue rebases it onto the first write's version) instead of a duplicate insert. Version 5 shape from SHA-256.
async function stableGrainRowId(kind: 'sale-limit' | 'carry-grid', parts: ReadonlyArray<string | number | null>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`farm-rx:${kind}:${JSON.stringify(parts)}`))).slice(0, 16)
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50; digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
/** The id of the sale limit row for a position scope, the same in every tab of every browser. */
export function stableGrainSaleLimitId(scope: PositionScope): Promise<string> { return stableGrainRowId('sale-limit', [scope.farm_id, scope.crop_year, scope.commodity_id, scope.operating_entity_id, scope.enterprise_label]) }
/** The id of the carry grid row for a production estimate, the same in every tab of every browser. */
export function stableGrainCarryGridId(farmId: string, productionEstimateId: string): Promise<string> { return stableGrainRowId('carry-grid', [farmId, productionEstimateId]) }
