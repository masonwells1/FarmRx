import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { CropAssignment, FieldsRepository, Commodity } from './data/fields'
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
export const nutrientRemovalSources = {
  phosphorusPotassium: { label: 'Illinois Extension, Soil Phosphorus: crop removal table', url: 'https://extension.illinois.edu/crops/soil-phosphorus' },
  cornNitrogen: { label: 'Illinois Agronomy Handbook, Nitrogen Management for Corn', url: 'https://extension.illinois.edu/sites/default/files/iah_-_nitrogen_management_for_corn_v4.pdf' },
  soybeanNitrogen: { label: 'University of Delaware Cooperative Extension, Nitrogen Removal by Delaware Crops', url: 'https://www.udel.edu/academics/colleges/canr/cooperative-extension/fact-sheets/nitrogen-removal-delaware-crops/' },
} as const
export const nutrientRemovalCoefficients = {
  corn: { nitrogen: 0.60, phosphorus: 0.37, potassium: 0.24 },
  soybeans: { nitrogen: 3.44, phosphorus: 0.75, potassium: 1.17 },
} as const
type SupportedRemovalCrop = keyof typeof nutrientRemovalCoefficients
export function removalEstimate(crop: CropAssignment, commodity: Commodity | undefined) {
  const family = commodity?.crop_family
  if (!commodity || !family || !Object.hasOwn(nutrientRemovalCoefficients, family) || crop.harvested_bushels === null || crop.harvested_bushels < 0 || crop.planted_acres <= 0) return null
  const coefficients = nutrientRemovalCoefficients[family as SupportedRemovalCrop]
  return {
    id: crop.id,
    crop: commodity.name,
    cropYear: crop.crop_year,
    plantingSequence: crop.planting_sequence,
    bushels: crop.harvested_bushels,
    acres: crop.planted_acres,
    nutrients: [
      { label: 'N', amount: crop.harvested_bushels * coefficients.nitrogen },
      { label: 'P₂O₅', amount: crop.harvested_bushels * coefficients.phosphorus },
      { label: 'K₂O', amount: crop.harvested_bushels * coefficients.potassium },
    ],
  }
}

