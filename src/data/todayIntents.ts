/** A Today record tile opens an existing module form. The tile hands the destination this intent through router state so the
 * page can open the right form at once (the rainfall entry on the Field Log, the new scouting note, the new-task form on Tasks,
 * the harvest entry, or the contract delivery controls on Grain); nothing is written until the farmer saves that form, exactly
 * as if they had tapped the module's own button. */
export type TodayRecordKindIntent = 'rainfall' | 'scouting' | 'task' | 'harvest' | 'grain_delivery'
export type TodayRecordIntent = Readonly<{ kind: 'today-record'; version: 1; record: TodayRecordKindIntent }>
const records: ReadonlySet<string> = new Set<TodayRecordKindIntent>(['rainfall', 'scouting', 'task', 'harvest', 'grain_delivery'])

export function todayRecordIntent(record: TodayRecordIntent['record']): TodayRecordIntent { return Object.freeze({ kind: 'today-record', version: 1, record }) }

export function parseTodayRecordIntent(value: unknown): TodayRecordIntent | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'today-record' || candidate.version !== 1) return null
  return typeof candidate.record === 'string' && records.has(candidate.record) ? todayRecordIntent(candidate.record as TodayRecordKindIntent) : null
}
