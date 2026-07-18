import type { FarmOperationContext } from './farmOperationContext'
import type { FarmSharingGateway, FarmSharingInput } from './farmSharing'
import { SupabaseFarmSharingRepository } from './SupabaseFarmSharingRepository'

const farmId = '11111111-1111-4111-8111-111111111111'
const otherFarmId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const expectedUpdatedAt = '2026-07-18T12:00:00.000Z'
const savedUpdatedAt = '2026-07-18T12:01:00.000Z'
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
  return {
    id: farmId,
    name: 'Wells Farm',
    share_with_rep: true,
    created_by: userId,
    created_at: '2026-07-01T12:00:00.000Z',
    updated_at: savedUpdatedAt,
    ...overrides,
  }
}

class FakeGateway implements FarmSharingGateway {
  calls: Array<{ input: FarmSharingInput; context: FarmOperationContext }> = []
  result: unknown = farmRow()
  async updateFarmSharing(input: FarmSharingInput, operationContext: FarmOperationContext) {
    this.calls.push({ input, context: operationContext })
    return this.result
  }
}

async function run() {
  {
    const gateway = new FakeGateway()
    let verifies = 0
    const repository = new SupabaseFarmSharingRepository({ gateway, getOperationContext: async () => context, verifyOperationContext: async (value) => { assert(value === context, 'Operation context identity changed.'); verifies += 1 }, isOffline: () => false })
    const saved = await repository.updateShareWithRep({ farmId, shareWithRep: true, expectedUpdatedAt })
    assert(saved.share_with_rep === true && saved.updated_at === savedUpdatedAt, 'The server-confirmed setting was not returned.')
    assert(gateway.calls.length === 1 && gateway.calls[0]!.context === context, 'The exact captured context was not bound to one request.')
    assert(verifies === 2, 'The operation context must be verified before and after the request.')
  }

  {
    const gateway = new FakeGateway()
    const repository = new SupabaseFarmSharingRepository({ gateway, getOperationContext: async () => context, verifyOperationContext: async () => undefined, isOffline: () => true })
    await rejects(() => repository.updateShareWithRep({ farmId, shareWithRep: true, expectedUpdatedAt }), /Connect to the internet/)
    assert(gateway.calls.length === 0, 'An offline privacy change must never be sent or queued.')
  }

  {
    const gateway = new FakeGateway()
    const repository = new SupabaseFarmSharingRepository({ gateway, getOperationContext: async () => ({ ...context, farmId: otherFarmId }), verifyOperationContext: async () => undefined, isOffline: () => false })
    await rejects(() => repository.updateShareWithRep({ farmId, shareWithRep: true, expectedUpdatedAt }), /selected farm changed/)
    assert(gateway.calls.length === 0, 'A cross-farm request must fail before reaching the gateway.')
  }

  for (const [label, result] of [
    ['wrong farm', farmRow({ id: otherFarmId })],
    ['wrong setting', farmRow({ share_with_rep: false })],
    ['stale timestamp', farmRow({ updated_at: expectedUpdatedAt })],
    ['malformed row', { id: farmId, share_with_rep: true }],
  ] as const) {
    const gateway = new FakeGateway(); gateway.result = result
    const repository = new SupabaseFarmSharingRepository({ gateway, getOperationContext: async () => context, verifyOperationContext: async () => undefined, isOffline: () => false })
    await rejects(() => repository.updateShareWithRep({ farmId, shareWithRep: true, expectedUpdatedAt }), /could not confirm|missing its/)
    assert(gateway.calls.length === 1, `${label} proof did not exercise the server response.`)
  }

  {
    const gateway = new FakeGateway()
    let verifies = 0
    const repository = new SupabaseFarmSharingRepository({ gateway, getOperationContext: async () => context, verifyOperationContext: async () => { verifies += 1; if (verifies === 2) throw new Error('The signed-in account or selected farm changed before this operation could finish.') }, isOffline: () => false })
    await rejects(() => repository.updateShareWithRep({ farmId, shareWithRep: true, expectedUpdatedAt }), /selected farm changed/)
    assert(verifies === 2, 'A farm switch after the response was not detected.')
  }

  {
    const gateway = new FakeGateway()
    const repository = new SupabaseFarmSharingRepository({ gateway, getOperationContext: async () => context, verifyOperationContext: async () => undefined, isOffline: () => false })
    await rejects(() => repository.updateShareWithRep({ farmId: 'not-a-farm', shareWithRep: true, expectedUpdatedAt }), /could not prepare/)
    assert(gateway.calls.length === 0, 'Malformed input must fail before the request.')
  }
}

void run().then(() => console.log('SupabaseFarmSharingRepository regressions passed.'))
