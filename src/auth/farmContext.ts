import { supabase } from '../lib/supabaseClient'
import { supabaseConfig } from '../lib/supabaseConfig'
import type { Farm } from '../data/fields'
import { deleteUserWorkspaceCaches } from '../data/workspaceCache'
import { quarantineRevokedFarmWork } from '../data/revokedFarmRecovery'
import { captureFarmRevocationFence, inspectFarmRevocationState, listFarmRevocationScopes, markFarmGranted, markFarmRevoked, resetFarmGrantFromLive, resetFarmRevokedFromLive } from '../data/farmRevocationFence'
import { coordinatedDeviceTransaction } from '../data/queueTransaction'
import { clearFarmAccessEpochs, farmActiveContextKey, readFarmAccessEpochs, writeFarmAccessEpochs } from './farmAccessEpoch'

export type FarmAccessSource = 'live' | 'offline'
export type FarmAccess = { userId: string; farms: Farm[]; selectedFarmId: string | null; validatedAt: string; source: FarmAccessSource }
type StoredAccess = Omit<FarmAccess, 'source'> & { version: 1 }

const maximumAccessAgeMs = 7 * 24 * 60 * 60 * 1_000
const liveReuseMs = 30_000
const activeKey = farmActiveContextKey(supabaseConfig.projectRef)
const accessKey = (userId: string) => `farm-rx-access:v1:${supabaseConfig.projectRef}:${userId}`
const validationKey = (userId: string) => `farm-rx-access-validation:v1:${supabaseConfig.projectRef}:${userId}`
const validationLockKey = (userId: string) => `farm-rx-access-validation-lock:v1:${supabaseConfig.projectRef}:${userId}`
const refreshes = new Map<string, { epoch: number; promise: Promise<FarmAccess> }>()
const accountEpochs = new Map<string, number>()

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
function storedAccessIsFenced(value: StoredAccess): boolean {
  const target = storage(); if (!target && value.farms.length) return false
  const epochs = target ? readFarmAccessEpochs(target, supabaseConfig.projectRef, value.userId) : null
  if (!epochs || Object.keys(epochs).length !== value.farms.length) return false
  try {
    for (const farm of value.farms) {
      const snapshot = captureFarmRevocationFence(target!, { projectRef: supabaseConfig.projectRef, userId: value.userId, farmId: farm.id })
      if (snapshot.serverEpoch !== epochs[farm.id]) return false
    }
    return true
  } catch { return false }
}

async function requireCurrentSession(userId: string) {
  const { data, error } = await supabase.auth.getSession()
  if (error || data.session?.user.id !== userId) throw new Error('Farm access validation no longer matches the signed-in account.')
}

async function loadServerEpochs(userId: string, farms: Farm[]): Promise<Record<string, number>> {
  await requireCurrentSession(userId)
  const { data, error } = await supabase.rpc('get_current_farm_access_epochs')
  if (error || !Array.isArray(data)) throw error ?? new Error('Farm access versions were unavailable.')
  const epochs: Record<string, number> = {}
  for (const value of data as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Farm access versions were malformed.')
    const row = value as { farm_id?: unknown; access_epoch?: unknown }
    const epoch = typeof row.access_epoch === 'string' ? Number(row.access_epoch) : row.access_epoch
    if (typeof row.farm_id !== 'string' || !farms.some((farm) => farm.id === row.farm_id) || !Number.isSafeInteger(epoch) || Number(epoch) < 1 || Object.hasOwn(epochs, row.farm_id)) throw new Error('Farm access versions were malformed.')
    epochs[row.farm_id] = Number(epoch)
  }
  if (Object.keys(epochs).length !== farms.length) throw new Error('Farm access versions did not match the accessible farms.')
  return epochs
}

export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  if (!error && data.session?.user.id) return data.session.user.id
  const raw = storage()?.getItem(activeKey)
  if (offline() && raw) { try { const value = JSON.parse(raw) as { version?: unknown; userId?: unknown }; if (value.version === 1 && typeof value.userId === 'string') return value.userId } catch { /* fail closed below */ } }
  throw new Error('Your sign-in ended. Please sign in again.')
}

