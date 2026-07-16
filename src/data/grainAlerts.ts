import { supabase } from '../lib/supabaseClient'
import type { GrainWorkspace } from './grain'
import { evaluateMarketingAlertRules } from './marketingAlerts'
import { getOperationalIntegrityCapability } from './operationalIntegrityCapability'
import { farmLocalCalendarDate } from './farmDates'
import { currentFarmContext } from '../auth/farmContext'
import { supabaseConfig } from '../lib/supabaseConfig'
import { bindFarmOperationRequest, captureFarmOperationContext, farmOperationRequestHeaders, verifyFarmOperationContext, type FarmOperationContext } from './farmOperationContext'

export interface GrainAlert { key: string; kind: 'price_target' | 'target_deadline' | 'usda_report' | 'marketing_price_target' | 'marketing_pct_marketed_goal' | 'marketing_deadline'; message: string; targetId?: string; reportId?: string; observationId?: string; ruleId?: string }
const day = (value: Date) => value.toISOString().slice(0, 10)
const addDays = (value: string, count: number) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return day(date) }
const businessDay = (value: string) => { const weekday = new Date(`${value}T00:00:00Z`).getUTCDay(); return weekday !== 0 && weekday !== 6 }
const observationFresh = (bidDate: string, now: Date) => businessDay(bidDate) && now.getTime() - new Date(`${bidDate}T23:59:59Z`).getTime() <= 36 * 60 * 60 * 1000

/** Client v1 is intentionally check-on-open, not background monitoring. */
export function evaluateGrainAlerts(workspace: GrainWorkspace, now = new Date()): GrainAlert[] {
  const today = farmLocalCalendarDate(now); const alerts: GrainAlert[] = []
  for (const target of workspace.marketing_plan_targets) {
    if (target.target_price !== null) { const candidates = workspace.cash_bids.filter((bid) => bid.commodity_id === target.commodity_id && bid.cash_price !== null && observationFresh(bid.bid_date, now)); const highest = candidates.sort((left, right) => (right.cash_price! - left.cash_price!) || right.bid_date.localeCompare(left.bid_date))[0]; if (highest && highest.cash_price! >= target.target_price) alerts.push({ key: `price:${target.id}:${target.target_price}:${highest.id}`, kind: 'price_target', targetId: target.id, observationId: highest.id, message: `Cash price target reached for ${target.commodity_id}: ${highest.cash_price!.toFixed(2)}.` }) }
    if (target.deadline && (target.deadline === today || target.deadline === addDays(today, 7))) { const window = target.deadline === today ? 'due' : 'seven-days'; alerts.push({ key: `deadline:${target.id}:${target.deadline}:${window}`, kind: 'target_deadline', targetId: target.id, message: target.deadline === today ? `Marketing target deadline is today (${target.deadline}).` : `Marketing target deadline is in seven days (${target.deadline}).` }) }
  }
  for (const report of workspace.usda_report_dates) if (report.report_date === today || report.report_date === addDays(today, 7)) { const window = report.report_date === today ? 'due' : 'seven-days'; alerts.push({ key: `report:${report.id}:${report.report_date}:${window}`, kind: 'usda_report', reportId: report.id, message: report.report_date === today ? `${report.report_name} is scheduled today.` : `${report.report_name} is scheduled in seven days.` }) }
  for (const item of evaluateMarketingAlertRules(workspace, now).alerts) alerts.push({ ...item, ruleId: item.ruleId })
  return alerts
}
function sentKey(userId: string, farmId: string) { return `farm-rx-grain-alert-sent:v1:${userId}:${farmId}` }
function readSent(key: string) { try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) && value.every((item) => typeof item === 'string') ? new Set(value) : new Set<string>() } catch { return new Set<string>() } }
export async function captureGrainAlertOperationContext() { return captureFarmOperationContext(localStorage, supabaseConfig.projectRef, await currentFarmContext()) }
export async function verifyGrainAlertOperationContext(expected: FarmOperationContext) { verifyFarmOperationContext(localStorage, expected, await captureGrainAlertOperationContext()) }
type AlertDeliveryDependencies = {
  verify: (expected: FarmOperationContext) => Promise<void>
  getUser: () => Promise<{ userId: string | null; error: unknown }>
  invoke: (alert: GrainAlert, farmId: string, headers: Record<string, string>) => Promise<unknown>
  readSent: (key: string) => Set<string>
  writeSent: (key: string, values: string[]) => void
}

