import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'tests/season/season-2027.manifest.json'), 'utf8'))
const sql = await readFile(resolve(root, 'tests/season/maple-2027-start.sql'), 'utf8')

const fixtures = new Map(manifest.fixtures.map(({ label, uuid }) => [label, uuid]))
const required = [
  'owner user',
  'Maple Ridge farm',
  'Maple Ridge operating entity',
  'Maple known inventory product',
  'Maple cash-bid setup fixture',
]
for (const label of required) {
  const uuid = fixtures.get(label)
  assert(uuid, `Missing manifest fixture: ${label}`)
  assert(sql.includes(uuid), `January fixture does not bind manifest UUID: ${label}`)
}

const insertedTables = [...sql.matchAll(/insert\s+into\s+(?:[a-z_]+\.)?([a-z_]+)/gi)].map((match) => match[1].toLowerCase())
assert.deepEqual(insertedTables, [
  'users',
  'identities',
  'farms',
  'entities',
  'inventory_products',
  'cash_bids',
])

const forbiddenOutcomeTables = [
  'fields', 'field_land_arrangements', 'crop_assignments', 'programs',
  'program_passes', 'program_pass_products', 'program_assignments',
  'assigned_program_passes', 'assigned_program_pass_products',
  'inventory_receipts', 'inventory_receipt_lines', 'application_records',
  'application_products', 'scouting_notes', 'farm_tasks',
  'production_estimates', 'grain_contracts', 'grain_contract_deliveries',
  'grain_bins', 'bin_inventory', 'bin_transactions',
]
for (const table of forbiddenOutcomeTables) {
  assert(!insertedTables.includes(table), `January fixture pre-creates later outcome table: ${table}`)
}

assert(sql.includes("'Maple Ridge', false") && sql.includes("'America/Chicago'"), 'Maple farm start values changed.')
assert(sql.includes("'Synthetic Herbicide 41 — Maple', 'gal', false, true"), 'Maple product start values changed.')
assert(sql.includes("'Synthetic Elevator', 'corn_yellow', '2027-11-10', 0.000000, 4.250000"), 'Maple cash-bid start values changed.')
assert(!/https?:\/\//i.test(sql), 'January fixture must not contain a remote endpoint.')

console.log('Maple Ridge January fixture contract: PASS (5 manifest fixtures; no later monthly outcomes)')
