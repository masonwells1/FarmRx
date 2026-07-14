/** Revenue Protection math only. It reports the numbers entered; it does not recommend coverage or sales. */
export interface RevenueProtectionInputs {
  rp_coverage_pct: number | null
  rp_aph_yield: number | null
  rp_projected_price: number | null
  rp_premium_per_acre: number | null
}

export interface RevenueProtectionMath {
  bushelGuaranteePerAcre: number
  minimumRevenueGuaranteePerAcre: number
  incomeGuarantee: number | null
  dollarsAtRiskPerAcre: number
  investmentAtRiskPct: number | null
  costsFullyCovered: boolean
  guaranteedBushels: number | null
  insuranceBackedMarketingEstimateBushels: number | null
}

export function validateRevenueProtectionInputs(value: RevenueProtectionInputs): string[] {
  const errors: string[] = []
  if (value.rp_coverage_pct !== null && (!Number.isFinite(value.rp_coverage_pct) || value.rp_coverage_pct < 50 || value.rp_coverage_pct > 85 || value.rp_coverage_pct % 5 !== 0)) errors.push('Individual Revenue Protection coverage must be 50% to 85% in 5% steps. Coverage above 85% is a county SCO/ECO product Farm Rx does not model yet.')
  if (value.rp_aph_yield !== null && (!Number.isFinite(value.rp_aph_yield) || value.rp_aph_yield <= 0)) errors.push('APH yield must be greater than 0 bu/ac.')
  if (value.rp_projected_price !== null && (!Number.isFinite(value.rp_projected_price) || value.rp_projected_price <= 0)) errors.push('Projected price must be greater than $0.00/bu.')
  if (value.rp_premium_per_acre !== null && (!Number.isFinite(value.rp_premium_per_acre) || value.rp_premium_per_acre < 0)) errors.push('Premium must be $0.00/ac or more.')
  return errors
}

export function hasCompleteRevenueProtection(value: RevenueProtectionInputs): value is RevenueProtectionInputs & { rp_coverage_pct: number; rp_aph_yield: number; rp_projected_price: number } {
  return value.rp_coverage_pct !== null && value.rp_aph_yield !== null && value.rp_projected_price !== null && validateRevenueProtectionInputs(value).length === 0
}

/** `productionBushels` is retained for callers that display an actual-production comparison.
 * It never caps the entered coverage arithmetic: the revenue-floor calculation is separate. */
export function revenueProtectionMath(value: RevenueProtectionInputs, totalCostPerAcre: number, allocatedAcres: number | null, _productionBushels: number | null = null): RevenueProtectionMath | null {
  if (!hasCompleteRevenueProtection(value) || !Number.isFinite(totalCostPerAcre) || totalCostPerAcre < 0) return null
  const bushelGuaranteePerAcre = value.rp_aph_yield * value.rp_coverage_pct / 100
  const minimumRevenueGuaranteePerAcre = bushelGuaranteePerAcre * value.rp_projected_price
  const hasAcres = allocatedAcres !== null && Number.isFinite(allocatedAcres) && allocatedAcres > 0
  const guaranteedBushels = hasAcres ? bushelGuaranteePerAcre * allocatedAcres : null
  const costsFullyCovered = minimumRevenueGuaranteePerAcre >= totalCostPerAcre
  const dollarsAtRiskPerAcre = Math.max(0, totalCostPerAcre - minimumRevenueGuaranteePerAcre)
  return { bushelGuaranteePerAcre, minimumRevenueGuaranteePerAcre, incomeGuarantee: hasAcres ? minimumRevenueGuaranteePerAcre * allocatedAcres! : null, dollarsAtRiskPerAcre, investmentAtRiskPct: costsFullyCovered || totalCostPerAcre === 0 ? null : dollarsAtRiskPerAcre / totalCostPerAcre * 100, costsFullyCovered, guaranteedBushels, insuranceBackedMarketingEstimateBushels: guaranteedBushels }
}