/** Testable core for the browser alert path. Every awaited boundary reuses the
 * one context captured before Grain loaded; this function never recaptures and
 * therefore cannot rebound an A operation onto B or a newer access epoch. */
export async function requestOwnerAlertDeliveryGuarded(alerts: GrainAlert[], farmId: string, operationContext: FarmOperationContext, dependencies: AlertDeliveryDependencies) {
  if (!alerts.length) return [] as string[]
  await dependencies.verify(operationContext)
  if (farmId !== operationContext.farmId) throw new Error('The selected farm changed before alert delivery could finish.')
  const auth = await dependencies.getUser(); await dependencies.verify(operationContext)
  if (auth.error || auth.userId !== operationContext.userId) throw new Error('The signed-in account changed before alert delivery could finish.')
  const key = sentKey(operationContext.userId, farmId); const sent = dependencies.readSent(key)
  const failures: string[] = []
  for (const alert of alerts.filter((item) => !sent.has(item.key))) {
    const flightKey = `${operationContext.userId}:${farmId}:${alert.key}`
    if (inFlight.has(flightKey)) continue
    inFlight.add(flightKey)
    try {
      await dependencies.verify(operationContext)
      const deliveryError = await dependencies.invoke(alert, farmId, farmOperationRequestHeaders(operationContext))
      await dependencies.verify(operationContext)
      if (deliveryError) failures.push(alert.key); else sent.add(alert.key)
    } finally { inFlight.delete(flightKey) }
  }
  await dependencies.verify(operationContext)
  try { dependencies.writeSent(key, [...sent]) } catch { /* delivery remains best effort and will be retried */ }
  return failures
}
/** The Edge Function is the authority for owner verification, recipient email, rate limiting, and durable delivery. */
export async function requestOwnerAlertDelivery(alerts: GrainAlert[], farmId: string, operationContext: FarmOperationContext) {
  return requestOwnerAlertDeliveryGuarded(alerts, farmId, operationContext, {
    verify: verifyGrainAlertOperationContext,
    getUser: async () => { const { data, error } = await supabase.auth.getUser(); return { userId: data.user?.id ?? null, error } },
    invoke: async (alert, targetFarmId, headers) => { const { error } = await supabase.functions.invoke('deliver-grain-alert', { headers, body: { alertKey: alert.key, kind: alert.kind, farmId: targetFarmId, targetId: alert.targetId, reportId: alert.reportId, observationId: alert.observationId, ruleId: alert.ruleId } }); return error },
    readSent,
    writeSent: (key, values) => localStorage.setItem(key, JSON.stringify(values)),
  })
}
type AlertTransitionDependencies = {
  verify: (expected: FarmOperationContext) => Promise<void>
  hasCapability: () => Promise<boolean>
  record: (condition: { ruleId: string; met: boolean }, headers: Record<string, string>) => Promise<{ data: unknown; error: { code?: string } | null }>
}

export async function recordMarketingAlertTransitionsGuarded(farmId: string, conditions: Array<{ ruleId: string; met: boolean }>, operationContext: FarmOperationContext, dependencies: AlertTransitionDependencies): Promise<Set<string> | null> {
  await dependencies.verify(operationContext)
  if (!await dependencies.hasCapability()) { await dependencies.verify(operationContext); return null }
  if (operationContext.farmId !== farmId) return null
  const fired = new Set<string>()
  for (const condition of conditions) {
    await dependencies.verify(operationContext)
    const { data, error } = await dependencies.record(condition, farmOperationRequestHeaders(operationContext))
    await dependencies.verify(operationContext)
    if (error) { if (error.code === '42883' || error.code === 'PGRST202') return null; continue }
    if (data && typeof data === 'object' && (data as { fired?: unknown }).fired === true) fired.add(condition.ruleId)
  }
  return fired
}
/** 0035 records false/true state atomically. A missing draft RPC intentionally
 * returns null so the caller can retain the pre-update guarded behavior. */
export async function recordMarketingAlertTransitions(farmId: string, conditions: Array<{ ruleId: string; met: boolean }>, operationContext: FarmOperationContext): Promise<Set<string> | null> {
  return recordMarketingAlertTransitionsGuarded(farmId, conditions, operationContext, {
    verify: verifyGrainAlertOperationContext,
    hasCapability: getOperationalIntegrityCapability,
    record: async (condition) => bindFarmOperationRequest(supabase.rpc('record_marketing_alert_transition', { p_farm_id: farmId, p_rule_id: condition.ruleId, p_condition_true: condition.met }), operationContext),
  })
}
const inFlight = new Set<string>()
