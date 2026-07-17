import type { SupportedFlexMethod } from './fields'

/**
 * Shared save-time validation for the structured flex-lease schema (docs/flex-lease-research.md
 * §3/§4), used by both the mock and live Fields repositories so a bad formula fails the same way
 * — and with the same farmer-facing message — no matter which backend is active. Returns a plain
 * error string, or null when the formula is valid. Never throws.
 */
export function structuredFlexFormulaError(value: Record<string, unknown>): string | null {
  const allowed = new Set(['method', 'base_rent_per_acre', 'rate_pct', 'trigger_revenue_per_acre', 'base_price_per_bu', 'base_yield_per_acre', 'min_rent_per_acre', 'max_rent_per_acre', 'price_source_note'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return 'Flex rent formula contains an unsupported setting.'
  const nonnegativeOrAbsent = (candidate: unknown) => candidate === undefined || candidate === null || (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0)
  const method = value.method
  if (method !== 'base_plus_bonus' && method !== 'pct_of_revenue') return 'Choose "Base rent + bonus above a revenue trigger" or "Percent of gross revenue" for this flex lease.'
  const supported = method as SupportedFlexMethod
  if (!nonnegativeOrAbsent(value.base_rent_per_acre)) return 'Base rent must be zero or greater when entered.'
  if (!nonnegativeOrAbsent(value.trigger_revenue_per_acre)) return 'Revenue trigger must be zero or greater when entered.'
  for (const key of ['base_price_per_bu', 'base_yield_per_acre', 'min_rent_per_acre', 'max_rent_per_acre'] as const) if (!nonnegativeOrAbsent(value[key])) return `${key === 'min_rent_per_acre' ? 'Minimum rent' : key === 'max_rent_per_acre' ? 'Maximum rent' : key === 'base_price_per_bu' ? 'Base price' : 'Base yield'} must be zero or greater when entered.`
  if (typeof value.min_rent_per_acre === 'number' && typeof value.max_rent_per_acre === 'number' && value.min_rent_per_acre > value.max_rent_per_acre) return 'Minimum rent cannot be greater than maximum rent.'
  if (value.price_source_note !== undefined && value.price_source_note !== null && typeof value.price_source_note !== 'string') return 'Price source note must be text when entered.'
  if (typeof value.price_source_note === 'string' && value.price_source_note.length > 500) return 'Price source note must be 500 characters or fewer.'
  if (supported === 'base_plus_bonus') {
    if (!(typeof value.base_rent_per_acre === 'number' && Number.isFinite(value.base_rent_per_acre) && value.base_rent_per_acre >= 0)) return 'Base rent must be zero or greater.'
    if (!(typeof value.rate_pct === 'number' && Number.isFinite(value.rate_pct) && value.rate_pct > 0 && value.rate_pct <= 100)) return 'Bonus rate must be greater than zero and no more than 100 percent.'
    if (!(typeof value.trigger_revenue_per_acre === 'number' && Number.isFinite(value.trigger_revenue_per_acre) && value.trigger_revenue_per_acre >= 0)) return 'Revenue trigger must be zero or greater.'
    if (typeof value.max_rent_per_acre === 'number' && value.max_rent_per_acre < value.base_rent_per_acre) return 'Maximum rent cannot be less than the base rent.'
    return null
  }
  if (!(typeof value.rate_pct === 'number' && Number.isFinite(value.rate_pct) && value.rate_pct > 0 && value.rate_pct <= 100)) return 'Percent of gross revenue must be greater than zero and no more than 100 percent.'
  if (value.base_rent_per_acre !== undefined && value.base_rent_per_acre !== null) return 'Base rent must be left blank for percent of gross revenue.'
  if (value.trigger_revenue_per_acre !== undefined && value.trigger_revenue_per_acre !== null) return 'Revenue trigger must be left blank for percent of gross revenue.'
  return null
}
