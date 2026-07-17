import { supabase } from '../lib/supabaseClient'
import { farmLocalCalendarDate } from './farmDates'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'

export interface DueProgramItemsGateway {
  generateDueProgramItems(input: { farmId: string; operationId: string; localDate: string }, context: FarmOperationContext): Promise<unknown>
}

export function localCalendarDate(now = new Date()) {
  return farmLocalCalendarDate(now)
}

/** Replay first: an offline assignment or reschedule cannot have a due item until
 * its Programs write is canonical. Generation remains deliberately un-awaited. */
export async function replayProgramsThenGenerateDueItems(replayProgramsQueue: () => Promise<void>, generateDueItems: () => Promise<unknown>) {
  await replayProgramsQueue()
  void generateDueItems().catch(() => undefined)
}

/**
 * Due-item generation is deliberately opportunistic. The database owns the
 * idempotency receipts and per-cycle unique keys, so an unavailable request is
 * skipped and retried by a later app/Programs/Alerts refresh.
 */
export class DueProgramItemsService {
  constructor(private readonly d: { gateway: DueProgramItemsGateway; getFarmId: () => Promise<string>; getOperationContext: () => Promise<FarmOperationContext>; verifyOperationContext: (expected: FarmOperationContext) => Promise<void>; createId: () => string; today?: () => string }) {}

  async generate() { return this.generateOperation(this.d.createId()) }
  async generateStrict() { return this.generateOperationStrict(this.d.createId()) }

  async generateOperation(operationId: string): Promise<'generated' | 'skipped'> {
    try { return await this.generateOperationStrict(operationId) } catch { return 'skipped' }
  }

  async generateOperationStrict(operationId: string): Promise<'generated'> {
    const context = await this.d.getOperationContext(); await this.d.verifyOperationContext(context)
    await this.d.gateway.generateDueProgramItems({ farmId: context.farmId, operationId, localDate: this.d.today?.() ?? localCalendarDate() }, context)
    await this.d.verifyOperationContext(context)
    return 'generated'
  }
}

export class SupabaseDueProgramItemsGateway implements DueProgramItemsGateway {
  async generateDueProgramItems(input: { farmId: string; operationId: string; localDate: string }, context: FarmOperationContext) {
    const result = await bindFarmOperationRequest(supabase.rpc('generate_due_program_items', { p_farm_id: input.farmId, p_operation_id: input.operationId, p_local_date: input.localDate }), context)
    if (result.error) throw result.error
    return result.data
  }
}
