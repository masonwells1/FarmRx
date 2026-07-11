import { MockGrainRepository, MockMarketDataService, MockProfitabilityRepository, createGrainId } from './MockGrainRepository'
import type { GrainServices } from './grain'

/** Application composition boundary: replace these implementations for Supabase without changing the UI. */
export const grainServices: GrainServices = { grainRepository: new MockGrainRepository(), marketDataService: new MockMarketDataService(), profitabilityRepository: new MockProfitabilityRepository(), createGrainId }
