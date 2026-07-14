import { scopeKey, scopeOf, type GrainContract, type InsuranceUnit, type PositionScope } from './grain'

/** Keep Grain's saved-data block in the same plain English as Profitability. */
export const unsupportedCoverageMessage = "Coverage above 85% is a county SCO/ECO product Farm Rx doesn't model yet — set 50–85% individual coverage."
export type SaleLimits = Record<string, number | null | undefined>

/** The UI's one scope-keyed lookup for temporary, per-crop sale limits. */
export function saleLimitForScope(saleLimits: SaleLimits, record: PositionScope): number | null {
  return saleLimits[scopeKey(scopeOf(record))] ?? null
}

export function isIndividualRevenueProtectionCoverage(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= 50 && value <= 85 && value % 5 === 0)
}

export function hasUnsupportedSavedCoverage(insuranceUnits: InsuranceUnit[], budgetCoverage: Array<number | null>): boolean {
  return insuranceUnits.some((unit) => !isIndividualRevenueProtectionCoverage(unit.coverage_level_pct)) || budgetCoverage.some((coverage) => !isIndividualRevenueProtectionCoverage(coverage))
}

export function finalCashPrice(contract: GrainContract): number | null {
  const premium = contract.premium_cents_per_bu / 100
  if (contract.cash_price !== null) return contract.cash_price + premium
  if (contract.futures_price !== null && contract.basis !== null) return contract.futures_price + contract.basis + premium
  return null
}

/** Cash targets are all-in prices. Never add an inferred or contract premium here. */
export function calculateGrainPosition(production: number, contracts: GrainContract[], currentBasis: number, cashTarget: number | null) {
  const finalContracts = contracts.filter((contract) => finalCashPrice(contract) !== null)
  const basisOpen = contracts.filter((contract) => contract.contract_type === 'hta' && finalCashPrice(contract) === null)
  const futuresOpen = contracts.filter((contract) => contract.contract_type === 'basis' && finalCashPrice(contract) === null)
  const finalBushels = finalContracts.reduce((sum, contract) => sum + contract.bushels, 0)
  const partiallyPricedBushels = [...basisOpen, ...futuresOpen].reduce((sum, contract) => sum + contract.bushels, 0)
  const outrightOpen = Math.max(0, production - finalBushels - partiallyPricedBushels)
  const finalRevenue = finalContracts.reduce((sum, contract) => sum + contract.bushels * (finalCashPrice(contract) ?? 0), 0)
  const partialRevenue = basisOpen.reduce((sum, contract) => sum + contract.bushels * ((contract.futures_price ?? 0) + currentBasis + contract.premium_cents_per_bu / 100), 0) + (cashTarget === null ? 0 : futuresOpen.reduce((sum, contract) => sum + contract.bushels * cashTarget, 0))
  return { finalContracts, basisOpen, futuresOpen, finalBushels, partiallyPricedBushels, outrightOpen, finalRevenue, partialRevenue, plannedRevenue: cashTarget === null ? null : finalRevenue + partialRevenue + outrightOpen * cashTarget }
}

export function remainingMarketingCapacity(guaranteedBushels: number, contractedBushels: number, pendingOfferBushels: number) {
  return Math.max(0, guaranteedBushels - contractedBushels - pendingOfferBushels)
}

export function saleLimitWarning(saleLimit: number | null, contractedBushels: number, pendingBushelsBeforeProposal: number, proposedBushels: number, action: 'save' | 'record'): string | null {
  if (saleLimit === null || !Number.isFinite(proposedBushels) || contractedBushels + pendingBushelsBeforeProposal + proposedBushels <= saleLimit) return null
  return `This would put contracts and pending offers above your ${Math.round(saleLimit).toLocaleString('en-US')} bu sale limit. You can still ${action} it if that is intentional.`
}