export function SoilRxPage({ repository, fieldsRepository }: { repository: SoilRxRepository; fieldsRepository: FieldsRepository }) {
  const { profile } = useFarmAccess()
  const [fields, setFields] = useState<Array<{ id: string; name: string; isActive: boolean }>>([])
  const [tests, setTests] = useState<SoilTest[]>([])
  const [harvestAssignments, setHarvestAssignments] = useState<CropAssignment[]>([])
  const [commodities, setCommodities] = useState<Commodity[]>([])
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
  const selectedField = fields.find((field) => field.id === selectedFieldId) ?? fields[0]
  const activeFields = fields.filter((field) => field.isActive)
  const canEdit = canEditFarmModule(profile, 'soil_rx')

  const refresh = async () => {
    const [fieldData, soilData, queueKey] = await Promise.all([fieldsRepository.getData(), repository.getData(), repository.getNeedsAttentionQueueKey?.().catch(() => null) ?? Promise.resolve(null)])
    const nextFields = fieldData.fields.map(({ id, name, is_active }) => ({ id, name, isActive: is_active }))
    const nextActiveFields = nextFields.filter((field) => field.isActive)
    const nextTests = sortSoilTestsNewestFirst(soilData.tests); setFields(nextFields); setTests(nextTests); setHarvestAssignments(fieldData.crop_assignments); setCommodities(fieldData.commodities)
    const nextSelected = selectedFieldId && nextFields.some((field) => field.id === selectedFieldId) ? selectedFieldId : nextActiveFields[0]?.id ?? nextFields.find((field) => nextTests.some((test) => test.field_id === field.id))?.id ?? nextFields[0]?.id ?? ''
    setSelectedFieldId(nextSelected); setForm((current) => ({ ...current, fieldId: nextActiveFields.some((field) => field.id === current.fieldId) ? current.fieldId : nextActiveFields[0]?.id ?? '' })); setOpenTests(new Set(nextTests.filter((test) => test.field_id === nextSelected).slice(0, 1).map((test) => test.id))); setAttentionQueueKey(queueKey)
  }
  useEffect(() => { void refresh().catch((caught) => setError(farmerError(caught, 'load Soil Rx'))).finally(() => setLoading(false)) }, [])
  const fieldTests = useMemo(() => sortSoilTestsNewestFirst(tests.filter((test) => test.field_id === selectedField?.id)), [tests, selectedField?.id])
  const harvestRemoval = useMemo(() => harvestAssignments.filter((crop) => crop.field_id === selectedField?.id).map((crop) => removalEstimate(crop, commodities.find((commodity) => commodity.id === crop.commodity_id))).filter((estimate): estimate is NonNullable<typeof estimate> => estimate !== null), [harvestAssignments, commodities, selectedField?.id])
  const hasUnsupportedHarvest = harvestAssignments.some((crop) => crop.field_id === selectedField?.id && crop.harvested_bushels !== null && !Object.hasOwn(nutrientRemovalCoefficients, commodities.find((commodity) => commodity.id === crop.commodity_id)?.crop_family ?? ''))

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
  function chooseField(fieldId: string) { setSelectedFieldId(fieldId); if (activeFields.some((field) => field.id === fieldId)) setForm((current) => ({ ...current, fieldId })); setOpenTests(new Set(sortSoilTestsNewestFirst(tests.filter((test) => test.field_id === fieldId)).slice(0, 1).map((test) => test.id))) }
  function selectReport(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0] ?? null; const problem = file ? validateSoilReportFile(file) : null; if (problem) event.target.value = ''; setReport(problem ? null : file); setError(problem) }
  async function openReport(test: SoilTest) { if (!test.attachment) return; const popup = window.open('about:blank', '_blank'); if (!popup) { setError('Your browser blocked the lab report window. Allow pop-ups for Farm Rx and try again.'); return }; popup.opener = null; setError(null); try { const url = await repository.getReportUrl(test.attachment.storage_path); if (popup.closed) throw new Error('The lab report window was closed.'); popup.location.replace(url) } catch (caught) { popup.close(); setError(farmerError(caught, 'open this report')) } }

  return <section className="page soil-rx-page" aria-labelledby="soil-rx-title">
    <header className="page-header"><div><p className="eyebrow">Field fertility records</p><h1 id="soil-rx-title">Soil Rx</h1><p>Keep your lab results together by field. Crop RX only sees them if you share farm data in Privacy.</p></div></header>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p className="save-success" role="status">{message}</p>}
    <NeedsAttentionList module="soilRx" queueKey={attentionQueueKey} onRetry={(row) => repository.retryNeedsAttention?.(row.queueKey, row.id)} onDismiss={(row) => repository.dismissNeedsAttention?.(row.queueKey, row.id)} onChanged={refresh} />
    {loading ? <p className="loading-state">Loading Soil Rx…</p> : <>
      {!fields.length ? <p className="soil-rx-empty">Add a field before saving a soil test.</p> : <>
        <div className="soil-rx-layout">
          <aside className="soil-rx-fields" aria-label="Fields"><h2>Your fields</h2>{fields.map((field) => <button key={field.id} type="button" className={field.id === selectedField?.id ? 'active' : ''} onClick={() => chooseField(field.id)}>{field.name}{!field.isActive && ' (Archived)'}<small>{tests.filter((test) => test.field_id === field.id).length} tests</small></button>)}</aside>
          <div className="soil-rx-history"><h2>{selectedField?.name ?? 'Field'} history</h2>{selectedField && !selectedField.isActive && <p className="card-empty">This field is archived. Its Soil Rx history remains available, but new tests can only be added to active fields.</p>}<HarvestRemoval estimates={harvestRemoval} hasUnsupportedHarvest={hasUnsupportedHarvest} />{fieldTests.length ? fieldTests.map((test) => <SoilTestCard key={test.id} test={test} expanded={openTests.has(test.id)} onToggle={() => setOpenTests((current) => { const next = new Set(current); next.has(test.id) ? next.delete(test.id) : next.add(test.id); return next })} onOpen={() => void openReport(test)} />) : <p className="soil-rx-empty">No soil tests saved for this field yet.</p>}</div>
        </div>
        {canEdit && selectedField?.isActive && <form className="soil-rx-form" onSubmit={save}><header><h2>Add a soil test</h2><p>Lab name and sample date are required. Leave a measurement blank when it was not reported.</p></header>
          <div className="soil-rx-form-grid"><label>Field<select value={form.fieldId} onChange={(event) => chooseField(event.target.value)} required>{activeFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label><label>Lab name<input value={form.labName} onChange={(event) => setForm((current) => ({ ...current, labName: event.target.value }))} maxLength={160} required /></label><label>Sample date<input type="date" value={form.sampleDate} onChange={(event) => setForm((current) => ({ ...current, sampleDate: event.target.value }))} required /></label></div>
          <details className="soil-rx-measurements"><summary>Add lab measurements (optional)</summary><div>{soilMeasurementKeys.map((key) => <label key={key}>{labels[key]}<input type="number" step="0.001" value={form.measurements[key]} onChange={(event) => setForm((current) => ({ ...current, measurements: { ...current.measurements, [key]: event.target.value } }))} /></label>)}</div></details>
          <label className="soil-rx-report">Lab report (optional, PDF or image, up to 20 MB)<input type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/heif" onChange={selectReport} />{report && <small>{report.name}</small>}{offline && <small>Attachments need a connection. Text-only tests can still save now.</small>}</label>
          <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Saving soil test…' : 'Save soil test'}</button>
        </form>}
      </>}
    </>}
  </section>
}

