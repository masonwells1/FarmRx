import { isMarsBid } from './basisMath'
import { cashBidEligibleForCropYear, type CropFamily } from './marketingYear'
import { farmLocalCalendarDate } from './farmDates'
import { marketedPercent, sameScope, type CashBid, type GrainWorkspace, type MarketingAlertRule } from './grain'

export type MarketingAlertEvent = { ruleId: string; key: string; kind: 'marketing_price_target' | 'marketing_pct_marketed_goal' | 'marketing_deadline'; message: string }
export type MarketingAlertEvaluation = { alerts: MarketingAlertEvent[]; firedRuleIds: string[]; conditions: Array<{ ruleId: string; met: boolean }> }

/** The farmer's device calendar, not UTC, is the alert-day authority (canonical helper: farmDates.ts). */
export const localCalendarDay = (value: Date) => farmLocalCalendarDate(value)
const dateAtUtc = (value: string) => new Date(`${value}T00:00:00.000Z`)
const dayDifference = (left: string, right: string) => Math.round((dateAtUtc(left).getTime() - dateAtUtc(right).getTime()) / 86_400_000)
const money = (value: number) => `$${value.toFixed(2)}`
const bidDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const simpleEmail = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/
/** A marketing-plan target is a cash price target; basis is already included. */
export function cashTargetRevenue(openBushels: number, cashTarget: number, separatePremiumPerBushel = 0): number { return openBushels * (cashTarget + separatePremiumPerBushel) }
export function validateAlertEmails(emails: string[]): string[] { if (emails.length > 3) return ['Use no more than three email addresses.']; if (emails.some((email) => email !== email.trim() || !simpleEmail.test(email))) return ['Enter complete email addresses, with no extra spaces.']; return [] }
/** Mirrors marketing_alert_rules_fields_by_type exactly before any client write. */
export function validateMarketingAlertRule(value: MarketingAlertRule): string[] { const errors: string[] = []; if (!Number.isInteger(value.crop_year) || value.crop_year < 1900 || value.crop_year > 2200) errors.push('Choose a valid crop year.'); if (!value.commodity_id.trim()) errors.push('Choose a commodity.'); if (value.message !== null && (value.message.trim().length < 1 || value.message.trim().length > 1000)) errors.push('Note must be 1 to 1,000 characters when present.'); if (value.rule_type === 'price_target') { if (!['at_or_above', 'at_or_below'].includes(value.direction ?? '')) errors.push('Choose when the price should trigger.'); if (value.threshold === null || !Number.isFinite(value.threshold) || value.threshold <= 0 || value.threshold > 1000) errors.push('Price target must be above $0 and no more than $1,000.'); if (value.remind_on !== null) errors.push('A price target cannot have a reminder date.') } else if (value.rule_type === 'pct_marketed_goal') { if (value.direction !== null) errors.push('A marketed goal does not use a price direction.'); if (value.threshold === null || !Number.isFinite(value.threshold) || value.threshold <= 0 || value.threshold > 100) errors.push('Marketed goal must be above 0% and no more than 100%.'); if (value.remind_on !== null) errors.push('A marketed goal cannot have a reminder date.') } else if (value.rule_type === 'deadline') { if (value.direction !== null || value.threshold !== null || value.remind_on === null) errors.push('A deadline needs only a reminder date.') } else errors.push('Choose an alert type.'); return errors }

export function latestManualCashBid(workspace: GrainWorkspace, commodityId: string): CashBid | null {
  return workspace.cash_bids.filter((bid) => bid.commodity_id === commodityId && bid.cash_price !== null && !isMarsBid(bid)).sort((left, right) => right.bid_date.localeCompare(left.bid_date) || right.updated_at.localeCompare(left.updated_at))[0] ?? null
}
export const MARKETING_BID_MAX_AGE_DAYS = 2
export function freshManualCashBid(workspace: GrainWorkspace, commodityId: string, today: string, maxAgeDays = MARKETING_BID_MAX_AGE_DAYS): CashBid | null { const bid = latestManualCashBid(workspace, commodityId); return bid && dayDifference(today, bid.bid_date) >= 0 && dayDifference(today, bid.bid_date) <= maxAgeDays ? bid : null }
export function latestManualCashPrice(workspace: GrainWorkspace, commodityId: string): number | null { return latestManualCashBid(workspace, commodityId)?.cash_price ?? null }

/** GL-2: the alerting reader, as against the valuation readers above.
 *
 * The split is deliberate and is the whole of GL-2's (a): feed rows stay out of position and revenue
 * VALUATION (`latestManualCashBid`, `basisMath.latestBasis`) and are admitted for ALERTING, because a
 * USDA MARS bid is exactly the news a price target exists to catch. A feed row may cause the sweep's
 * notification and rule state and nothing else; it never writes a contract, marketing target, manual
 * bid, bin, or on-hand quantity. This function and `public.cash_bid_eligible_for_crop_year` must agree:
 * the sweep is the monitor and this page reports the same rule for the same reason. */
