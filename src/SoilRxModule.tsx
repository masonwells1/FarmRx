import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { FieldsRepository } from './data/fields'
import { soilMeasurementKeys, sortSoilTestsNewestFirst, type SoilMeasurementKey, type SoilRxRepository, type SoilTest, type SoilTestDraft } from './data/soilRx'
import { createSubmitLock } from './lib/submitLock'
import { farmerError } from './lib/farmerErrors'
import { useFarmAccess } from './auth/FarmAccessContext'
import { canEditFarmModule } from './auth/farmContext'
import { farmLocalCalendarDate } from './data/farmDates'
import { validateSoilReportFile } from './data/soilRxStorage'
import { NeedsAttentionList } from './components/NeedsAttentionList'

const labels: Record<SoilMeasurementKey, string> = {
  ph: 'pH', organic_matter_pct: 'Organic matter %', cec_meq_100g: 'CEC meq/100g', phosphorus_ppm: 'Phosphorus ppm', potassium_ppm: 'Potassium ppm', calcium_ppm: 'Calcium ppm', magnesium_ppm: 'Magnesium ppm', sulfur_ppm: 'Sulfur ppm', base_saturation_calcium_pct: 'Base saturation calcium %', base_saturation_magnesium_pct: 'Base saturation magnesium %', base_saturation_potassium_pct: 'Base saturation potassium %', base_saturation_sodium_pct: 'Base saturation sodium %', base_saturation_hydrogen_pct: 'Base saturation hydrogen %', boron_ppm: 'Boron ppm', chloride_ppm: 'Chloride ppm', copper_ppm: 'Copper ppm', iron_ppm: 'Iron ppm', manganese_ppm: 'Manganese ppm', molybdenum_ppm: 'Molybdenum ppm', zinc_ppm: 'Zinc ppm',
}
const emptyMeasurements = () => Object.fromEntries(soilMeasurementKeys.map((key) => [key, ''])) as Record<SoilMeasurementKey, string>
const initialForm = (fieldId = '', sampleDate = '') => ({ id: crypto.randomUUID(), fieldId, sampleDate, labName: '', measurements: emptyMeasurements() })
function displayDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) }

