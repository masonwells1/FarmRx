import { FIRM_OFFER_FILL_PARTIAL_SUCCESS } from '../data/firmOfferFill'
import { PRE_BASELINE_BIN_MOVEMENT_MESSAGE } from '../data/binLedger'

export const firmOfferFillPartialSuccessMessage = 'Your sale was recorded as a contract. The offer could not be marked filled — reload the page. Do not enter this contract again.'

function details(error: unknown) { const values: string[] = []; const seen = new Set<unknown>(); let current: unknown = error; while (current && !seen.has(current)) { seen.add(current); if (current instanceof Error) values.push(current.message); if (typeof current === 'object') { const row = current as { message?: unknown; code?: unknown; status?: unknown; cause?: unknown }; for (const value of [row.message, row.code, row.status]) if (typeof value === 'string' || typeof value === 'number') values.push(String(value)); current = row.cause } else break }; return values.join(' ').toLowerCase() }
/** Fixed UI taxonomy: technical adapter/database text never reaches a farmer. */
export function farmerError(error: unknown, action = 'save this field') {
  const message = details(error)
  if (message.includes('farm_rx_stale_write')) return 'This record changed in another tab or device. Reload before saving again.'
  if (message.includes(FIRM_OFFER_FILL_PARTIAL_SUCCESS.toLowerCase())) return firmOfferFillPartialSuccessMessage
  if (/delivery tracking arrives with the next database update/.test(message)) return 'Delivery tracking arrives with the next database update.'
  if (/bin movements arrive with the next database update/.test(message)) return 'Bin movements arrive with the next database update.'
  if (/price finalization arrives with the next database update/.test(message)) return 'Price finalization arrives with the next database update.'
  if (/movement date must be after the latest bin baseline|dated on or before the bin's baseline/.test(message)) return PRE_BASELINE_BIN_MOVEMENT_MESSAGE
  if (/connect to the internet before recording a delivery/.test(message)) return 'Connect to the internet before recording a delivery.'
  if (/connect to the internet before filling this offer|firm offer must be filled while connected/.test(message)) return 'Connect to the internet before filling this offer.'
  if (/offline copy is too old/.test(message)) return 'This offline copy is too old to show safely. Connect to update it.'
  if (/network|fetch|timeout|connection|econn/.test(message)) return 'We could not reach Farm Rx. Check your signal and try again.'
  if (/sign-in ended|jwt|auth|unauthori[sz]ed|\b401\b/.test(message)) return 'Your sign-in ended. Please sign in again.'
  if (/permission|rls|forbidden|\b403\b/.test(message)) return 'You do not have permission to make that change.'
  if (/belongs to another farm|belongs to a different farm/.test(message)) return 'These saved profitability budgets belong to another farm. Farm Rx left them untouched.'
  if (/duplicate|already exists|\b23505\b/.test(message)) return 'That record already exists. Check it and try again.'
  if (/invalid|malformed|validation|must be|required|\b22p02\b/.test(message) && /save/.test(action)) return 'Check the field details and try again.'
  return `Farm Rx could not ${action} right now. Please try again.`
}
