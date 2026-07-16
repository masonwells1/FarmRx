import { supabaseConfig } from '../lib/supabaseConfig'
import { currentFarmContext, currentUserId } from '../auth/farmContext'
import { moduleBackends } from './backends'
import { QueuedFieldsRepository } from './QueuedFieldsRepository'
import { createSupabaseGrainServices } from './createSupabaseGrainServices'
import { createSupabaseProfitabilityServices } from './createSupabaseProfitabilityServices'
import { createSupabaseInventoryServices } from './createSupabaseInventoryServices'
import { createSupabaseEquipmentTasksServices } from './createSupabaseEquipmentTasksServices'
import { createSupabaseFieldLogServices } from './createSupabaseFieldLogServices'
import { createSupabaseScoutingServices } from './createSupabaseScoutingServices'
import { createSupabaseHarvestServices } from './createSupabaseHarvestServices'
import { createSupabaseProgramsServices } from './createSupabaseProgramsServices'
import { createSupabaseNotificationsServices } from './createSupabaseNotificationsServices'
import { DueProgramItemsService, SupabaseDueProgramItemsGateway } from './programDueItems'
import { SupabaseFieldsDataGateway } from './SupabaseFieldsDataGateway'
import { SupabaseFieldsRepository } from './SupabaseFieldsRepository'
import { createFieldLocationClient, SupabaseFieldLocationGateway } from './fieldLocation'
import type { FieldsRepository } from './fields'
import { captureFarmOperationContext, verifyFarmOperationContext } from './farmOperationContext'

async function currentFarmId() {
  return (await currentFarmContext()).farmId
}

const storage = localStorage
const fieldsGetContext = async () => ({ userId: await currentUserId(), farmId: await currentFarmId() })
const getFieldsOperationContext = async () => captureFarmOperationContext(storage, supabaseConfig.projectRef, await fieldsGetContext())
const verifyFieldsOperationContext = async (expected: Awaited<ReturnType<typeof getFieldsOperationContext>>) => verifyFarmOperationContext(storage, expected, await getFieldsOperationContext())
const liveFields = new SupabaseFieldsRepository({ gateway: new SupabaseFieldsDataGateway(), getFarmId: currentFarmId, getOperationContext: getFieldsOperationContext, verifyOperationContext: verifyFieldsOperationContext, createId: () => crypto.randomUUID(), clock: () => new Date().toISOString() })

const queuedFields = new QueuedFieldsRepository(liveFields, {
  getContext: fieldsGetContext,
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

if (moduleBackends.fields !== 'supabase' || moduleBackends.grain !== 'supabase' || moduleBackends.inventory !== 'supabase' || moduleBackends.profitability !== 'supabase' || moduleBackends.equipment_tasks !== 'supabase' || moduleBackends.fieldLog !== 'supabase' || moduleBackends.scouting !== 'supabase' || moduleBackends.harvest !== 'supabase' || moduleBackends.programs !== 'supabase' || moduleBackends.notifications !== 'supabase') throw new Error('Farm Rx backend configuration is invalid.')
const getContext = currentFarmContext
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
const liveHarvest = createSupabaseHarvestServices({ fieldsRepository, getFarmId: currentFarmId, getUserId: currentUserId, getContext, projectRef: supabaseConfig.projectRef, storage, createId: () => crypto.randomUUID(), isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const harvestRepository = liveHarvest.harvestRepository
export const replayHarvestQueue = () => liveHarvest.replayHarvestQueue()
const livePrograms = createSupabaseProgramsServices({ getFarmId: currentFarmId, getUserId: currentUserId, getContext, projectRef: supabaseConfig.projectRef, storage, createId: () => crypto.randomUUID(), isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const programsRepository = livePrograms.programsRepository
export const replayProgramsQueue = () => livePrograms.replayProgramsQueue()
const dueProgramItems = new DueProgramItemsService({ gateway: new SupabaseDueProgramItemsGateway(), getFarmId: currentFarmId, getOperationContext: getFieldsOperationContext, verifyOperationContext: verifyFieldsOperationContext, createId: () => crypto.randomUUID() })
/** Best-effort only: later refreshes safely retry if this scan cannot reach Supabase. */
export const generateDueProgramItems = () => dueProgramItems.generate()
const liveScouting = createSupabaseScoutingServices({ getFarmId: currentFarmId, getUserId: currentUserId, getContext, projectRef: supabaseConfig.projectRef, storage, createId: () => crypto.randomUUID(), isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const scoutingRepository = liveScouting.scoutingRepository
export const replayScoutingQueue = () => liveScouting.replayScoutingQueue()
const liveNotifications = createSupabaseNotificationsServices({ getUserId: currentUserId, getContext, projectRef: supabaseConfig.projectRef, storage, createId: () => crypto.randomUUID(), isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const notificationsRepository = liveNotifications.notificationsRepository
export const replayNotificationsQueue = () => liveNotifications.replayNotificationsQueue()
const liveGrain = createSupabaseGrainServices({ fieldsRepository, profitabilityRepository, getFarmId: currentFarmId, getContext, projectRef: supabaseConfig.projectRef, storage, isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const grainServices = liveGrain.services
export const replayGrainQueue = () => liveGrain.replayGrainQueue()
export const moduleYear = new Date().getFullYear()
