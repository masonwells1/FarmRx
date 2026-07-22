import { DueProgramItemsService, localCalendarDate, replayProgramsThenGenerateDueItems, type DueProgramItemsGateway } from './programDueItems'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1)
const context = { projectRef: 'test', userId: uid(2), farmId: farm, generation: 1, token: uid(900), serverEpoch: 1 }
const operationDependencies = { getFarmId: async () => farm, getOperationContext: async () => context, verifyOperationContext: async () => undefined }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

class FakeGateway implements DueProgramItemsGateway {
  calls: Array<{ farmId: string; operationId: string; localDate: string }> = []
  statusCalls: string[] = []
  v2Calls: Array<{ farmId: string; operationId: string }> = []
  status: unknown = { has_due: true, task_needed: true, notification_needed: true, local_date: '2026-07-12' }
  statusFailure: Error | null = null
  v2Failure: Error | null = null
  receipts = new Map<string, { taskCycle: string; notificationCycle: string }>()
  taskCycles = new Set<string>()
  notificationCycles = new Set<string>()
  failure: Error | null = null

  async getDueGenerationStatus(farmId: string) { this.statusCalls.push(farmId); if (this.statusFailure) throw this.statusFailure; return this.status }
  v2Result: unknown = { operation_kind: 'generate_due_program_items_v2', task_created_count: 1, notification_created_count: 1, local_date: '2026-07-12' }
  async generateDueProgramItemsV2(input: { farmId: string; operationId: string }) { this.v2Calls.push(input); if (this.v2Failure) throw this.v2Failure; return this.v2Result }

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
  // Startup preflight is strict: false allocates no operation ID, true allocates
  // exactly one, malformed replies and either network stage fail closed.
  let falseIds = 0; const falseGateway = new FakeGateway(); falseGateway.status = { has_due: false, task_needed: false, notification_needed: false, local_date: '2026-07-12' }; const falseService = new DueProgramItemsService({ gateway: falseGateway, ...operationDependencies, createId: () => { falseIds += 1; return uid(5) } })
  assert(await falseService.generateIfDueStrict() === 'not-due' && falseIds === 0 && falseGateway.v2Calls.length === 0, 'A false Program preflight allocated an ID or invoked v2 generation.')
  let trueIds = 0; const trueGateway = new FakeGateway(); const trueService = new DueProgramItemsService({ gateway: trueGateway, ...operationDependencies, createId: () => { trueIds += 1; return uid(6) } })
  assert(await trueService.generateIfDueStrict() === 'generated' && trueIds === 1 && trueGateway.v2Calls.length === 1 && trueGateway.v2Calls[0]?.farmId === farm && trueGateway.v2Calls[0]?.operationId === uid(6), 'A true Program preflight did not invoke v2 exactly once with the allocated ID.')
  const malformedGateway = new FakeGateway(); malformedGateway.status = { has_due: false, task_needed: true, notification_needed: false, local_date: '2026-07-12' }; let malformedRejected = false; try { await new DueProgramItemsService({ gateway: malformedGateway, ...operationDependencies, createId: () => uid(7) }).generateIfDueStrict() } catch { malformedRejected = true }; assert(malformedRejected && malformedGateway.v2Calls.length === 0, 'A malformed Program status did not fail closed.')
  for (const malformedReceipt of [null, { operation_kind: 'wrong', task_created_count: 1, notification_created_count: 1, local_date: '2026-07-12' }, { operation_kind: 'generate_due_program_items_v2', task_created_count: -1, notification_created_count: 1, local_date: '2026-07-12' }, { operation_kind: 'generate_due_program_items_v2', task_created_count: 1, notification_created_count: 1, local_date: '2026-02-30' }]) { const failed = new FakeGateway(); failed.v2Result = malformedReceipt; let rejected = false; try { await new DueProgramItemsService({ gateway: failed, ...operationDependencies, createId: () => uid(71) }).generateIfDueStrict() } catch { rejected = true }; assert(rejected, 'A malformed Program v2 receipt did not fail closed.') }
  for (const stage of ['status', 'v2'] as const) { const failed = new FakeGateway(); if (stage === 'status') failed.statusFailure = new Error('status offline'); else failed.v2Failure = new Error('v2 offline'); let rejected = false; try { await new DueProgramItemsService({ gateway: failed, ...operationDependencies, createId: () => uid(8) }).generateIfDueStrict() } catch (error) { rejected = error instanceof Error && error.message === `${stage} offline` }; assert(rejected, `Program ${stage} failure was swallowed.`) }
  for (const failVerifyCall of [2, 3, 4]) { const switched = new FakeGateway(); let verifies = 0; let ids = 0; const service = new DueProgramItemsService({ gateway: switched, getFarmId: async () => farm, getOperationContext: async () => context, verifyOperationContext: async () => { verifies += 1; if (verifies === failVerifyCall) throw new Error('context switched') }, createId: () => { ids += 1; return uid(9) } }); let rejected = false; try { await service.generateIfDueStrict() } catch { rejected = true }; assert(rejected && (failVerifyCall === 2 ? ids === 0 && switched.v2Calls.length === 0 : failVerifyCall === 3 ? ids === 0 && switched.v2Calls.length === 0 : ids === 1 && switched.v2Calls.length === 1), `Program context switch at verification ${failVerifyCall} crossed the wrong stage.`) }

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

  // Group 4: startup/reconnect uses the strict path so the farm gate remains
  // blocked and retryable instead of silently opening without due work.
  let strictRejected = false; try { await bestEffort.generateStrict() } catch (error) { strictRejected = error instanceof Error && error.message === 'offline' }
  assert(strictRejected, 'The strict Programs due-generation path swallowed a startup failure.')

  // Group 5: reconnect replays queued Programs writes before one un-awaited due scan, using a farm-local date at UTC midnight.
  const events: string[] = []; await replayProgramsThenGenerateDueItems(async () => { events.push('programs-replayed') }, async () => { events.push('due-generated'); return 'generated' }); assert(events.join(',') === 'programs-replayed,due-generated', 'Reconnect must start due generation only after queued Programs writes resolve.'); const serverCurrentDate = '2026-07-12'; const midnightLocalDate = localCalendarDate(new Date('2026-07-12T00:30:00.000Z')); const dateDistance = Math.abs((Date.parse(`${midnightLocalDate}T00:00:00Z`) - Date.parse(`${serverCurrentDate}T00:00:00Z`)) / 86400000); const midnightGateway = new FakeGateway(); const midnight = new DueProgramItemsService({ gateway: midnightGateway, ...operationDependencies, createId: () => uid(40), today: () => midnightLocalDate }); await midnight.generate(); assert(midnightGateway.calls[0]?.localDate === midnightLocalDate && dateDistance <= 1, 'The UTC-midnight scan must send the farm-local calendar date, within the RPC one-day server-date bound.')
  console.log('programDueItems regression passed (startup preflight plus 5 legacy coverage groups)')
}
void run()
