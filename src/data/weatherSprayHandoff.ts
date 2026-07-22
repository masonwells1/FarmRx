export type ManualSprayRecordIntent = Readonly<{ kind: 'manual-spray-record'; version: 1 }>

export const manualSprayRecordIntent: ManualSprayRecordIntent = Object.freeze({
  kind: 'manual-spray-record',
  version: 1,
})

export function isManualSprayRecordIntent(value: unknown): value is ManualSprayRecordIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).sort().join(',') === 'kind,version'
    && row.kind === 'manual-spray-record'
    && row.version === 1
}
