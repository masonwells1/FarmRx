import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { confirmDialog } from './components/ConfirmDialog'
import type { Field, FieldsData, FieldsRepository } from './data/fields'
import { FIELD_LOG_OFFLINE_DELETE_MESSAGE, fieldLogMaximumObservedOn, isFieldLogDeletedEntryRefusal, validateFieldLogDraft, type FieldLogData, type FieldLogEntry, type FieldLogEntryDraft, type FieldLogRepository } from './data/fieldLog'
import { growingDegreeDays, weatherService } from './data/weatherService'
import { WeatherCredit } from './components/WeatherCredit'
import { farmerError } from './lib/farmerErrors'
import { formatFarmDate } from './lib/farmDate'
import { farmLocalCalendarDate } from './data/farmDates'
import { parseTodayRecordIntent } from './data/todayIntents'
import { createSubmitLock, createSubmitLockMap } from './lib/submitLock'
import { NeedsAttentionList } from './components/NeedsAttentionList'
import { getNeedsAttentionVersion, readNeedsAttention, subscribeNeedsAttention } from './data/needsAttentionStore'

const today = () => farmLocalCalendarDate()
const editable = (role: string) => role === 'owner' || role === 'manager' || role === 'worker'
const inches = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** An entry this page's forms saved or kept on the device, with how many reloads had started when it was kept. */
type LocalEntry = { entry: FieldLogEntry; readsBefore: number }
/** Whether a local entry still shows after a reload. An answer from the device's saved copy settles nothing, except that a
 * write waiting on this device for the same entry (another tab's edit or delete) replaces a confirmed local copy. A live answer from a
 * reload that started after the entry was kept settles it, unless it is still waiting on the device: the server's rows
 * then show, so an entry deleted on another phone goes away instead of keeping an Edit button that would save it back. */
function staysLocal(local: LocalEntry, log: FieldLogData, read: number) {
  if (log.offline) return local.entry.pending === true || !(log.waitingIds ? log.waitingIds.includes(local.entry.id) : log.entries.some((entry) => entry.id === local.entry.id && entry.pending))
  if (read <= local.readsBefore) return true
  return local.entry.pending === true && (log.waitingIds?.includes(local.entry.id) ?? true)
}
/** Saves and deletes the server refused that now wait in Needs attention instead of the queue: the saves by the queued
 * change they came from (and by entry, for a waiting row that does not name its change), the deletes by entry. */
function parkedIds(queueKey: string | null) {
  const saves = new Set<string>(); const saveOperations = new Set<string>(); const deletes = new Set<string>()
  if (typeof window === 'undefined' || !queueKey) return { saves, saveOperations, deletes }
  for (const record of readNeedsAttention(window.localStorage, queueKey)) {
    const entry = record.entry as { kind?: unknown; draft?: { id?: unknown }; entryId?: unknown } | null
    if (entry?.kind === 'saveEntry' && typeof entry.draft?.id === 'string') { saves.add(entry.draft.id); saveOperations.add(record.id) }
    if (entry?.kind === 'deleteEntry' && typeof entry.entryId === 'string') deletes.add(entry.entryId)
  }
  return { saves, saveOperations, deletes }
}
/** The server's order for timeline rows: newest date, then newest created, then id. Created times are compared as
 * instants because the server's stamps and the device's are written differently. */
const createdTime = (entry: FieldLogEntry) => Date.parse(entry.created_at) || 0
const serverOrder = (a: FieldLogEntry, b: FieldLogEntry) => b.observed_on.localeCompare(a.observed_on) || createdTime(b) - createdTime(a) || a.id.localeCompare(b.id)

