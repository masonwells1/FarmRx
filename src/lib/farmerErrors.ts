function details(error: unknown) { const values: string[] = []; const seen = new Set<unknown>(); let current: unknown = error; while (current && !seen.has(current)) { seen.add(current); if (current instanceof Error) values.push(current.message); if (typeof current === 'object') { const row = current as { message?: unknown; code?: unknown; status?: unknown; cause?: unknown }; for (const value of [row.message, row.code, row.status]) if (typeof value === 'string' || typeof value === 'number') values.push(String(value)); current = row.cause } else break }; return values.join(' ').toLowerCase() }
/** Fixed UI taxonomy: technical adapter/database text never reaches a farmer. */
export function farmerError(error: unknown, action = 'save this field') {
  const message = details(error)
  if (/network|fetch|timeout|connection|econn/.test(message)) return 'We could not reach Farm Rx. Check your signal and try again.'
  if (/sign-in ended|jwt|auth|unauthori[sz]ed|\b401\b/.test(message)) return 'Your sign-in ended. Please sign in again.'
  if (/permission|rls|forbidden|\b403\b/.test(message)) return 'You do not have permission to make that change.'
  if (/duplicate|already exists|\b23505\b/.test(message)) return 'That record already exists. Check it and try again.'
  if (/invalid|malformed|validation|must be|required|\b22p02\b/.test(message) && /save/.test(action)) return 'Check the field details and try again.'
  return `Farm Rx could not ${action} right now. Please try again.`
}
