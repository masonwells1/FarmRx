import { MockGrainRepository, MockMarketDataService, MockProfitabilityRepository, createGrainId } from './MockGrainRepository'
import { fieldsRepository as mockFieldsRepository, moduleYear as mockModuleYear } from './MockFieldsRepository'
import type { FieldsRepository } from './fields'
import type { GrainServices } from './grain'

/** Application composition boundary: replace these implementations for Supabase without changing the UI. */
export const grainServices: GrainServices = { grainRepository: new MockGrainRepository(), marketDataService: new MockMarketDataService(), profitabilityRepository: new MockProfitabilityRepository(), createGrainId }
export const fieldsRepository: FieldsRepository = mockFieldsRepository
export const moduleYear = mockModuleYear
