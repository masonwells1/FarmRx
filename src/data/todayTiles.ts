import { canAccessFarmModule, canEditFarmModule, type FarmAccessProfile, type FarmAppModule } from '../auth/farmContext'
import { manualSprayRecordIntent } from './weatherSprayHandoff'
import { todayRecordIntent } from './todayIntents'
import type { TodayNextUpItem } from './today'

// The record tiles Today and the phone bar's Record button share (FD-1, FD-2). Kept apart from the rest of the Today projection so
// the app shell can ask "may this member record anything?" without loading the grain and weather projections.

export type TodayRecordKind = 'rain' | 'scouting' | 'spray' | 'task' | 'harvest' | 'grain_delivery' | 'program_pass'
export type TodayRecordTile = { kind: TodayRecordKind; label: string; module: FarmAppModule; to: string; state: unknown }

const recordTiles: readonly TodayRecordTile[] = [
  { kind: 'rain', label: 'Rain', module: 'field_log', to: '/field-log', state: todayRecordIntent('rainfall') },
  { kind: 'scouting', label: 'Scouting note', module: 'scouting', to: '/scouting', state: todayRecordIntent('scouting') },
  { kind: 'spray', label: 'Spray record', module: 'inventory', to: '/inventory', state: manualSprayRecordIntent },
  { kind: 'task', label: 'Task', module: 'tasks', to: '/tasks', state: todayRecordIntent('task') },
  { kind: 'harvest', label: 'Harvest', module: 'harvest', to: '/harvest', state: todayRecordIntent('harvest') },
  { kind: 'grain_delivery', label: 'Grain delivery', module: 'grain', to: '/grain/contracts', state: todayRecordIntent('grain_delivery') },
]

/** The record tiles this member may both reach and complete: a read-only member sees none, and a member without financial access
 * never sees Grain delivery, because the same checks that gate the module routes gate the tiles. When Next up holds a program
 * pass due today and the member may edit Programs, a "Pass due today" tile opens Programs on that pass through the link the
 * alert already carries (GOAL.md, FD-2), so the common action no longer needs the More menu. */
export function todayRecordTiles(profile: FarmAccessProfile, nextUp: readonly TodayNextUpItem[] = []): TodayRecordTile[] {
  const tiles = recordTiles.filter((tile) => canAccessFarmModule(profile, tile.module) && canEditFarmModule(profile, tile.module))
  const pass = nextUp.find((item) => item.kind === 'program')
  if (pass && canAccessFarmModule(profile, 'programs') && canEditFarmModule(profile, 'programs')) tiles.push({ kind: 'program_pass', label: 'Pass due today', module: 'programs', to: pass.to, state: undefined })
  return tiles
}
