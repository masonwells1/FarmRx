import type { FieldDraft } from './fields'
import type { FarmOperationContext } from './farmOperationContext'

export interface FieldsRowBundle {
  farm: unknown
  entities: unknown[]
  fields: unknown[]
  crop_assignments: unknown[]
  arrangements: unknown[]
  commodities: unknown[]
}

export interface SaveFieldBundleInput {
  farmId: string
  operationId: string
  draft: FieldDraft
}

export interface SavedFieldBundle {
  field: unknown
  arrangement: unknown
  cropAssignments: unknown[]
}

export interface FieldsDataGateway {
  loadWorkspace(farmId: string): Promise<FieldsRowBundle>
  saveFieldBundle(input: SaveFieldBundleInput, context: FarmOperationContext): Promise<SavedFieldBundle>
}