export function SoilRxPage({ repository, fieldsRepository }: { repository: SoilRxRepository; fieldsRepository: FieldsRepository }) {
  const { profile } = useFarmAccess()
  const [fields, setFields] = useState<Array<{ id: string; name: string }>>([])
  const [tests, setTests] = useState<SoilTest[]>([])
  const [selectedFieldId, setSelectedFieldId] = useState('')
  const [form, setForm] = useState(initialForm)
  const [report, setReport] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [openTests, setOpenTests] = useState<Set<string>>(new Set())
  const [attentionQueueKey, setAttentionQueueKey] = useState<string | null>(null)
  const lock = useRef(createSubmitLock())
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  const selectedField = selectedFieldId || fields[0]?.id || ''
  const canEdit = canEditFarmModule(profile, 'soil_rx')

  const refresh = async () => {
    const [fieldData, soilData, queueKey] = await Promise.all([fieldsRepository.getData(), repository.getData(), repository.getNeedsAttentionQueueKey?.().catch(() => null) ?? Promise.resolve(null)])
    const nextFields = fieldData.fields.filter((field) => field.is_active).map(({ id, name }) => ({ id, name }))
    const nextTests = sortSoilTestsNewestFirst(soilData.tests); setFields(nextFields); setTests(nextTests)
    const nextSelected = selectedFieldId && nextFields.some((field) => field.id === selectedFieldId) ? selectedFieldId : nextFields[0]?.id ?? ''
    setSelectedFieldId(nextSelected); setForm((current) => ({ ...current, fieldId: nextSelected })); setOpenTests(new Set(nextTests.filter((test) => test.field_id === nextSelected).slice(0, 1).map((test) => test.id))); setAttentionQueueKey(queueKey)
  }
  useEffect(() => { void refresh().catch((caught) => setError(farmerError(caught, 'load Soil Rx'))).finally(() => setLoading(false)) }, [])
  const fieldTests = useMemo(() => sortSoilTestsNewestFirst(tests.filter((test) => test.field_id === selectedField)), [tests, selectedField])

  async function save(event: FormEvent) {
    event.preventDefault(); if (!lock.current.acquire()) return
    setSaving(true); setError(null); setMessage(null)
    try {
      if (!form.fieldId) throw new Error('Choose the field for this soil test.')
      if (report && offline) throw new Error('Connect to the internet before saving a report attachment. Text-only soil tests can save offline.')
      const draft: SoilTestDraft = { id: form.id, field_id: form.fieldId, sample_date: form.sampleDate, lab_name: form.labName, ...Object.fromEntries(soilMeasurementKeys.map((key) => [key, form.measurements[key] === '' ? null : Number(form.measurements[key])])) as Record<SoilMeasurementKey, number | null> }
      const saved = await repository.saveTest(draft, report ?? undefined)
      setTests((current) => sortSoilTestsNewestFirst([saved, ...current.filter((test) => test.id !== saved.id)]))
      setSelectedFieldId(saved.field_id); setForm(initialForm(saved.field_id, farmLocalCalendarDate())); setReport(null); setOpenTests(new Set([saved.id]))
      setMessage(saved.pending ? 'Saved on this device. Farm Rx will send it when your connection returns.' : 'Soil test saved.')
    } catch (caught) { setError(farmerError(caught, 'save this soil test')) }
    finally { setSaving(false); lock.current.release() }
  }
  function chooseField(fieldId: string) { setSelectedFieldId(fieldId); setForm((current) => ({ ...current, fieldId })); setOpenTests(new Set(sortSoilTestsNewestFirst(tests.filter((test) => test.field_id === fieldId)).slice(0, 1).map((test) => test.id))) }
  function selectReport(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0] ?? null; const problem = file ? validateSoilReportFile(file) : null; if (problem) event.target.value = ''; setReport(problem ? null : file); setError(problem) }
  async function openReport(test: SoilTest) { if (!test.attachment) return; setError(null); try { window.open(await repository.getReportUrl(test.attachment.storage_path), '_blank', 'noopener,noreferrer') } catch (caught) { setError(farmerError(caught, 'open this report')) } }

  return <section className="page soil-rx-page" aria-labelledby="soil-rx-title">
    <header className="page-header"><div><p className="eyebrow">Field fertility records</p><h1 id="soil-rx-title">Soil Rx</h1><p>Keep your lab results together by field. Crop RX only sees them if you share farm data in Privacy.</p></div></header>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p className="save-success" role="status">{message}</p>}
    <NeedsAttentionList module="soilRx" queueKey={attentionQueueKey} onRetry={(row) => repository.retryNeedsAttention?.(row.queueKey, row.id)} onDismiss={(row) => repository.dismissNeedsAttention?.(row.queueKey, row.id)} onChanged={refresh} />
    {loading ? <p className="loading-state">Loading Soil Rx…</p> : <>
      {!fields.length ? <p className="soil-rx-empty">Add a field before saving a soil test.</p> : <>
        <div className="soil-rx-layout">
          <aside className="soil-rx-fields" aria-label="Fields"><h2>Your fields</h2>{fields.map((field) => <button key={field.id} type="button" className={field.id === selectedField ? 'active' : ''} onClick={() => chooseField(field.id)}>{field.name}<small>{tests.filter((test) => test.field_id === field.id).length} tests</small></button>)}</aside>
          <div className="soil-rx-history"><h2>{fields.find((field) => field.id === selectedField)?.name ?? 'Field'} history</h2>{fieldTests.length ? fieldTests.map((test) => <SoilTestCard key={test.id} test={test} expanded={openTests.has(test.id)} onToggle={() => setOpenTests((current) => { const next = new Set(current); next.has(test.id) ? next.delete(test.id) : next.add(test.id); return next })} onOpen={() => void openReport(test)} />) : <p className="soil-rx-empty">No soil tests saved for this field yet.</p>}</div>
        </div>
        {canEdit && <form className="soil-rx-form" onSubmit={save}><header><h2>Add a soil test</h2><p>Lab name and sample date are required. Leave a measurement blank when it was not reported.</p></header>
          <div className="soil-rx-form-grid"><label>Field<select value={form.fieldId} onChange={(event) => chooseField(event.target.value)} required>{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label><label>Lab name<input value={form.labName} onChange={(event) => setForm((current) => ({ ...current, labName: event.target.value }))} maxLength={160} required /></label><label>Sample date<input type="date" value={form.sampleDate} onChange={(event) => setForm((current) => ({ ...current, sampleDate: event.target.value }))} required /></label></div>
          <details className="soil-rx-measurements"><summary>Add lab measurements (optional)</summary><div>{soilMeasurementKeys.map((key) => <label key={key}>{labels[key]}<input type="number" step="0.001" value={form.measurements[key]} onChange={(event) => setForm((current) => ({ ...current, measurements: { ...current.measurements, [key]: event.target.value } }))} /></label>)}</div></details>
          <label className="soil-rx-report">Lab report (optional, PDF or image, up to 20 MB)<input type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/heif" onChange={selectReport} />{report && <small>{report.name}</small>}{offline && <small>Attachments need a connection. Text-only tests can still save now.</small>}</label>
          <button className="primary-action" type="submit" disabled={saving || !fields.length}>{saving ? 'Saving soil test…' : 'Save soil test'}</button>
        </form>}
      </>}
    </>}
  </section>
}

