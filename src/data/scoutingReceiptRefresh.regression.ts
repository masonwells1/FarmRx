import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../ScoutingModule.tsx', import.meta.url)), 'utf8')
const refresh = source.indexOf('await refresh(); setSaveReceipt(draft.id!, \'saved\')')

assert(refresh >= 0, 'A confirmed scouting save must restart its Saved receipt after the canonical refresh completes.')
assert(source.includes('reload = async (showLoading = false)') && source.includes('if (showLoading) setLoading(true)') && source.includes('void reload(true)'), 'Only the initial scouting load may unmount field cards; confirmed refreshes must preserve their receipt state.')
console.log('SCOUTING_RECEIPT_REFRESH_REGRESSION_PASS')