function HarvestRemoval({ estimates, hasUnsupportedHarvest }: { estimates: Array<NonNullable<ReturnType<typeof removalEstimate>>>; hasUnsupportedHarvest: boolean }) {
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
  return <section className="soil-rx-removal" aria-label="Harvest nutrient removal estimate"><h3>Harvest nutrient removal estimate</h3><p>Each line is one recorded crop assignment. Farm Rx does not combine years or planting sequences. This read-only estimate from recorded harvested bushels is not a fertilizer recommendation. Ask your Crop RX agronomist for recommendations specific to your farm.</p>{estimates.map((estimate) => <section key={estimate.id} aria-label={`${estimate.crop} ${estimate.cropYear} planting ${estimate.plantingSequence} removal estimate`}><h4>{estimate.crop} · {estimate.cropYear} · planting {estimate.plantingSequence} · {number.format(estimate.bushels)} bu on {number.format(estimate.acres)} ac</h4><dl>{estimate.nutrients.map((nutrient) => <div key={nutrient.label}><dt>{nutrient.label}</dt><dd>{number.format(nutrient.amount)} lb total · {number.format(nutrient.amount / estimate.acres)} lb/ac</dd></div>)}</dl></section>)}{!estimates.length && <p className="card-empty">No harvested corn or soybeans with planted acres are recorded for this field yet.</p>}{hasUnsupportedHarvest && <p className="card-empty">Harvest-removal estimates are available for corn and soybeans only.</p>}<p><a href={nutrientRemovalSources.cornNitrogen.url} target="_blank" rel="noreferrer">Source for corn N (0.60 lb/bu): {nutrientRemovalSources.cornNitrogen.label}</a>.</p><p><a href={nutrientRemovalSources.soybeanNitrogen.url} target="_blank" rel="noreferrer">Source for soybean N (3.44 lb/bu): {nutrientRemovalSources.soybeanNitrogen.label}</a>.</p><p><a href={nutrientRemovalSources.phosphorusPotassium.url} target="_blank" rel="noreferrer">Source for corn and soybean P₂O₅ and K₂O: {nutrientRemovalSources.phosphorusPotassium.label}</a>. P₂O₅ and K₂O are reported in fertilizer-equivalent units.</p></section>
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
  return <section className="soil-rx-guide" aria-label="Understand this report"><h3>Understand this report</h3><p>These are descriptions of the values reported by your lab, not agronomic advice, target ranges, or a fertilizer recommendation.</p><p>Ask your Crop RX agronomist for recommendations specific to your farm.</p><dl>{values.map(([label, explanation, value, unit]) => <div key={label}><dt>{label}</dt><dd>{explanation} {`Lab result: ${value === null ? 'Not reported' : `${value}${unit ? ` ${unit}` : ''}`}`}</dd></div>)}</dl><section aria-label="Base saturation lab values"><h4>Base saturation</h4><p>Base saturation shows the lab-reported share of CEC occupied by each listed nutrient.</p><dl>{baseSaturation.map(([name, amount]) => <div key={name}><dt>{name}</dt><dd>{amount === null ? 'Not reported' : `${amount}%`}</dd></div>)}</dl></section></section>
}