export function FieldLogPage({ fieldLogRepository, fieldsRepository }: { fieldLogRepository: FieldLogRepository; fieldsRepository: FieldsRepository }) {
  const location = useLocation()
  // A Today "Rain" tile arrives with a record intent: open the rainfall form on the first field so the farmer types straight away.
  const [openRainfallOnFirstField] = useState(() => parseTodayRecordIntent(location.state)?.record === 'rainfall')
  // Entries this page's forms saved or kept on the device. They show in each field's timeline, over the reload's copy,
  // until a reload settles them (staysLocal): a reload that loses signal answers from the copy saved on this device,
  // which may not have them yet (keeping that copy current is best effort).
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([])
  const readsStarted = useRef(0); const readsApplied = useRef(0)
  const addLocal = (results: FieldLogEntry[]) => { const readsBefore = readsStarted.current; setLocalEntries((current) => [...current.filter((local) => !results.some((next) => next.id === local.entry.id)), ...results.map((entry) => ({ entry, readsBefore }))]) }
  const [fieldsData, setFieldsData] = useState<FieldsData | null>(null); const [entries, setEntries] = useState<FieldLogEntry[]>([]); const [role, setRole] = useState<string>('read_only'); const [attentionQueueKey, setAttentionQueueKey] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true)
  // An answer from a reload older than one already applied is ignored, success or failure, so it cannot put back rows
  // from before a save or show a stale error.
  const reload = async () => {
    readsStarted.current += 1; const read = readsStarted.current
    setLoading(true)
    try {
      const [fields, log, queueKey] = await Promise.all([fieldsRepository.getData(), fieldLogRepository.getData(), fieldLogRepository.getNeedsAttentionQueueKey?.().catch(() => null) ?? Promise.resolve(null)])
      if (read < readsApplied.current) return
      readsApplied.current = read
      setFieldsData(fields); setEntries(log.entries); setLocalEntries((current) => current.filter((local) => staysLocal(local, log, read))); setRole(log.viewer.role); setAttentionQueueKey(queueKey); setError(null)
    } catch (caught) {
      if (read < readsApplied.current) return
      setError(farmerError(caught, 'open the field log'))
    } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [])
  // A refused save moves to Needs attention while the page is open, in this tab or another; it then shows there, not as
  // "Not sent yet" in a timeline, and the page reloads so a row an offline reload showed in place of the server's comes back.
  const attentionVersion = useSyncExternalStore(subscribeNeedsAttention, getNeedsAttentionVersion, getNeedsAttentionVersion)
  const firstAttentionVersion = useRef(attentionVersion)
  useEffect(() => { if (attentionVersion !== firstAttentionVersion.current) void reload() }, [attentionVersion])
  if (loading && !fieldsData) return <section className="page field-log-page"><p className="loading-state">Loading field log…</p></section>
  if (!fieldsData) return <section className="page field-log-page"><h1>Field Log</h1><p className="form-error">{error ?? 'Farm Rx could not load the field log.'}</p><button className="secondary-action" onClick={() => void reload()}>Try again</button></section>
  const activeFields = fieldsData.fields.filter((field) => field.is_active)
  const fieldNames = new Map(fieldsData.fields.map((field) => [field.id, field.name]))
  const parked = parkedIds(attentionQueueKey)
  // A refused save shows only in Needs attention: not from this page's forms, nor from a reload that laid it over the rows.
  // A later change to the same entry still waiting on this device is a different queued change: it shows as not sent yet,
  // so the entry does not vanish while a reload shows that waiting change in place of the server's row.
  const notParked = (entry: FieldLogEntry) => !(entry.pending && (entry.operationId ? parked.saveOperations.has(entry.operationId) : parked.saves.has(entry.id)))
  const shownLocal = localEntries.map((local) => local.entry).filter(notParked)
  const retry = fieldLogRepository.retryNeedsAttention ? async (row: { queueKey: string; id: string }) => { const waiting = await fieldLogRepository.retryNeedsAttention!(row.queueKey, row.id); if (waiting) addLocal([waiting]) } : undefined
  const dismiss = fieldLogRepository.dismissNeedsAttention ? (row: { queueKey: string; id: string }) => fieldLogRepository.dismissNeedsAttention!(row.queueKey, row.id) : undefined
  const fieldName = (entry: unknown) => { const draft = entry && typeof entry === 'object' ? (entry as { draft?: unknown }).draft : null; const fieldId = draft && typeof draft === 'object' ? (draft as { field_id?: unknown }).field_id : null; return typeof fieldId === 'string' ? fieldNames.get(fieldId) ?? null : null }
  return <section className="page field-log-page"><header className="page-heading"><div><h1>Field Log</h1><p>Rain totals and notes, by field.</p></div></header>{error && <p className="form-error">{error}</p>}<NeedsAttentionList module="fieldLog" queueKey={attentionQueueKey} onChanged={reload} onRetry={retry} onDismiss={dismiss} fieldName={fieldName} />{editable(role) && activeFields.length > 1 && <MultiFieldRain fields={activeFields} repository={fieldLogRepository} refresh={reload} onSaved={addLocal} />}{!activeFields.length ? <section className="empty-state"><h2>Add your first field to start a field log.</h2>{editable(role) && <Link className="primary-action" to="/fields">Add a field</Link>}</section> : <div className="field-log-list">{activeFields.map((field, index) => <FieldCard key={field.id} field={field} entries={entries.filter((entry) => entry.field_id === field.id && notParked(entry))} assignments={fieldsData.crop_assignments} canEdit={editable(role)} initialMode={openRainfallOnFirstField && index === 0 && editable(role) ? 'rainfall' : null} repository={fieldLogRepository} refresh={reload} local={shownLocal.filter((entry) => entry.field_id === field.id)} parkedDeletes={parked.deletes} onSaved={(saved) => addLocal([saved])} />)}</div>}</section>
}

