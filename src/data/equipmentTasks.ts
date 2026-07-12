import type { FieldsData } from './fields'

export type EquipmentCategory = 'tractor' | 'combine' | 'sprayer' | 'truck' | 'trailer' | 'header' | 'tillage' | 'planter' | 'grain_cart' | 'utility' | 'other'
export type EquipmentStatus = 'active' | 'sold' | 'retired'
export type MeterUnit = 'hours' | 'miles'
export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskPriority = 'normal' | 'high' | 'urgent'
export interface Equipment { id: string; farm_id: string; name: string; category: EquipmentCategory; make: string | null; model: string | null; model_year: number | null; serial_or_vin: string | null; purchase_date: string | null; purchase_price: number | null; meter_unit: MeterUnit; warranty_expires_on: string | null; warranty_notes: string | null; status: EquipmentStatus; notes: string | null; created_by: string; created_at: string; updated_at: string }
export interface MeterReading { id: string; farm_id: string; equipment_id: string; reading: number; read_on: string; source: 'manual' | 'service'; notes: string | null; created_by: string; created_at: string; updated_at: string }
export interface ServiceInterval { id: string; farm_id: string; equipment_id: string; name: string; every_meter: number | null; every_months: number | null; last_done_on: string | null; last_done_reading: number | null; is_active: boolean; created_by: string; created_at: string; updated_at: string }
export interface ServiceLogEntry { id: string; farm_id: string; equipment_id: string; service_date: string; work_performed: string; parts: string | null; vendor: string | null; cost: number | null; meter_reading: number | null; interval_id: string | null; created_by: string; created_at: string; updated_at: string }
export interface ServiceDue { farm_id: string; equipment_id: string; interval_id: string; reason: 'meter' | 'calendar'; overdue_amount: number }
export interface FarmMemberName { farm_id: string; user_id: string; display_name: string }
export interface FarmTask { id: string; farm_id: string; title: string; details: string | null; status: TaskStatus; priority: TaskPriority; assigned_to: string | null; due_on: string | null; field_id: string | null; equipment_id: string | null; source: 'manual' | 'service_interval'; interval_id: string | null; interval_cycle_key: string | null; completed_by: string | null; completed_at: string | null; created_by: string; created_at: string; updated_at: string }
export interface EquipmentTasksWorkspace { fields: FieldsData; viewer: { user_id: string; role: 'owner' | 'manager' | 'worker' | 'read_only' }; equipment: Equipment[]; meter_readings: MeterReading[]; intervals: ServiceInterval[]; service_log: ServiceLogEntry[]; service_due: ServiceDue[]; members: FarmMemberName[]; tasks: FarmTask[] }
export type EquipmentWrite = Omit<Equipment, 'created_by' | 'created_at' | 'updated_at'>
export type MeterReadingWrite = Omit<MeterReading, 'farm_id' | 'created_by' | 'created_at' | 'updated_at'>
export type IntervalWrite = Omit<ServiceInterval, 'farm_id' | 'created_by' | 'created_at' | 'updated_at'>
export type TaskWrite = Omit<FarmTask, 'farm_id' | 'created_by' | 'created_at' | 'updated_at' | 'completed_by' | 'completed_at'>
export type ServiceLogWrite = Omit<ServiceLogEntry, 'farm_id' | 'created_by' | 'created_at' | 'updated_at'> & { reading_id: string | null }
export type ServiceLogEntryInput = Omit<ServiceLogWrite, 'reading_id'>
export interface EquipmentTasksRepository { getWorkspace(): Promise<EquipmentTasksWorkspace>; saveEquipment(value: EquipmentWrite): Promise<void>; addMeterReading(value: MeterReadingWrite): Promise<void>; saveInterval(value: IntervalWrite): Promise<void>; addServiceLogEntry(value: ServiceLogEntryInput): Promise<void>; saveTask(value: TaskWrite): Promise<void>; deleteTask(id: string): Promise<void>; deleteServiceLogEntry(id: string): Promise<void>; deleteInterval(id: string): Promise<void> }
