import { supabase } from '../lib/supabaseClient'
import type { GrainWorkspace } from './grain'

export interface GrainAlert { key: string; kind: 'price_target' | 'target_deadline' | 'usda_report'; message: string; targetId?: string; reportId?: string; observationId?: string }
const day = (value: Date) => value.toISOString().slice(0, 10)
const addDays = (value: string, count: number) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return day(date) }
const businessDay = (value: string) => { const weekday = new Date(`${value}T00:00:00Z`).getUTCDay(); return weekday !== 0 && weekday !== 6 }
const observationFresh = (bidDate: string, now: Date) => businessDay(bidDate) && now.getTime() - new Date(`${bidDate}T23:59:59Z`).getTime() <= 36 * 60 * 60 * 1000

/** Client v1 is intentionally check-on-open, not background monitoring. */
export function evaluateGrainAlerts(workspace: GrainWorkspace, now = new Date()): GrainAlert[] {
  const today = day(now); const alerts: GrainAlert[] = []
  for (const target of workspace.marketing_plan_targets) {
    if (target.target_price !== null) { const candidates = workspace.cash_bids.filter((bid) => bid.commodity_id === target.commodity_id && bid.cash_price !== null && observationFresh(bid.bid_date, now)); const highest = candidates.sort((left, right) => (right.cash_price! - left.cash_price!) || right.bid_date.localeCompare(left.bid_date))[0]; if (highest && highest.cash_price! >= target.target_price) alerts.push({ key: `price:${target.id}:${target.target_price}:${highest.id}`, kind: 'price_target', targetId: target.id, observationId: highest.id, message: `Cash price target reached for ${target.commodity_id}: ${highest.cash_price!.toFixed(2)}.` }) }
    if (target.deadline && (target.deadline === today || target.deadline === addDays(today, 7))) { const window = target.deadline === today ? 'due' : 'seven-days'; alerts.push({ key: `deadline:${target.id}:${target.deadline}:${window}`, kind: 'target_deadline', targetId: target.id, message: target.deadline === today ? `Marketing target deadline is today (${target.deadline}).` : `Marketing target deadline is in seven days (${target.deadline}).` }) }
  }
  for (const report of workspace.usda_report_dates) if (report.report_date === today || report.report_date === addDays(today, 7)) { const window = report.report_date === today ? 'due' : 'seven-days'; alerts.push({ key: `report:${report.id}:${report.report_date}:${window}`, kind: 'usda_report', reportId: report.id, message: report.report_date === today ? `${report.report_name} is scheduled today.` : `${report.report_name} is scheduled in seven days.` }) }
  return alerts
}
function sentKey(userId: string, farmId: string) { return `farm-rx-grain-alert-sent:v1:${userId}:${farmId}` }
function readSent(key: string) { try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) && value.every((item) => typeof item === 'string') ? new Set(value) : new Set<string>() } catch { return new Set<string>() } }
/** The Edge Function is the authority for owner verification, recipient email, rate limiting, and durable delivery. */
export async function requestOwnerAlertDelivery(alerts: GrainAlert[], farmId: string) {
  const { data, error } = await supabase.auth.getUser(); if (error || !data.user || !alerts.length) return [] as string[]
  const key = sentKey(data.user.id, farmId); const sent = readSent(key)
  const failures: string[] = []
  for (const alert of alerts.filter((item) => !sent.has(item.key))) {
    if (inFlight.has(alert.key)) continue
    inFlight.add(alert.key)
    try { const { error: deliveryError } = await supabase.functions.invoke('deliver-grain-alert', { body: { alertKey: alert.key, kind: alert.kind, farmId, targetId: alert.targetId, reportId: alert.reportId, observationId: alert.observationId } }); if (deliveryError) failures.push(alert.key); else sent.add(alert.key) } finally { inFlight.delete(alert.key) }
  }
  try { localStorage.setItem(key, JSON.stringify([...sent])) } catch { /* delivery remains best effort and will be retried */ }
  return failures
}
const inFlight = new Set<string>()
