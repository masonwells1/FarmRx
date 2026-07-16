import type { FieldLogEntryDraft } from './fieldLog'
import type { FarmOperationContext } from './farmOperationContext'

export interface FieldLogDataGateway {
  loadEntries(farmId: string, fieldId?: string): Promise<unknown[]>
  loadViewerRole(farmId: string, userId: string): Promise<unknown>
  saveEntry(input: { farmId: string; operationId: string; entry: FieldLogEntryDraft }, context: FarmOperationContext): Promise<unknown>
  deleteEntry(input: { farmId: string; entryId: string }, context: FarmOperationContext): Promise<unknown>
}
