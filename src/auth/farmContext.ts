import { supabase } from '../lib/supabaseClient'
import { supabaseConfig } from '../lib/supabaseConfig'
import type { Farm } from '../data/fields'
import { deleteUserWorkspaceCaches } from '../data/workspaceCache'

export type FarmAccessSource = 'live' | 'offline'
export type FarmAccess = { userId: string; farms: Farm[]; selectedFarmId: string | null; validatedAt: string; source: FarmAccessSource }
type StoredAccess = Omit<FarmAccess, 'source'> & { version: 1 }

const maximumAccessAgeMs = 7 * 24 * 60 * 60 * 1_000
const liveReuseMs = 30_000
const activeKey = `farm-rx-active-context:v1:${supabaseConfig.projectRef}`
const accessKey = (userId: string) => `farm-rx-access:v1:${supabaseConfig.projectRef}:${userId}`
let refresh: Promise<FarmAccess> | null = null

function storage(): Storage | null { return typeof window === 'undefined' ? null : window.localStorage }
function parseStored(userId: string): StoredAccess | null {
  const raw = storage()?.getItem(accessKey(userId)); if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredAccess>
    if (value.version !== 1 || value.userId !== userId || !Array.isArray(value.farms) || typeof value.validatedAt !== 'string' || Number.isNaN(Date.parse(value.validatedAt)) || !(value.selectedFarmId === null || typeof value.selectedFarmId === 'string')) return null
    const farms = value.farms.filter((farm): farm is Farm => !!farm && typeof farm === 'object' && typeof farm.id === 'string' && typeof farm.name === 'string')
    if (farms.length !== value.farms.length || value.selectedFarmId !== null && !farms.some((farm) => farm.id === value.selectedFarmId)) return null
    return { version: 1, userId, farms, selectedFarmId: value.selectedFarmId, validatedAt: value.validatedAt }
  } catch { return null }
}
function persist(value: StoredAccess) {
  const target = storage(); if (!target) return
  target.setItem(accessKey(value.userId), JSON.stringify(value))
  if (value.selectedFarmId) target.setItem(activeKey, JSON.stringify({ version: 1, userId: value.userId, farmId: value.selectedFarmId }))
  else target.removeItem(activeKey)
}
function offline() { return typeof navigator !== 'undefined' && navigator.onLine === false }
function transport(error: unknown) { const message = error instanceof Error ? error.message : String(error); return offline() || /network|fetch|timeout|connection|failed to send/i.test(message) }

export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  if (!error && data.session?.user.id) return data.session.user.id
  const raw = storage()?.getItem(activeKey)
  if (offline() && raw) { try { const value = JSON.parse(raw) as { version?: unknown; userId?: unknown }; if (value.version === 1 && typeof value.userId === 'string') return value.userId } catch { /* fail closed below */ } }
  throw new Error('Your sign-in ended. Please sign in again.')
}

async function fetchAccessibleFarms(userId: string): Promise<FarmAccess> {
  const prior = parseStored(userId)
  const { data, error } = await supabase.from('farms').select('*').order('name').order('id')
  if (error) throw error
  const farms = (data ?? []) as Farm[]
  const removed = prior?.farms.filter((farm) => !farms.some((next) => next.id === farm.id)) ?? []
  await Promise.all(removed.map((farm) => deleteUserWorkspaceCaches(supabaseConfig.projectRef, userId, farm.id)))
  const selectedFarmId = prior?.selectedFarmId && farms.some((farm) => farm.id === prior.selectedFarmId) ? prior.selectedFarmId : farms.length === 1 ? farms[0].id : null
  const value: StoredAccess = { version: 1, userId, farms, selectedFarmId, validatedAt: new Date().toISOString() }
  persist(value)
  return { ...value, source: 'live' }
}

export async function loadFarmAccess(userId: string, force = false): Promise<FarmAccess> {
  const cached = parseStored(userId)
  if (!force && !offline() && cached && Date.now() - Date.parse(cached.validatedAt) <= liveReuseMs) return { ...cached, source: 'live' }
  if (offline()) {
    if (!cached || Date.now() - Date.parse(cached.validatedAt) > maximumAccessAgeMs) throw new Error('This device needs a connection to verify your farm access.')
    return { ...cached, source: 'offline' }
  }
  if (!refresh) refresh = fetchAccessibleFarms(userId).finally(() => { refresh = null })
  try { return await refresh } catch (error) {
    if (cached && transport(error) && Date.now() - Date.parse(cached.validatedAt) <= maximumAccessAgeMs) return { ...cached, source: 'offline' }
    throw error
  }
}

export async function currentFarmContext(): Promise<{ userId: string; farmId: string }> {
  const userId = await currentUserId()
  const access = await loadFarmAccess(userId)
  if (!access.selectedFarmId) throw new Error(access.farms.length > 1 ? 'Choose which farm you want to open.' : 'Crop RX needs to finish your farm setup.')
  return { userId, farmId: access.selectedFarmId }
}

export async function selectFarm(userId: string, farmId: string): Promise<void> {
  const access = await loadFarmAccess(userId)
  if (!access.farms.some((farm) => farm.id === farmId)) throw new Error('You no longer have access to that farm.')
  persist({ version: 1, userId, farms: access.farms, selectedFarmId: farmId, validatedAt: access.validatedAt })
}

export function hasPendingFarmWork(userId: string, farmId: string): boolean {
  const target = storage(); if (!target) return false
  for (let index = 0; index < target.length; index += 1) {
    const key = target.key(index); if (!key || !key.includes(supabaseConfig.projectRef) || !key.includes(userId) || !key.includes(farmId) || key.endsWith(':lease')) continue
    const raw = target.getItem(key); if (!raw) continue
    try { const value = JSON.parse(raw) as { entries?: unknown }; if (Array.isArray(value.entries) && value.entries.length > 0) return true } catch { /* corrupt records are handled by their owning queue */ }
  }
  return false
}

export async function clearFarmAccess(userId: string): Promise<void> {
  storage()?.removeItem(accessKey(userId)); storage()?.removeItem(activeKey)
  await deleteUserWorkspaceCaches(supabaseConfig.projectRef, userId)
}
