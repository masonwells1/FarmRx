/** A Today record tile opens an existing module form. The tile hands the destination this intent through router state so the
 * page can open the right form at once (the rainfall entry on the Field Log, the new scouting note, the new-task form on Tasks,
 * the harvest entry, or the contract delivery controls on Grain); nothing is written until the farmer saves that form, exactly
 * as if they had tapped the module's own button. */
export type TodayRecordKindIntent = 'rainfall' | 'scouting' | 'task' | 'harvest' | 'grain_delivery'
export type TodayRecordIntent = Readonly<{ kind: 'today-record'; version: 1; record: TodayRecordKindIntent }>
const records: ReadonlySet<string> = new Set<TodayRecordKindIntent>(['rainfall', 'scouting', 'task', 'harvest', 'grain_delivery'])

export function todayRecordIntent(record: TodayRecordIntent['record']): TodayRecordIntent { return Object.freeze({ kind: 'today-record', version: 1, record }) }

/** Today's grain line opens the Grain Overview on the estimate the line summarized, so both screens show the same numbers. */
export type TodayGrainLineIntent = Readonly<{ kind: 'today-grain-line'; version: 1; estimateId: string }>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function todayGrainLineIntent(estimateId: string): TodayGrainLineIntent { return Object.freeze({ kind: 'today-grain-line', version: 1, estimateId }) }
export function parseTodayGrainLineIntent(value: unknown): TodayGrainLineIntent | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'today-grain-line' || candidate.version !== 1) return null
  return typeof candidate.estimateId === 'string' && uuid.test(candidate.estimateId) ? todayGrainLineIntent(candidate.estimateId) : null
}

export function parseTodayRecordIntent(value: unknown): TodayRecordIntent | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'today-record' || candidate.version !== 1) return null
  return typeof candidate.record === 'string' && records.has(candidate.record) ? todayRecordIntent(candidate.record as TodayRecordKindIntent) : null
}
