import { supabase } from '../lib/supabaseClient'
import { supabaseConfig } from '../lib/supabaseConfig'
import { moduleBackends } from './backends'
import { QueuedFieldsRepository } from './QueuedFieldsRepository'
import { createSupabaseGrainServices } from './createSupabaseGrainServices'
import { createSupabaseProfitabilityServices } from './createSupabaseProfitabilityServices'
import { createSupabaseInventoryServices } from './createSupabaseInventoryServices'
import { createSupabaseEquipmentTasksServices } from './createSupabaseEquipmentTasksServices'
import { createSupabaseFieldLogServices } from './createSupabaseFieldLogServices'
import { createSupabaseScoutingServices } from './createSupabaseScoutingServices'
import { SupabaseFieldsDataGateway } from './SupabaseFieldsDataGateway'
import { SupabaseFieldsRepository } from './SupabaseFieldsRepository'
import { createFieldLocationClient, SupabaseFieldLocationGateway } from './fieldLocation'
import type { FieldsRepository } from './fields'

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('Your sign-in ended. Please sign in again.')
  return data.user.id
}

async function currentFarmId() {
  await currentUserId()
  const { data, error } = await supabase.from('farms').select('id')
  if (error) throw error
  if (data.length === 0) throw new Error('Crop RX needs to finish your farm setup.')
  if (data.length > 1) throw new Error('We found more than one farm for this account. Crop RX needs to finish your setup.')
  return data[0].id
}

const liveFields = new SupabaseFieldsRepository({ gateway: new SupabaseFieldsDataGateway(), getFarmId: currentFarmId, createId: () => crypto.randomUUID(), clock: () => new Date().toISOString() })
const storage = localStorage

const queuedFields = new QueuedFieldsRepository(liveFields, {
  getContext: async () => ({ userId: await currentUserId(), farmId: await currentFarmId() }),
  projectRef: supabaseConfig.projectRef,
  storage,
  createId: () => crypto.randomUUID(),
  clock: () => new Date().toISOString(),
  isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
})
export const fieldsRepository: FieldsRepository = queuedFields
/** Called once the signed-in user's sole farm has been resolved. */
export const replayFieldsQueue = () => queuedFields.inspectAndReplay()
export const fieldLocationClient = createFieldLocationClient({ gateway: new SupabaseFieldLocationGateway(), getContext: async () => ({ userId: await currentUserId(), farmId: await currentFarmId() }), projectRef: supabaseConfig.projectRef, storage, createId: () => crypto.randomUUID(), clock: () => new Date().toISOString(), isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const replayFieldLocationQueue = () => fieldLocationClient.replay()

if (moduleBackends.fields !== 'supabase' || moduleBackends.grain !== 'supabase' || moduleBackends.inventory !== 'supabase' || moduleBackends.profitability !== 'supabase' || moduleBackends.equipment_tasks !== 'supabase' || moduleBackends.fieldLog !== 'supabase' || moduleBackends.scouting !== 'supabase') throw new Error('Farm Rx backend configuration is invalid.')
const getContext = async () => ({ userId: await currentUserId(), farmId: await currentFarmId() })
const liveProfitability = createSupabaseProfitabilityServices({ fieldsRepository, getFarmId: currentFarmId, getContext, projectRef: supabaseConfig.projectRef, storage, createId: () => crypto.randomUUID(), isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const profitabilityRepository = liveProfitability.profitabilityRepository
export const replayProfitabilityQueue = () => liveProfitability.replayProfitabilityQueue()
const liveInventory = createSupabaseInventoryServices({ fieldsRepository, getFarmId: currentFarmId, getContext, projectRef: supabaseConfig.projectRef, storage, createId: () => crypto.randomUUID(), isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const inventoryRepository = liveInventory.inventoryRepository
export const replayInventoryQueue = () => liveInventory.replayInventoryQueue()
const liveEquipmentTasks = createSupabaseEquipmentTasksServices({ fieldsRepository, getFarmId: currentFarmId, getContext, projectRef: supabaseConfig.projectRef, storage, createId: () => crypto.randomUUID(), isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const equipmentTasksRepository = liveEquipmentTasks.equipmentTasksRepository
export const replayEquipmentTasksQueue = () => liveEquipmentTasks.replayEquipmentTasksQueue()
const liveFieldLog = createSupabaseFieldLogServices({ getFarmId: currentFarmId, getUserId: currentUserId, getContext, projectRef: supabaseConfig.projectRef, storage, createId: () => crypto.randomUUID(), isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const fieldLogRepository = liveFieldLog.fieldLogRepository
export const replayFieldLogQueue = () => liveFieldLog.replayFieldLogQueue()
const liveScouting = createSupabaseScoutingServices({ getFarmId: currentFarmId, getUserId: currentUserId, getContext, projectRef: supabaseConfig.projectRef, storage, createId: () => crypto.randomUUID(), isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const scoutingRepository = liveScouting.scoutingRepository
export const replayScoutingQueue = () => liveScouting.replayScoutingQueue()
const liveGrain = createSupabaseGrainServices({ fieldsRepository, profitabilityRepository, getFarmId: currentFarmId, getContext, projectRef: supabaseConfig.projectRef, storage, isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const grainServices = liveGrain.services
export const replayGrainQueue = () => liveGrain.replayGrainQueue()
export const moduleYear = new Date().getFullYear()
