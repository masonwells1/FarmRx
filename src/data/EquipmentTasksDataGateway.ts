import type { EquipmentWrite, IntervalWrite, MeterReadingWrite, ServiceLogWrite, TaskWrite } from './equipmentTasks'
import type { FarmOperationContext } from './farmOperationContext'
export interface EquipmentTasksRowBundle { viewer: unknown; equipment: unknown[]; meter_readings: unknown[]; intervals: unknown[]; service_log: unknown[]; service_due: unknown[]; members: unknown[]; tasks: unknown[] }
export interface EquipmentTasksDataGateway {
  getOperationalIntegrityCapability?(): Promise<boolean>
  getDueServiceGenerationStatus(farmId: string, context: FarmOperationContext): Promise<unknown>
  generateDueServiceTasksV2(farmId: string, operationId: string, context: FarmOperationContext): Promise<unknown>
  generateDueServiceTasks(farmId: string, context: FarmOperationContext): Promise<unknown>
  loadWorkspace(farmId: string, viewerId: string): Promise<EquipmentTasksRowBundle>
  saveEquipment(farmId: string, value: EquipmentWrite, context: FarmOperationContext): Promise<unknown>
  addMeterReading(farmId: string, value: MeterReadingWrite, context: FarmOperationContext): Promise<unknown>
  saveInterval(farmId: string, value: IntervalWrite, context: FarmOperationContext): Promise<unknown>
  addServiceLogEntry(farmId: string, value: ServiceLogWrite, context: FarmOperationContext): Promise<unknown>
  saveTask(farmId: string, value: TaskWrite, context: FarmOperationContext): Promise<unknown>
  deleteTask(farmId: string, id: string, context: FarmOperationContext): Promise<unknown>
  deleteServiceLogEntry(farmId: string, id: string, context: FarmOperationContext): Promise<unknown>
  deleteInterval(farmId: string, id: string, context: FarmOperationContext): Promise<unknown>
}
