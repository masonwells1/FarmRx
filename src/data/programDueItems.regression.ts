import { DueProgramItemsService, localCalendarDate, replayProgramsThenGenerateDueItems, type DueProgramItemsGateway } from './programDueItems'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1)
const context = { projectRef: 'test', userId: uid(2), farmId: farm, generation: 1, token: uid(900), serverEpoch: 1 }
const operationDependencies = { getFarmId: async () => farm, getOperationContext: async () => context, verifyOperationContext: async () => undefined }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

class FakeGateway implements DueProgramItemsGateway {
  calls: Array<{ farmId: string; operationId: string; localDate: string }> = []
  receipts = new Map<string, { taskCycle: string; notificationCycle: string }>()
  taskCycles = new Set<string>()
  notificationCycles = new Set<string>()
  failure: Error | null = null

  async generateDueProgramItems(input: { farmId: string; operationId: string; localDate: string }) {
    this.calls.push(input)
    if (this.failure) throw this.failure
    const prior = this.receipts.get(input.operationId)
    if (prior) return prior
    const receipt = { taskCycle: 'due:pass-1:2026-07-12', notificationCycle: 'program:pass-1:due:2026-07-12' }
    this.taskCycles.add(receipt.taskCycle)
    this.notificationCycles.add(receipt.notificationCycle)
    this.receipts.set(input.operationId, receipt)
    return receipt
  }
}

async function run() {
  // Group 1: the exact same operation receipt can be replayed without another card or alert.
  const replayGateway = new FakeGateway(); const replay = new DueProgramItemsService({ gateway: replayGateway, ...operationDependencies, createId: () => uid(10), today: () => '2026-07-12' })
  assert(await replay.generateOperation(uid(10)) === 'generated' && await replay.generateOperation(uid(10)) === 'generated' && replayGateway.taskCycles.size === 1 && replayGateway.notificationCycles.size === 1, 'Replaying one due-generation operation must preserve exactly one task cycle and one notification cycle.')

  // Group 2: separate refresh calls get fresh operation IDs while database cycle keys keep them deduped.
  let next = 20; const dedupeGateway = new FakeGateway(); const dedupe = new DueProgramItemsService({ gateway: dedupeGateway, ...operationDependencies, createId: () => uid(next++), today: () => '2026-07-12' })
  await dedupe.generate(); await dedupe.generate()
  assert(dedupeGateway.calls.map((call) => call.operationId).join(',') === `${uid(20)},${uid(21)}` && dedupeGateway.taskCycles.size === 1 && dedupeGateway.notificationCycles.size === 1, 'Each refresh must send a fresh operation ID without duplicating the due task or notification cycle.')

  // Group 3: a generation outage is swallowed so the triggering screen or save continues.
  const failingGateway = new FakeGateway(); failingGateway.failure = new Error('offline'); const bestEffort = new DueProgramItemsService({ gateway: failingGateway, ...operationDependencies, createId: () => uid(30), today: () => '2026-07-12' })
  assert(await bestEffort.generate() === 'skipped', 'A due-generation failure must be swallowed by the best-effort service.')

  // Group 4: reconnect replays queued Programs writes before one un-awaited due scan, using a farm-local date at UTC midnight.
  const events: string[] = []; await replayProgramsThenGenerateDueItems(async () => { events.push('programs-replayed') }, async () => { events.push('due-generated'); return 'generated' }); assert(events.join(',') === 'programs-replayed,due-generated', 'Reconnect must start due generation only after queued Programs writes resolve.'); const serverCurrentDate = '2026-07-12'; const midnightLocalDate = localCalendarDate(new Date('2026-07-12T00:30:00.000Z')); const dateDistance = Math.abs((Date.parse(`${midnightLocalDate}T00:00:00Z`) - Date.parse(`${serverCurrentDate}T00:00:00Z`)) / 86400000); const midnightGateway = new FakeGateway(); const midnight = new DueProgramItemsService({ gateway: midnightGateway, ...operationDependencies, createId: () => uid(40), today: () => midnightLocalDate }); await midnight.generate(); assert(midnightGateway.calls[0]?.localDate === midnightLocalDate && dateDistance <= 1, 'The UTC-midnight scan must send the farm-local calendar date, within the RPC one-day server-date bound.')
  console.log('programDueItems regression passed (4 coverage groups)')
}
void run()
