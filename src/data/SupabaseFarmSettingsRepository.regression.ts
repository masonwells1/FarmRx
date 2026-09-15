import type { FarmOperationContext } from './farmOperationContext'
import { MARKET_REGIONS, isMarketRegion, marketRegionName, type FarmMarketRegionInput, type FarmSettingsGateway } from './farmSettings'
import { SupabaseFarmSettingsRepository } from './SupabaseFarmSettingsRepository'

const farmId = '11111111-1111-4111-8111-111111111111'
const otherFarmId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const expectedUpdatedAt = '2026-09-15T12:00:00.000Z'
const savedUpdatedAt = '2026-09-15T12:01:00.000Z'
const context: FarmOperationContext = { projectRef: 'farmrx-test', userId, farmId, generation: 1, token: '11111111-1111-4111-8111-111111111111', serverEpoch: 7 }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function rejects(task: () => Promise<unknown>, pattern: RegExp) {
  try { await task() } catch (error) {
    assert(error instanceof Error && pattern.test(error.message), `Expected ${pattern}, received ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  throw new Error(`Expected ${pattern} to reject.`)
}

function farmRow(overrides: Record<string, unknown> = {}) {
  return { id: farmId, name: 'Wells Farm', share_with_rep: false, time_zone: 'America/Chicago', market_region: 'IL', created_by: userId, created_at: '2026-07-01T12:00:00.000Z', updated_at: savedUpdatedAt, ...overrides }
}

class FakeGateway implements FarmSettingsGateway {
  calls: Array<{ input: FarmMarketRegionInput; context: FarmOperationContext }> = []
  result: unknown = farmRow()
  async updateFarmMarketRegion(input: FarmMarketRegionInput, operationContext: FarmOperationContext) {
    this.calls.push({ input, context: operationContext })
    return this.result
  }
}

async function run() {
  // The list mirrors the database check: fifty states and the District, two-letter upper-case codes, nothing else.
  assert(MARKET_REGIONS.length === 51 && new Set(MARKET_REGIONS.map((region) => region.code)).size === 51 && MARKET_REGIONS.every((region) => /^[A-Z]{2}$/.test(region.code)), 'The market region list is the fifty states and DC.')
  assert(isMarketRegion('IL') && isMarketRegion('IA') && !isMarketRegion('il') && !isMarketRegion('Iowa') && !isMarketRegion('') && !isMarketRegion(null) && marketRegionName('IN') === 'Indiana' && marketRegionName(null) === null, 'Only a listed code is a market region; names resolve from codes.')

  {
    const gateway = new FakeGateway()
    let verifies = 0
    const repository = new SupabaseFarmSettingsRepository({ gateway, getOperationContext: async () => context, verifyOperationContext: async (value) => { assert(value === context, 'Operation context identity changed.'); verifies += 1 }, isOffline: () => false })
    const saved = await repository.updateMarketRegion({ farmId, marketRegion: 'IL', expectedUpdatedAt })
    assert(saved.market_region === 'IL' && saved.updated_at === savedUpdatedAt, 'The server-confirmed region was not returned.')
    assert(gateway.calls.length === 1 && gateway.calls[0]!.context === context && gateway.calls[0]!.input.marketRegion === 'IL', 'The exact captured context was not bound to one request.')
    assert(verifies === 2, 'The operation context must be verified before and after the request.')
  }

  {
    // Clearing the region is a real setting ("no feed"), confirmed the same way.
    const gateway = new FakeGateway(); gateway.result = farmRow({ market_region: null })
    const repository = new SupabaseFarmSettingsRepository({ gateway, getOperationContext: async () => context, verifyOperationContext: async () => undefined, isOffline: () => false })
    const saved = await repository.updateMarketRegion({ farmId, marketRegion: null, expectedUpdatedAt })
    assert(saved.market_region === null && gateway.calls[0]!.input.marketRegion === null, 'Clearing the region round-trips as null.')
  }

  for (const [label, region] of [['lower-case', 'il'], ['a name', 'Illinois'], ['blank', ''], ['unknown', 'ZZ']] as const) {
    const gateway = new FakeGateway()
    const repository = new SupabaseFarmSettingsRepository({ gateway, getOperationContext: async () => context, verifyOperationContext: async () => undefined, isOffline: () => false })
    await rejects(() => repository.updateMarketRegion({ farmId, marketRegion: region, expectedUpdatedAt }), /could not prepare/)
    assert(gateway.calls.length === 0, `${label} region must be refused before any request.`)
  }

  {
    const gateway = new FakeGateway()
    const repository = new SupabaseFarmSettingsRepository({ gateway, getOperationContext: async () => context, verifyOperationContext: async () => undefined, isOffline: () => true })
    await rejects(() => repository.updateMarketRegion({ farmId, marketRegion: 'IL', expectedUpdatedAt }), /Connect to the internet/)
    assert(gateway.calls.length === 0, 'An offline region change must never be sent or queued.')
  }

  {
    const gateway = new FakeGateway()
    const repository = new SupabaseFarmSettingsRepository({ gateway, getOperationContext: async () => ({ ...context, farmId: otherFarmId }), verifyOperationContext: async () => undefined, isOffline: () => false })
    await rejects(() => repository.updateMarketRegion({ farmId, marketRegion: 'IL', expectedUpdatedAt }), /selected farm changed/)
    assert(gateway.calls.length === 0, 'A cross-farm request must fail before reaching the gateway.')
  }

  for (const [label, result] of [
    ['wrong farm', farmRow({ id: otherFarmId })],
    ['wrong region', farmRow({ market_region: 'IA' })],
    ['region missing from the row', farmRow({ market_region: undefined })],
    ['stale timestamp', farmRow({ updated_at: expectedUpdatedAt })],
    ['malformed row', { id: farmId, market_region: 'IL' }],
  ] as const) {
    const gateway = new FakeGateway(); gateway.result = result
    const repository = new SupabaseFarmSettingsRepository({ gateway, getOperationContext: async () => context, verifyOperationContext: async () => undefined, isOffline: () => false })
    await rejects(() => repository.updateMarketRegion({ farmId, marketRegion: 'IL', expectedUpdatedAt }), /could not confirm|missing its|malformed/)
    assert(gateway.calls.length === 1, `${label} proof did not exercise the server response.`)
  }

  console.log('SupabaseFarmSettingsRepository regressions passed (market region list, confirmed save, clear, refusals, offline, cross-farm, server response).')
}

run().catch((error) => { console.error(error); process.exit(1) })