/** One rain total for several fields at once. Each chosen field gets its own ordinary rainfall entry through the same
 * repository save as the per-field form, one after another, so a field that fails is named and the rest are kept. */
function MultiFieldRain({ fields, repository, refresh, onSaved }: { fields: Field[]; repository: FieldLogRepository; refresh: () => Promise<void>; onSaved: (entries: FieldLogEntry[]) => void }) {
  const submitLock = useRef(createSubmitLock())
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const toggle = (id: string) => setChosen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!submitLock.current.acquire()) return
    const form = new FormData(event.currentTarget)
    const rainfall = String(form.get('rainfall') ?? '').trim()
    const note = String(form.get('note') ?? '').trim()
    const targets = fields.filter((field) => chosen.has(field.id))
    if (!targets.length) { setMessage('Pick at least one field.'); submitLock.current.release(); return }
    const drafts: Array<{ field: Field; draft: FieldLogEntryDraft }> = targets.map((field) => ({ field, draft: { field_id: field.id, entry_type: 'rainfall', observed_on: String(form.get('date')), rainfall_in: rainfall === '' ? null : Number(rainfall), note: note || null } }))
    const validation = validateFieldLogDraft(drafts[0].draft)
    if (validation) { setMessage(validation); submitLock.current.release(); return }
    setSubmitting(true); setMessage(null); setResult(null)
    const saved: string[] = []; const queued: string[] = []; const failed: string[] = []; const failedIds: string[] = []; const results: FieldLogEntry[] = []
    try {
      for (const { field, draft } of drafts) {
        try { const entry = await repository.saveEntry(draft); results.push(entry); if (entry.pending) queued.push(field.name); else saved.push(field.name) }
        catch { failed.push(field.name); failedIds.push(field.id) }
      }
      const parts = [
        saved.length ? `Saved for ${saved.join(', ')}.` : '',
        queued.length ? `Kept on this device for ${queued.join(', ')}; Farm Rx checks your access before sending.` : '',
        failed.length ? `Not saved for ${failed.join(', ')}. Try those again.` : '',
      ].filter(Boolean)
      setResult(parts.join(' '))
      // Saved and kept entries go into the timeline now, so a reload that loses signal afterwards cannot hide them.
      if (results.length) onSaved(results)
      if (!failed.length) { setChosen(new Set()); setOpen(false) } else setChosen(new Set(failedIds))
      await refresh().catch(() => undefined)
    } finally { setSubmitting(false); submitLock.current.release() }
  }
  return <section className="multi-rain">
    {!open && <button className="secondary-action" type="button" onClick={() => { setOpen(true); setResult(null) }}>Add rain to several fields</button>}
    {result && <p className="field-log-pending" role="status">{result}</p>}
    {open && <form className="field-log-form multi-rain-form" onSubmit={submit}>
      <h3>Add rain to several fields</h3>
      <fieldset className="wide multi-rain-fields" disabled={submitting}><legend>Fields</legend>
        <div className="multi-rain-picks">{fields.map((field) => <label key={field.id} className="check-label"><input type="checkbox" checked={chosen.has(field.id)} onChange={() => toggle(field.id)} /> {field.name}</label>)}</div>
        <button type="button" className="secondary-action" onClick={() => setChosen(chosen.size === fields.length ? new Set() : new Set(fields.map((field) => field.id)))}>{chosen.size === fields.length ? 'Clear all' : 'Pick all fields'}</button>
      </fieldset>
      <label>Date<input name="date" type="date" max={fieldLogMaximumObservedOn()} defaultValue={today()} required disabled={submitting} /></label>
      <label>Rainfall (inches)<input name="rainfall" type="number" min="0" max="100" step="0.01" required disabled={submitting} /></label>
      <label className="wide">Optional note<textarea name="note" maxLength={500} disabled={submitting} /></label>
      {message && <p className="form-error">{message}</p>}
      <div><button className="primary-action" disabled={submitting}>{submitting ? 'Saving…' : chosen.size ? `Save rain for ${chosen.size} field${chosen.size === 1 ? '' : 's'}` : 'Save rain'}</button><button type="button" className="secondary-action" disabled={submitting} onClick={() => { setOpen(false); setMessage(null) }}>Cancel</button></div>
    </form>}
  </section>
}