export function latestAlertEligibleCashBid(workspace: GrainWorkspace, rule: Pick<MarketingAlertRule, 'commodity_id' | 'crop_year'>, today: string, maxAgeDays = MARKETING_BID_MAX_AGE_DAYS): CashBid | null {
  const family = workspace.fields.commodities.find((item) => item.id === rule.commodity_id)?.crop_family as CropFamily | undefined
  return workspace.cash_bids
    .filter((bid) => bid.commodity_id === rule.commodity_id && bid.cash_price !== null
      && dayDifference(today, bid.bid_date) >= 0 && dayDifference(today, bid.bid_date) <= maxAgeDays
      && cashBidEligibleForCropYear(family, rule.crop_year, bid.bid_date, bid.delivery_start, bid.delivery_end))
    // The tie-breaker matters and must match `order by b.bid_date desc, b.updated_at desc, b.id desc`
    // in latest_eligible_cash_bid. One MARS run writes many rows for the same commodity and bid date in
    // one statement, so they can share updated_at to the microsecond; without the id, Array#sort's
    // stability would leave the workspace's ascending-id order and the page would pick the opposite row
    // from the sweep. Two rows tied on price either side of a target would then record opposite
    // conditions in alert_rule_states.
    .sort((left, right) => right.bid_date.localeCompare(left.bid_date) || right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id))[0] ?? null
}

function commodityName(workspace: GrainWorkspace, rule: MarketingAlertRule) { return workspace.fields.commodities.find((item) => item.id === rule.commodity_id)?.name ?? rule.commodity_id }
function hasFiredToday(rule: MarketingAlertRule, today: string) { return rule.last_triggered_at !== null && localCalendarDay(new Date(rule.last_triggered_at)) === today }
function hasProductionEstimate(workspace: GrainWorkspace, rule: MarketingAlertRule) { return workspace.production_estimates.some((estimate) => sameScope(estimate, rule)) }

/** The page's read of the same rules the server sweep evaluates every fifteen minutes. The sweep is
 * the monitor and the authority; this evaluation exists so the page agrees with the email that arrives. */
export function evaluateMarketingAlertRules(workspace: GrainWorkspace, now = new Date()): MarketingAlertEvaluation {
  const today = localCalendarDay(now); const alerts: MarketingAlertEvent[] = []; const firedRuleIds: string[] = []; const conditions: Array<{ ruleId: string; met: boolean }> = []
  for (const rule of workspace.marketing_alert_rules) {
    if (!rule.active || validateMarketingAlertRule(rule).length) continue
    const commodity = commodityName(workspace, rule); let message: string | null = null; let kind: MarketingAlertEvent['kind'] = 'marketing_price_target'
    if (rule.rule_type === 'price_target' && rule.threshold !== null && rule.direction !== null) {
      const bid = latestAlertEligibleCashBid(workspace, rule, today); const price = bid?.cash_price ?? null
      const met = price !== null && (rule.direction === 'at_or_above' ? price >= rule.threshold : price <= rule.threshold)
      if (met && bid) { kind = 'marketing_price_target'; message = `${rule.crop_year} ${commodity} cash price is ${money(price)} (bid ${bidDate(bid.bid_date)}). You set ${rule.direction === 'at_or_above' ? 'at or above' : 'at or below'} ${money(rule.threshold)}.` }
    } else if (rule.rule_type === 'pct_marketed_goal' && rule.threshold !== null) {
      if (hasProductionEstimate(workspace, rule)) { const current = marketedPercent(workspace, rule); if (current < rule.threshold) { kind = 'marketing_pct_marketed_goal'; message = `${rule.crop_year} ${commodity} is ${current.toFixed(0)}% marketed. Your goal is ${rule.threshold.toFixed(0)}%.` } }
    } else if (rule.rule_type === 'deadline' && rule.remind_on !== null && dayDifference(rule.remind_on, today) >= 0 && dayDifference(rule.remind_on, today) <= 7) {
      const difference = dayDifference(rule.remind_on, today)
      kind = 'marketing_deadline'
      message = difference === 0 ? `${rule.crop_year} ${commodity} reminder is today.` : `${rule.crop_year} ${commodity} reminder is in ${difference} day${difference === 1 ? '' : 's'}.`
    }
    const met = message !== null; conditions.push({ ruleId: rule.id, met });
    if (message && !hasFiredToday(rule, today)) { alerts.push({ ruleId: rule.id, key: `marketing-rule:${rule.id}:${today}`, kind, message }); firedRuleIds.push(rule.id) }
  }
  return { alerts, firedRuleIds, conditions }
}

export function ruleSentence(rule: MarketingAlertRule, commodity: string): string {
  if (rule.rule_type === 'price_target') return `Tell me when ${rule.crop_year} ${commodity} cash price target is ${rule.direction === 'at_or_above' ? 'at or above' : 'at or below'} ${money(rule.threshold ?? 0)}.`
  if (rule.rule_type === 'pct_marketed_goal') return `Remind me when ${rule.crop_year} ${commodity} is below ${rule.threshold ?? 0}% marketed.`
  return `Remind me about ${rule.crop_year} ${commodity} on ${rule.remind_on ?? 'the selected date'}.`
}

export function scopedAlertRules(workspace: GrainWorkspace, rule: MarketingAlertRule) { return workspace.marketing_alert_rules.filter((item) => sameScope(item, rule)) }
