import { MockProfitabilityRepository } from './MockProfitabilityRepository'
import { MockInventoryRepository } from './inventory'
import { supabase } from '../lib/supabaseClient'
import { supabaseConfig } from '../lib/supabaseConfig'
import { moduleBackends } from './backends'
import { QueuedFieldsRepository } from './QueuedFieldsRepository'
import { createSupabaseGrainServices } from './createSupabaseGrainServices'
import { SupabaseFieldsDataGateway } from './SupabaseFieldsDataGateway'
import { SupabaseFieldsRepository } from './SupabaseFieldsRepository'
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

if (moduleBackends.fields !== 'supabase' || moduleBackends.grain !== 'supabase' || moduleBackends.inventory !== 'mock' || moduleBackends.profitability !== 'mock') throw new Error('Farm Rx backend configuration is invalid.')
export const profitabilityRepository = new MockProfitabilityRepository(fieldsRepository)
export const inventoryRepository = new MockInventoryRepository(fieldsRepository)
const liveGrain = createSupabaseGrainServices({ fieldsRepository, profitabilityRepository, getFarmId: currentFarmId, getContext: async () => ({ userId: await currentUserId(), farmId: await currentFarmId() }), projectRef: supabaseConfig.projectRef, storage, isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false })
export const grainServices = liveGrain.services
export const replayGrainQueue = () => liveGrain.replayGrainQueue()
export const moduleYear = new Date().getFullYear()
