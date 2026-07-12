import type { FieldLogEntryDraft } from './fieldLog'

export interface FieldLogDataGateway {
  loadEntries(farmId: string, fieldId?: string): Promise<unknown[]>
  loadViewerRole(farmId: string, userId: string): Promise<unknown>
  saveEntry(input: { farmId: string; operationId: string; entry: FieldLogEntryDraft }): Promise<unknown>
  deleteEntry(input: { farmId: string; entryId: string }): Promise<unknown>
}
