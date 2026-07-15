import type { FieldsRepository } from './fields'
import type { HarvestDataGateway } from './HarvestDataGateway'
import { roundDecimalHalfUp } from './decimal'
import { canEditHarvest, validateHarvestDraft, type FarmViewerRole, type HarvestData, type HarvestDraft, type HarvestRecord, type HarvestRepository } from './harvest'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const roles = new Set<FarmViewerRole>(['owner', 'manager', 'worker', 'read_only'])
const fail = (): never => { throw new Error('Farm Rx could not confirm the harvest change. Please try again.') }
const object = (value: unknown) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown> }
const id = (value: unknown) => typeof value === 'string' && uuid.test(value) ? value : fail()
const nullableNumber = (value: unknown) => value === null ? null : typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : fail()
const nullableDate = (value: unknown): string | null => { if (value === null) return null; if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return fail(); return value }
const timestamp = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fail()
const sameDecimal = (left: number | null, right: number | null, places: number) => left === null || right === null ? left === right : roundDecimalHalfUp(left, places) === roundDecimalHalfUp(right, places)
const canonicalDraft = (draft: HarvestDraft): HarvestDraft => ({ ...draft, harvested_bushels: roundDecimalHalfUp(draft.harvested_bushels, 2), actual_price_per_bu: roundDecimalHalfUp(draft.actual_price_per_bu, 6) })

export function mapHarvestRecord(value: unknown, expected?: { farmId: string; draft: HarvestDraft }): HarvestRecord {
  const row = object(value)
  if (!Object.hasOwn(row, 'actual_price_per_bu')) fail()
  const result: HarvestRecord = { id: id(row.id), farm_id: id(row.farm_id), crop_assignment_id: id(row.id), harvested_bushels: nullableNumber(row.harvested_bushels), harvest_date: nullableDate(row.harvest_date), actual_price_per_bu: nullableNumber(row.actual_price_per_bu), updated_at: timestamp(row.updated_at) }
  if (expected && (result.id !== expected.draft.crop_assignment_id || result.crop_assignment_id !== expected.draft.crop_assignment_id || result.farm_id !== expected.farmId || !sameDecimal(result.harvested_bushels, expected.draft.harvested_bushels, 2) || result.harvest_date !== expected.draft.harvest_date || !sameDecimal(result.actual_price_per_bu, expected.draft.actual_price_per_bu, 6))) fail()
  return result
}

export class SupabaseHarvestRepository implements HarvestRepository {
  constructor(private readonly d: { gateway: HarvestDataGateway; fieldsRepository: FieldsRepository; getFarmId: () => Promise<string>; getUserId: () => Promise<string>; createId: () => string }) {}
  private async viewer(farmId: string, userId: string) {
    const raw = object(await this.d.gateway.loadViewerRole(farmId, userId)); const role = raw.role
    if (typeof role !== 'string' || !roles.has(role as FarmViewerRole)) fail()
    return { user_id: userId, role: role as FarmViewerRole }
  }
  async getData(): Promise<HarvestData> {
    const [farmId, userId, fieldsData] = await Promise.all([this.d.getFarmId(), this.d.getUserId(), this.d.fieldsRepository.getData()])
    if (fieldsData.farm.id !== farmId) fail()
    return { fieldsData, viewer: await this.viewer(farmId, userId) }
  }
  async saveHarvest(draft: HarvestDraft) { return this.saveHarvestOperation(draft, this.d.createId()) }
  async saveHarvestOperation(draft: HarvestDraft, operationId: string) {
    if (!uuid.test(operationId) || validateHarvestDraft(draft) !== null) fail()
    const [farmId, userId] = await Promise.all([this.d.getFarmId(), this.d.getUserId()])
    if (!canEditHarvest((await this.viewer(farmId, userId)).role)) throw new Error('You have view-only access to harvest records.')
    const entry = canonicalDraft(draft)
    return mapHarvestRecord(await this.d.gateway.saveHarvest({ farmId, operationId, entry }), { farmId, draft: entry })
  }
}