async function fetchAccessibleFarms(userId: string, accountEpoch: number): Promise<FarmAccess> {
  const target = storage(); if (!target) throw new Error('Farm Rx could not verify farm access without device storage.')
  const createId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return coordinatedDeviceTransaction(validationLockKey(userId), target, createId, async (verifyCoordination) => {
    const prior = parseStored(userId)
    const validationToken = createId()
    target.setItem(validationKey(userId), validationToken)
    const verifyValidation = () => {
      verifyCoordination()
      if (target.getItem(validationKey(userId)) !== validationToken || (accountEpochs.get(userId) ?? 0) !== accountEpoch) throw new Error('Farm access changed while it was being verified.')
    }
    verifyValidation()
    const validationStartedAt = new Date().toISOString()
    await requireCurrentSession(userId)
    verifyValidation()
    const { data, error } = await supabase.from('farms').select('*').order('name').order('id')
    verifyValidation()
    if (error) throw error
    const farms = (data ?? []) as Farm[]
    const serverEpochs = await loadServerEpochs(userId, farms)
    verifyValidation()
    const priorEpochs = readFarmAccessEpochs(target, supabaseConfig.projectRef, userId) ?? {}
    const knownFarmIds = new Set([...(prior?.farms.map((farm) => farm.id) ?? []), ...listFarmRevocationScopes(target, supabaseConfig.projectRef, userId).map((scope) => scope.farmId)])
    const removed = [...knownFarmIds].filter((farmId) => !farms.some((next) => next.id === farmId))
    // Do not publish a new live access snapshot until every removed farm's unsent work
    // is durably separated from active queues and its readable cache is gone.
    for (const farmId of removed) {
      verifyValidation()
      const scope = { projectRef: supabaseConfig.projectRef, userId, farmId }
      const state = inspectFarmRevocationState(target, scope)
      const serverEpoch = priorEpochs[farmId] ?? state.serverEpoch ?? 1
      if (state.kind === 'active' || state.kind === 'revoked') markFarmRevoked(target, scope, validationStartedAt, serverEpoch)
      else resetFarmRevokedFromLive(target, scope, serverEpoch, validationStartedAt)
      quarantineRevokedFarmWork(target, scope)
      await deleteUserWorkspaceCaches(supabaseConfig.projectRef, userId, farmId)
      verifyValidation()
    }
    for (const farm of farms) {
      verifyValidation()
      const scope = { projectRef: supabaseConfig.projectRef, userId, farmId: farm.id }
      const state = inspectFarmRevocationState(target, scope)
      const serverEpoch = serverEpochs[farm.id]!
      const wasKnown = knownFarmIds.has(farm.id) || Object.hasOwn(priorEpochs, farm.id)
      if (state.kind === 'active' && state.serverEpoch === serverEpoch) {
        markFarmGranted(target, scope, validationStartedAt, serverEpoch)
        continue
      }
      // A delayed or cached access response must never move a device backwards,
      // and a revoked/partially deleted scope can only be reactivated by a
      // strictly newer server epoch. First use on a clean device may begin at 1.
      const priorServerEpoch = Math.max(state.serverEpoch ?? 0, priorEpochs[farm.id] ?? 0)
      const recoveringKnownScope = state.kind === 'revoked' || state.kind === 'invalid' || state.kind === 'missing' && wasKnown
      if (serverEpoch < priorServerEpoch || recoveringKnownScope && (priorServerEpoch === 0 || serverEpoch <= priorServerEpoch)) {
        throw new Error('Farm access changed while it was being verified.')
      }
      if (state.kind !== 'active' || state.serverEpoch !== serverEpoch) {
        quarantineRevokedFarmWork(target, scope)
        await deleteUserWorkspaceCaches(supabaseConfig.projectRef, userId, farm.id)
        verifyValidation()
        resetFarmGrantFromLive(target, scope, serverEpoch, validationStartedAt)
      }
    }
    verifyValidation()
    writeFarmAccessEpochs(target, supabaseConfig.projectRef, userId, serverEpochs, validationStartedAt)
    const selectedFarmId = prior?.selectedFarmId && farms.some((farm) => farm.id === prior.selectedFarmId) ? prior.selectedFarmId : farms.length === 1 ? farms[0].id : null
    const value: StoredAccess = { version: 1, userId, farms, selectedFarmId, validatedAt: new Date().toISOString() }
    verifyValidation()
    await requireCurrentSession(userId)
    verifyValidation()
    persist(value)
    return { ...value, source: 'live' }
  })
}

export async function loadFarmAccess(userId: string, force = false): Promise<FarmAccess> {
  const cached = parseStored(userId)
  if (!force && !offline() && cached && Date.now() - Date.parse(cached.validatedAt) <= liveReuseMs && storedAccessIsFenced(cached)) return { ...cached, source: 'live' }
  if (offline()) {
    if (!cached || Date.now() - Date.parse(cached.validatedAt) > maximumAccessAgeMs || !storedAccessIsFenced(cached)) throw new Error('This device needs a connection to verify your farm access.')
    return { ...cached, source: 'offline' }
  }
  const accountEpoch = accountEpochs.get(userId) ?? 0
  let refresh = refreshes.get(userId)
  if (!refresh || refresh.epoch !== accountEpoch) {
    const promise = fetchAccessibleFarms(userId, accountEpoch).finally(() => { if (refreshes.get(userId)?.promise === promise) refreshes.delete(userId) })
    refresh = { epoch: accountEpoch, promise }; refreshes.set(userId, refresh)
  }
  try { const result = await refresh.promise; if (result.userId !== userId || (accountEpochs.get(userId) ?? 0) !== accountEpoch) throw new Error('Farm access changed while it was being verified.'); return result } catch (error) {
    if (cached && transport(error) && Date.now() - Date.parse(cached.validatedAt) <= maximumAccessAgeMs && storedAccessIsFenced(cached)) return { ...cached, source: 'offline' }
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
  accountEpochs.set(userId, (accountEpochs.get(userId) ?? 0) + 1)
  const target = storage()
  if (target) {
    target.setItem(validationKey(userId), typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
    target.removeItem(accessKey(userId)); clearFarmAccessEpochs(target, supabaseConfig.projectRef, userId)
    try { const active = JSON.parse(target.getItem(activeKey) ?? '{}') as { userId?: unknown }; if (active.userId === userId) target.removeItem(activeKey) } catch { target.removeItem(activeKey) }
  }
  await deleteUserWorkspaceCaches(supabaseConfig.projectRef, userId)
}