function FieldCard({ field, entries, assignments, canEdit, initialMode = null, repository, refresh, local, parkedDeletes, onSaved }: { field: Field; entries: FieldLogEntry[]; assignments: FieldsData['crop_assignments']; canEdit: boolean; initialMode?: 'rainfall' | 'note' | null; repository: FieldLogRepository; refresh: () => Promise<void>; local: FieldLogEntry[]; parkedDeletes: Set<string>; onSaved: (entry: FieldLogEntry) => void }) {
  const deleteLocks = useRef(createSubmitLockMap()); const [mode, setMode] = useState<'rainfall' | 'note' | null>(initialMode); const [editing, setEditing] = useState<FieldLogEntry | null>(null); const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set()); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const year = new Date().getFullYear(); const timelineEntries = [...local, ...entries.filter((entry) => !local.some((kept) => kept.id === entry.id))].filter((entry) => !deletedIds.has(entry.id) || parkedDeletes.has(entry.id)).sort(serverOrder); const season = timelineEntries.filter((entry) => entry.entry_type === 'rainfall' && entry.observed_on >= `${year}-01-01` && entry.observed_on <= today()).reduce((sum, entry) => sum + (entry.rainfall_in ?? 0), 0)
  // A delete the server refused leaves this card's hidden list, so the entry stays shown after the farmer dismisses it, and
  // the card stops saying it will finish syncing.
  useEffect(() => { if ([...parkedDeletes].some((id) => deletedIds.has(id))) { setDeletedIds((current) => new Set([...current].filter((id) => !parkedDeletes.has(id)))); setNotice(null) } })
  const plantingDate = useMemo(() => assignments.filter((assignment) => assignment.field_id === field.id && assignment.crop_year === year && !!assignment.planting_date).map((assignment) => assignment.planting_date!).sort()[0] ?? null, [assignments, field.id, year])
  async function save(draft: FieldLogEntryDraft) { try { const saved = await repository.saveEntry(draft); setMode(null); setEditing(null); setError(null); onSaved(saved.pending && editing?.id === saved.id ? { ...saved, created_at: editing.created_at } : saved); if (saved.pending) return; await refresh() } catch (caught) { setError(farmerError(caught, 'save this field log entry')); if (isFieldLogDeletedEntryRefusal(caught)) { setMode(null); setEditing(null); await refresh().catch(() => undefined) } } }
  async function remove(entry: FieldLogEntry) { const deleteLock = deleteLocks.current.get(entry.id); if (!deleteLock.acquire()) return; if (!(await confirmDialog({ title: 'Delete this field log entry?', body: 'It is removed from the field log for good.', confirmLabel: 'Delete entry', destructive: true }))) { deleteLock.release(); return } try { const receipt = await repository.deleteEntry(entry.id); setDeletedIds((current) => new Set(current).add(entry.id)); setError(null); if (receipt.pending) { setNotice(FIELD_LOG_OFFLINE_DELETE_MESSAGE); return } setNotice(null); await refresh() } catch (caught) { setError(farmerError(caught, 'delete this field log entry')) } finally { deleteLock.release() } }
  return <article className="field-log-card"><header className="field-log-card-head"><div><h2>{field.name}</h2><p>{field.total_acres.toLocaleString()} acres</p></div><div className="rain-total"><span>{year} season</span><strong>{inches.format(season)} in</strong></div></header><Gdd field={field} plantingDate={plantingDate} />{canEdit && <div className="field-log-actions"><button className="primary-action" onClick={() => { setMode('rainfall'); setEditing(null) }}>Add rain</button><button className="secondary-action" onClick={() => { setMode('note'); setEditing(null) }}>Add note</button></div>}{(mode || editing) && <EntryForm key={editing?.id ?? mode} entry={editing} type={editing?.entry_type ?? mode!} fieldId={field.id} save={save} cancel={() => { setMode(null); setEditing(null); setError(null) }} />}{error && <p className="form-error">{error}</p>}{notice && <p className="field-log-pending" role="status">{notice}</p>}<section className="field-log-timeline"><h3>Timeline</h3>{timelineEntries.length ? timelineEntries.map((entry) => <div className="field-log-row" key={entry.id}><div><strong>{formatFarmDate(entry.observed_on)}</strong><span>{entry.entry_type === 'rainfall' ? `${inches.format(entry.rainfall_in ?? 0)} in${entry.note ? ` · ${entry.note}` : ''}` : entry.note}</span>{entry.pending && <em className="field-log-pending">Not sent yet</em>}</div>{canEdit && !entry.pending && <div className="field-log-row-actions"><button onClick={() => { setEditing(entry); setMode(null) }}>Edit</button><button className="danger-action" onClick={() => void remove(entry)}>Delete</button></div>}</div>) : <p className="card-empty">No rain or notes recorded yet.</p>}</section></article>
}

