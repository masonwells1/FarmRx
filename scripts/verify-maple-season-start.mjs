import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'tests/season/season-2027.manifest.json'), 'utf8'))
const sql = await readFile(resolve(root, 'tests/season/maple-2027-start.sql'), 'utf8')
const proofSql = await readFile(resolve(root, 'tests/season/maple-2027-start.verify.sql'), 'utf8')
const seedSql = await readFile(resolve(root, 'supabase/seed.sql'), 'utf8')
const credentialHelper = await readFile(resolve(root, 'scripts/maple-season-credential.ps1'), 'utf8')
const credentialRegression = await readFile(resolve(root, 'scripts/maple-season-credential.regression.ps1'), 'utf8')
const requestClassifier = await readFile(resolve(root, 'tests/e2e/season/season-request-classifier.ts'), 'utf8')
const requestClassifierRegression = await readFile(resolve(root, 'tests/e2e/season/season-request-classifier.regression.ts'), 'utf8')
const startRunner = await readFile(resolve(root, 'scripts/verify-maple-season-start-disposable.ps1'), 'utf8')
const monthNames = ['january', 'february', 'march', 'april', 'may', 'june']
const monthRunners = await Promise.all(monthNames.map((month) => readFile(resolve(root, `scripts/verify-maple-${month}-disposable.ps1`), 'utf8')))

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
assert(sql.includes("crypt(set_config('farmrx.season_owner_password', :'season_owner_password', true), gen_salt('bf', 10))"), 'January fixture must build a freshly salted bcrypt verifier from the process-only transaction credential.')
assert(!/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/.test(`${sql}\n${seedSql}`), 'Season fixture and default seed must not commit a reusable bcrypt verifier.')
assert(seedSql.includes("crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf', 10))"), 'Default local seed must use a non-reusable random verifier.')
assert(!sql.includes('season_password_set') && !sql.includes('season_password_cleared'), 'January fixture must not copy the credential into a persistent psql variable.')
assert(proofSql.includes("set_config('farmrx.season_owner_password', :'season_owner_password', true) \\g /dev/null"), 'January proof must load the credential into transaction-local state without printing it.')
assert(proofSql.includes("encrypted_password = crypt(current_setting('farmrx.season_owner_password'), encrypted_password)"), 'January proof must verify the generated credential against the exact owner verifier.')
for (const [index, runner] of monthRunners.entries()) {
  assert(runner.includes('maple-season-credential.ps1'), `${monthNames[index]} runner does not load the generated credential helper.`)
  assert(runner.includes('Enter-MapleSeasonCredential') && runner.includes('Exit-MapleSeasonCredential'), `${monthNames[index]} runner does not own the generated credential lifecycle.`)
  assert(!runner.includes('FARMRX_SEASON_OWNER_PASSWORD is required'), `${monthNames[index]} runner still requires an externally supplied password.`)
  const boundaryIndex = runner.indexOf('Assert-MapleSeasonLocalBoundary')
  const enterIndex = runner.indexOf('Enter-MapleSeasonCredential')
  assert(boundaryIndex >= 0 && enterIndex >= 0 && boundaryIndex < enterIndex, `${monthNames[index]} runner does not establish the local boundary before credential entry.`)
  assert((runner.match(/Enter-MapleSeasonCredential/g) ?? []).length === 1, `${monthNames[index]} runner must enter the credential exactly once.`)
  assert(!runner.includes('RandomNumberGenerator') && !runner.includes('gen_random_bytes'), `${monthNames[index]} runner must delegate generation to the shared helper.`)
}
const startBoundaryIndex = startRunner.indexOf('Assert-MapleSeasonLocalBoundary')
const startEnterIndex = startRunner.indexOf('Enter-MapleSeasonCredential')
const startResetIndex = startRunner.indexOf('db reset --local')
const regressionInvocationIndex = startRunner.indexOf('& powershell -NoProfile -ExecutionPolicy Bypass -File $credentialRegressionPath')
const classifierRegressionInvocationIndex = startRunner.indexOf('npx tsx $requestClassifierRegressionPath')
assert(startBoundaryIndex >= 0 && startEnterIndex >= 0 && startBoundaryIndex < startEnterIndex, 'Season-start runner must establish the local boundary before credential entry.')
assert(startEnterIndex >= 0 && startResetIndex >= 0 && startEnterIndex < startResetIndex, 'Season-start runner must own its credential before the one reset.')
assert(regressionInvocationIndex >= 0 && regressionInvocationIndex < startEnterIndex && regressionInvocationIndex < startResetIndex, 'Season-start runner must pass the credential regression before credential entry and reset.')
assert(classifierRegressionInvocationIndex >= 0 && classifierRegressionInvocationIndex < startEnterIndex && classifierRegressionInvocationIndex < startResetIndex, 'Season-start runner must pass the request classifier regression before credential entry and reset.')
assert((`${startRunner}\n${monthRunners.join('\n')}`.match(/db reset --local/g) ?? []).length === 1, 'The January-June chain must contain exactly one local reset, owned by season start.')
assert(credentialHelper.includes('Get-MapleSeasonAncestorProcessIds') && credentialHelper.includes('FARMRX_SEASON_CREDENTIAL_CHAIN'), 'Nested credentials must bind to a random chain marker and live ancestor.')
assert(credentialHelper.includes('[Threading.EventWaitHandle]::new') && credentialHelper.includes('[Threading.EventWaitHandle]::OpenExisting') && credentialHelper.includes('FARMRX_SEASON_CREDENTIAL_HANDSHAKE'), 'Nested credentials must require a process-owned named kernel handshake.')
assert(credentialRegression.includes('LIVE_PARENT_SPOOF_REJECT_PASS') && credentialRegression.includes('[Threading.EventWaitHandle]::OpenExisting'), 'Credential regression must reject a live-parent environment spoof and prove owner cleanup.')
assert(requestClassifier.includes("method === 'POST' && readOnlySeasonAccessRpcs.has(rpcName)"), 'Read-only RPC names must be accepted only with the exact POST method.')
assert(requestClassifierRegression.includes("for (const method of ['GET', 'PATCH', 'DELETE'])"), 'Request classifier regression must block non-POST methods using read-only RPC names.')
assert(credentialHelper.includes("psql -X -q") && credentialHelper.includes("2>&1") && credentialHelper.includes("$exitCode = $LASTEXITCODE"), 'Credentialed psql must ignore psqlrc, run quietly, capture native output, and capture exit immediately.')
assert(!/Write-(?:Host|Output)[^\n]*(?:PASSWORD|password|credential)/.test(credentialHelper), 'Credential helper must not print credential state.')
assert(!credentialHelper.includes('New-TemporaryFile') && !credentialHelper.includes('.env'), 'Credential helper must not persist its credential to a file.')

console.log('Maple Ridge January fixture contract: PASS (generated local credential; 5 manifest fixtures; no later monthly outcomes)')
