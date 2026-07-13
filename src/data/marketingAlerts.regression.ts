import { evaluateMarketingAlertRules, validateAlertEmails, validateMarketingAlertRule } from './marketingAlerts'
import type { GrainWorkspace, MarketingAlertRule } from './grain'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-07-13T12:00:00.000Z'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const scope = { farm_id: uid(1), crop_year: 2026, commodity_id: 'corn', operating_entity_id: null, enterprise_label: null }
const base = (id: number, rule_type: MarketingAlertRule['rule_type']): MarketingAlertRule => ({ id: uid(id), ...scope, rule_type, direction: rule_type === 'price_target' ? 'at_or_above' : null, threshold: rule_type === 'deadline' ? null : rule_type === 'price_target' ? 4.75 : 55, remind_on: rule_type === 'deadline' ? '2026-07-20' : null, message: null, active: true, last_triggered_at: null, created_at: stamp, updated_at: stamp })
const workspace = { fields: { farm: { id: scope.farm_id }, commodities: [{ id: 'corn', name: 'Corn' }], crop_assignments: [], entities: [], fields: [] }, production_estimates: [{ id: uid(2), ...scope, planted_acres: 1, aph_yield: 100, expected_bushels: 1000, actual_bushels: null, drives_math: 'projected', notes: null, created_at: stamp, updated_at: stamp }], grain_contracts: [{ id: uid(3), ...scope, contract_type: 'forward_cash', buyer: 'Buyer', bushels: 400, futures_price: null, basis: null, cash_price: 4.5, delivery_start: null, delivery_end: null, contract_number: null, premium_cents_per_bu: 0, notes: null, created_at: stamp, updated_at: stamp }], marketing_plan_targets: [], insurance_units: [], grain_bins: [], bin_inventory: [], cash_bids: [{ id: uid(4), farm_id: scope.farm_id, elevator: 'Local elevator', commodity_id: 'corn', bid_date: '2026-07-13', basis: 0, cash_price: 4.8, delivery_start: null, delivery_end: null, notes: null, created_at: stamp, updated_at: stamp }], usda_report_dates: [], marketing_alert_rules: [], grain_alert_settings: null } as unknown as GrainWorkspace

const now = new Date('2026-07-13T12:00:00.000Z')
const price = base(10, 'price_target'); const below = { ...base(11, 'price_target'), direction: 'at_or_below' as const, threshold: 4.7 }; const marketed = base(12, 'pct_marketed_goal'); const deadline = base(13, 'deadline')
let result = evaluateMarketingAlertRules({ ...workspace, marketing_alert_rules: [price, below, marketed, deadline] }, now)
assert(result.firedRuleIds.includes(price.id) && result.firedRuleIds.includes(marketed.id) && !result.firedRuleIds.includes(below.id), 'Price target and below-marketed goal did not fire from hand-computed inputs.')
assert(result.alerts.find((alert) => alert.ruleId === price.id)?.message.includes('bid Jul 13'), 'Price target alert did not state the source cash bid date.')
result = evaluateMarketingAlertRules({ ...workspace, cash_bids: [{ ...workspace.cash_bids[0], bid_date: '2026-07-12', cash_price: 4.2 }], marketing_alert_rules: [{ ...price, threshold: 4.2 }] }, now)
assert(result.alerts[0].message.includes('cash price is $4.20 (bid Jul 12)'), 'Price target alert did not use the newest manual bid and its bid date.')
result = evaluateMarketingAlertRules({ ...workspace, marketing_alert_rules: [{ ...deadline, remind_on: '2026-07-21' }] }, now)
assert(result.firedRuleIds.length === 0, 'Deadline fired eight days before its reminder date.')
result = evaluateMarketingAlertRules({ ...workspace, marketing_alert_rules: [{ ...deadline, remind_on: '2026-07-20' }] }, now)
assert(result.firedRuleIds.length === 1 && result.alerts[0].message.includes('7 days'), 'Deadline did not fire exactly seven days before its date.')
result = evaluateMarketingAlertRules({ ...workspace, marketing_alert_rules: [{ ...deadline, remind_on: '2026-07-13' }] }, now)
assert(result.alerts[0].message.includes('today'), 'Deadline did not say today on its reminder date.')
result = evaluateMarketingAlertRules({ ...workspace, marketing_alert_rules: [{ ...deadline, remind_on: '2026-07-12' }] }, now)
assert(result.firedRuleIds.length === 0, 'Deadline fired again after its reminder date.')
const localEvening = new Date(2026, 6, 13, 19, 0, 0); const localSameDayTrigger = new Date(2026, 6, 13, 19, 5, 0).toISOString()
result = evaluateMarketingAlertRules({ ...workspace, marketing_alert_rules: [{ ...price, last_triggered_at: localSameDayTrigger }] }, localEvening)
assert(result.firedRuleIds.length === 0, 'A rule re-fired across the UTC boundary on the same device-local day.')
const orphanScope = { ...scope, operating_entity_id: uid(99) }
result = evaluateMarketingAlertRules({ ...workspace, marketing_alert_rules: [{ ...marketed, ...orphanScope }] }, now)
assert(result.firedRuleIds.length === 0, 'A percent-marketed rule fired without a matching production estimate.')
assert(validateMarketingAlertRule({ ...price, direction: null }).length > 0 && validateMarketingAlertRule({ ...marketed, direction: 'at_or_above' }).length > 0 && validateMarketingAlertRule({ ...deadline, threshold: 1 }).length > 0, 'Per-type database constraint mirror accepted an invalid shape.')
assert(validateAlertEmails(['farmer@example.com', 'advisor@example.com']).length === 0 && validateAlertEmails([' bad@example.com']).length > 0 && validateAlertEmails(['a@b.co', 'c@d.co', 'e@f.co', 'g@h.co']).length > 0, 'Email validation did not mirror the applied settings constraints.')
console.log('Marketing alert regressions passed.')