function EntryForm({ entry, type, fieldId, save, cancel }: { entry: FieldLogEntry | null; type: 'rainfall' | 'note'; fieldId: string; save: (draft: FieldLogEntryDraft) => Promise<void>; cancel: () => void }) {
  const submitLock = useRef(createSubmitLock()); const [submitting, setSubmitting] = useState(false); const [message, setMessage] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!submitLock.current.acquire()) return; const form = new FormData(event.currentTarget); const rainfall = String(form.get('rainfall') ?? '').trim(); const note = String(form.get('note') ?? '').trim(); const draft: FieldLogEntryDraft = { id: entry?.id, field_id: fieldId, entry_type: type, observed_on: String(form.get('date')), rainfall_in: type === 'rainfall' ? rainfall === '' ? null : Number(rainfall) : null, note: note || null }; const validation = validateFieldLogDraft(draft); if (validation) { setMessage(validation); submitLock.current.release(); return } setSubmitting(true); setMessage(null); try { await save(draft) } finally { setSubmitting(false); submitLock.current.release() } }
  return <form className="field-log-form" onSubmit={submit}><h3>{entry ? 'Edit' : type === 'rainfall' ? 'Add rain' : 'Add note'}</h3><label>Date<input name="date" type="date" max={fieldLogMaximumObservedOn()} defaultValue={entry?.observed_on ?? today()} required /></label>{type === 'rainfall' && <label>Rainfall (inches)<input name="rainfall" type="number" min="0" max="100" step="0.01" defaultValue={entry?.rainfall_in ?? ''} required /></label>}<label className={type === 'rainfall' ? 'wide' : ''}>{type === 'rainfall' ? 'Optional note' : 'Note'}<textarea name="note" maxLength={500} defaultValue={entry?.note ?? ''} required={type === 'note'} /></label>{message && <p className="form-error">{message}</p>}<div><button className="primary-action" disabled={submitting}>{submitting ? 'Saving…' : 'Save entry'}</button><button type="button" className="secondary-action" onClick={cancel}>Cancel</button></div></form>
}

function Gdd({ field, plantingDate }: { field: Field; plantingDate: string | null }) {
  const [state, setState] = useState<{ value: number | null; stale: boolean; error: boolean; through: string | null }>({ value: null, stale: false, error: false, through: null })
  useEffect(() => { let active = true; if (field.latitude === null || field.longitude === null || !plantingDate || !weatherService) { setState({ value: null, stale: false, error: false, through: null }); return () => { active = false } } void weatherService.fetchDailyHistory(field.latitude, field.longitude, plantingDate, today()).then((history) => { if (active) setState({ value: growingDegreeDays(history.daily), stale: history.stale, error: false, through: history.daily.at(-1)?.date ?? null }) }).catch(() => { if (active) setState({ value: null, stale: false, error: true, through: null }) }); return () => { active = false } }, [field.id, field.latitude, field.longitude, plantingDate])
  if (field.latitude === null || field.longitude === null || !plantingDate) return <p className="gdd-prompt">Add a location and planting date to see growing degree days.</p>
  if (plantingDate > today()) return <p className="gdd-prompt">Growing degree days will appear once this season has enough weather history.</p>
  if (state.error) return <p className="gdd-prompt">Growing degree days will appear once this season has enough weather history.</p>
  if (state.value === null) return <p className="gdd-prompt">Loading growing degree days…</p>
  return <><p className="gdd-line"><strong>GDD since planting: {state.value.toLocaleString()}</strong><small>{state.stale ? 'Saved weather data — reconnect for the latest.' : state.through && state.through < today() ? `Weather data through ${state.through}.` : 'Based on daily high and low temperatures.'}</small></p><WeatherCredit /></>
}
