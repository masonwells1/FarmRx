/** A Today record tile opens an existing module form. The tile hands the destination this intent through router state so the
 * page can open the right form at once (the rainfall entry on the Field Log, the new-task form on Tasks); nothing is written
 * until the farmer saves that form, exactly as if they had tapped the module's own button. */
export type TodayRecordIntent = Readonly<{ kind: 'today-record'; version: 1; record: 'rainfall' | 'task' }>

export function todayRecordIntent(record: TodayRecordIntent['record']): TodayRecordIntent { return Object.freeze({ kind: 'today-record', version: 1, record }) }

export function parseTodayRecordIntent(value: unknown): TodayRecordIntent | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'today-record' || candidate.version !== 1) return null
  return candidate.record === 'rainfall' || candidate.record === 'task' ? todayRecordIntent(candidate.record) : null
}
