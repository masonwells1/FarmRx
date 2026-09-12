import type { FarmOperationContext } from './farmOperationContext'
import type { SoilTestDraft, SoilReportMime } from './soilRx'
export interface SoilRxDataGateway {
  loadTests(farmId: string, fieldId?: string): Promise<unknown[]>
  loadAttachments(farmId: string, testId?: string): Promise<unknown[]>
  saveTest(input: { farmId: string; userId: string; draft: SoilTestDraft }, context: FarmOperationContext): Promise<unknown>
  saveAttachment(input: { id: string; farmId: string; fieldId: string; testId: string; storagePath: string; originalFilename: string; mimeType: SoilReportMime; sizeBytes: number; userId: string }, context: FarmOperationContext): Promise<unknown>
  deleteTest(input: { farmId: string; testId: string }, context: FarmOperationContext): Promise<unknown>
  verifyTestAbsent(input: { farmId: string; testId: string }, context: FarmOperationContext): Promise<unknown>
}
