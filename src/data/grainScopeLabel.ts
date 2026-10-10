import type { GrainWorkspace, PositionScope } from './grain'

/** The one label Grain uses for a crop scope ("2026 Corn — whole farm"), so two crop years of the same crop never look alike. */
export function scopeLabel(workspace: GrainWorkspace, scope: PositionScope): string {
  const commodity = workspace.fields.commodities.find((item) => item.id === scope.commodity_id)?.name ?? scope.commodity_id
  const entity = scope.enterprise_label ?? workspace.fields.entities.find((item) => item.id === scope.operating_entity_id)?.name ?? 'whole farm'
  return `${scope.crop_year} ${commodity} — ${entity}`
}
