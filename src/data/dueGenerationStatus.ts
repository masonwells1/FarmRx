export type DueGenerationStatus = { has_due: boolean; task_needed: boolean; notification_needed: boolean; local_date: string }
export type DueGenerationReceipt = { operation_kind: string; task_created_count: number; notification_created_count: number; local_date: string }

function parseLocalDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

export function parseDueGenerationStatus(value: unknown): DueGenerationStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Farm Rx could not verify due work.')
  const row = value as Record<string, unknown>
  const localDate = parseLocalDate(row.local_date)
  if (typeof row.has_due !== 'boolean' || typeof row.task_needed !== 'boolean' || typeof row.notification_needed !== 'boolean' || !localDate || row.has_due !== (row.task_needed || row.notification_needed)) throw new Error('Farm Rx could not verify due work.')
  return { has_due: row.has_due, task_needed: row.task_needed, notification_needed: row.notification_needed, local_date: localDate }
}

export function parseDueGenerationReceipt(value: unknown, expectedOperationKind: string): DueGenerationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Farm Rx could not verify generated due work.')
  const row = value as Record<string, unknown>
  const localDate = parseLocalDate(row.local_date)
  const taskCount = row.task_created_count
  const notificationCount = row.notification_created_count
  if (Object.keys(row).sort().join('|') !== 'local_date|notification_created_count|operation_kind|task_created_count' || row.operation_kind !== expectedOperationKind || !Number.isSafeInteger(taskCount) || (taskCount as number) < 0 || !Number.isSafeInteger(notificationCount) || (notificationCount as number) < 0 || !localDate) throw new Error('Farm Rx could not verify generated due work.')
  return { operation_kind: expectedOperationKind, task_created_count: taskCount as number, notification_created_count: notificationCount as number, local_date: localDate }
}
