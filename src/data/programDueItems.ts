import { supabase } from '../lib/supabaseClient'
import { farmLocalCalendarDate } from './farmDates'

export interface DueProgramItemsGateway {
  generateDueProgramItems(input: { farmId: string; operationId: string; localDate: string }): Promise<unknown>
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
  constructor(private readonly d: { gateway: DueProgramItemsGateway; getFarmId: () => Promise<string>; createId: () => string; today?: () => string }) {}

  async generate() { return this.generateOperation(this.d.createId()) }

  async generateOperation(operationId: string): Promise<'generated' | 'skipped'> {
    try {
      await this.d.gateway.generateDueProgramItems({ farmId: await this.d.getFarmId(), operationId, localDate: this.d.today?.() ?? localCalendarDate() })
      return 'generated'
    } catch {
      return 'skipped'
    }
  }
}

export class SupabaseDueProgramItemsGateway implements DueProgramItemsGateway {
  async generateDueProgramItems(input: { farmId: string; operationId: string; localDate: string }) {
    const result = await supabase.rpc('generate_due_program_items', { p_farm_id: input.farmId, p_operation_id: input.operationId, p_local_date: input.localDate })
    if (result.error) throw result.error
    return result.data
  }
}