function SoilTestCard({ test, expanded, onToggle, onOpen }: { test: SoilTest; expanded: boolean; onToggle: () => void; onOpen: () => void }) {
  return <article className="soil-test-card"><button type="button" className="soil-test-summary" aria-expanded={expanded} onClick={onToggle}><span><strong>{displayDate(test.sample_date)}</strong><small>{test.lab_name}{test.pending ? ' · Saved offline' : ''}</small></span><span>{expanded ? 'Hide details' : 'Show details'}</span></button>{expanded && <div className="soil-test-details"><dl>{soilMeasurementKeys.map((key) => <div key={key}><dt>{labels[key]}</dt><dd>{test[key] ?? 'Not reported'}</dd></div>)}</dl><SoilReportGuide test={test} />{test.attachment && <button type="button" className="secondary-action" onClick={onOpen}>Open lab report</button>}</div>}</article>
}

function SoilReportGuide({ test }: { test: SoilTest }) {
  const values = [
    ['pH', 'pH describes how acidic or alkaline the lab found this sample.', test.ph, ''],
    ['Organic matter', 'Organic matter is the portion of the sample made from decomposed plant and animal material.', test.organic_matter_pct, '%'],
    ['CEC', 'CEC describes the sample’s measured capacity to hold positively charged nutrients.', test.cec_meq_100g, 'meq/100g'],
  ] as const
  const baseSaturation = [['Calcium', test.base_saturation_calcium_pct], ['Magnesium', test.base_saturation_magnesium_pct], ['Potassium', test.base_saturation_potassium_pct], ['Sodium', test.base_saturation_sodium_pct], ['Hydrogen', test.base_saturation_hydrogen_pct]] as const
  return <section className="soil-rx-guide" aria-label="Understand this report"><h3>Understand this report</h3><p>These are descriptions of the values reported by your lab, not agronomic advice, target ranges, or a fertilizer recommendation.</p><dl>{values.map(([label, explanation, value, unit]) => <div key={label}><dt>{label}</dt><dd>{explanation} {`Lab result: ${value === null ? 'Not reported' : `${value}${unit ? ` ${unit}` : ''}`}`}</dd></div>)}</dl><section aria-label="Base saturation lab values"><h4>Base saturation</h4><p>Base saturation shows the lab-reported share of CEC occupied by each listed nutrient.</p><dl>{baseSaturation.map(([name, amount]) => <div key={name}><dt>{name}</dt><dd>{amount === null ? 'Not reported' : `${amount}%`}</dd></div>)}</dl></section></section>
}
