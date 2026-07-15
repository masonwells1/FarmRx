import { supabase } from '../lib/supabaseClient'

export const STALE_WRITE_CODE = 'FARM_RX_STALE_WRITE'
export const STALE_WRITE_MESSAGE = 'This record changed in another tab or device. Reload before saving again.'

export class StaleWriteConflictError extends Error {
  readonly code = STALE_WRITE_CODE
  readonly status = 409
  constructor() { super(STALE_WRITE_CODE); this.name = 'StaleWriteConflictError' }
}

type Row = Record<string, unknown>

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, comparable(item)]))
  return value
}

/** Compares only the columns the caller intended to write. Server audit columns
 * and trigger-managed timestamps are deliberately ignored. */
export function sameOptimisticWrite(row: Row, columns: Row): boolean {
  return Object.entries(columns).every(([key, value]) => JSON.stringify(comparable(row[key])) === JSON.stringify(comparable(value)))
}

async function current(table: string, farmId: string, idColumn: string, id: string): Promise<Row | null> {
  const result = await supabase.from(table).select('*').eq('farm_id', farmId).eq(idColumn, id).maybeSingle()
  if (result.error) throw result.error
  return result.data as Row | null
}

/** Compare-and-swap save for mutable farm rows, with identical lost-response
 * retries treated as idempotent success. */
export async function optimisticSave(table: string, farmId: string, id: string, columns: Row, expectedUpdatedAt: string | null | undefined, idColumn = 'id'): Promise<Row> {
  const existing = await current(table, farmId, idColumn, id)
  if (existing) {
    if (sameOptimisticWrite(existing, columns)) return existing
    if (!expectedUpdatedAt || existing.updated_at !== expectedUpdatedAt) throw new StaleWriteConflictError()
    const updated = await supabase.from(table).update(columns).eq('farm_id', farmId).eq(idColumn, id).eq('updated_at', expectedUpdatedAt).select('*').maybeSingle()
    if (updated.error) throw updated.error
    if (updated.data) return updated.data as Row
    const after = await current(table, farmId, idColumn, id)
    if (after && sameOptimisticWrite(after, columns)) return after
    throw new StaleWriteConflictError()
  }

  const inserted = await supabase.from(table).insert(columns).select('*').maybeSingle()
  if (!inserted.error && inserted.data) return inserted.data as Row
  if (inserted.error?.code !== '23505') throw inserted.error ?? new Error('Farm Rx could not confirm that save.')
  const after = await current(table, farmId, idColumn, id)
  if (after && sameOptimisticWrite(after, columns)) return after
  throw new StaleWriteConflictError()
}
