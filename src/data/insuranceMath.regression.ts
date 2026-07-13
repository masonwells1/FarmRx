import { hasCompleteRevenueProtection, revenueProtectionMath, validateRevenueProtectionInputs } from './insuranceMath'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const cornRp = { rp_coverage_pct: 80, rp_aph_yield: 180, rp_projected_price: 4.62, rp_premium_per_acre: null }
const worked = revenueProtectionMath(cornRp, 750, 100)
assert(worked !== null, 'Complete RP inputs should produce insurance math.')
assert(worked.bushelGuaranteePerAcre === 144, `Expected 144 guaranteed bu/ac, got ${worked.bushelGuaranteePerAcre}.`)
assert(worked.minimumRevenueGuaranteePerAcre === 665.28, `Expected $665.28/ac, got ${worked.minimumRevenueGuaranteePerAcre}.`)
assert(worked.incomeGuarantee === 66_528, `Expected $66,528 income guarantee, got ${worked.incomeGuarantee}.`)
assert(Math.abs(worked.dollarsAtRiskPerAcre - 84.72) < .000001, `Expected $84.72/ac at risk, got ${worked.dollarsAtRiskPerAcre}.`)
assert(Math.abs((worked.investmentAtRiskPct ?? 0) - 11.296) < .000001, `Expected 11.296% at risk, got ${worked.investmentAtRiskPct}.`)
assert(worked.guaranteedBushels === 14_400 && worked.safeToForwardBushels === 14_400, 'Guaranteed bushels should be the entered-coverage result.')

assert(validateRevenueProtectionInputs({ ...cornRp, rp_coverage_pct: 50 }).length === 0, '50% coverage must be valid.')
assert(validateRevenueProtectionInputs({ ...cornRp, rp_coverage_pct: 95 }).length === 0, '95% coverage must be valid.')
assert(validateRevenueProtectionInputs({ ...cornRp, rp_coverage_pct: 49 }).length === 1, '49% coverage must be rejected.')
assert(validateRevenueProtectionInputs({ ...cornRp, rp_coverage_pct: 96 }).length === 1, '96% coverage must be rejected.')

const blank = { rp_coverage_pct: null, rp_aph_yield: null, rp_projected_price: null, rp_premium_per_acre: null }
assert(!hasCompleteRevenueProtection(blank), 'Blank insurance fields must not be treated as a defaulted policy.')
assert(revenueProtectionMath(blank, 750, 100) === null, 'Blank insurance fields must not invent RMA defaults in math.')
const contractedCase = revenueProtectionMath(cornRp, 750, 100, 12_000)
assert(contractedCase?.safeToForwardBushels === 14_400, 'Production must not cap the entered coverage arithmetic.')
assert(Math.max(0, (contractedCase?.safeToForwardBushels ?? 0) - 2_000) === 12_400, '14,400 guaranteed bu minus 2,000 contracted bu must leave 12,400 bu.')

console.log('insuranceMath regressions passed.')
