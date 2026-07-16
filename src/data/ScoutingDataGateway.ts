import type { ScoutingNoteDraft } from './scouting'
import type { FarmOperationContext } from './farmOperationContext'
export interface ScoutingDataGateway { loadNotes(farmId: string, fieldId?: string): Promise<unknown[]>; loadPhotos(farmId: string): Promise<unknown[]>; loadViewerRole(farmId: string, userId: string): Promise<unknown>; saveNote(input: { farmId: string; operationId: string; note: ScoutingNoteDraft }, context: FarmOperationContext): Promise<unknown>; deleteNote(input: { farmId: string; noteId: string }, context: FarmOperationContext): Promise<unknown> }
