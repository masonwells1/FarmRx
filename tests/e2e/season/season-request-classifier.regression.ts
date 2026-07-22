import assert from 'node:assert/strict'
import { createSeasonRequestClassifier } from './season-request-classifier'

const immediateRpc = createSeasonRequestClassifier({ blockUnexpectedNonReadRequests: true })
assert.equal(immediateRpc.observe('POST', 'http://127.0.0.1:55321/auth/v1/token?grant_type=password').block, false)
const immediateMutation = immediateRpc.observe('POST', 'http://127.0.0.1:55321/rest/v1/rpc/generate_due_program_items')
assert.equal(immediateMutation.kind, 'unexpected-rpc')
assert.equal(immediateMutation.block, true)
assert.deepEqual(immediateRpc.unexpectedRpcs, ['POST /rest/v1/rpc/generate_due_program_items'])

const directRestMutation = immediateRpc.observe('PATCH', 'http://127.0.0.1:55321/rest/v1/farm_tasks?id=eq.synthetic')
assert.equal(directRestMutation.kind, 'unexpected-non-read')
assert.equal(directRestMutation.block, true)
assert.deepEqual(immediateRpc.blockedNonReadRequests, ['PATCH /rest/v1/farm_tasks'])

const exactDirect = createSeasonRequestClassifier({ targetMutationRequests: ['PATCH /rest/v1/production_estimates'], blockUnexpectedNonReadRequests: true })
exactDirect.observe('POST', 'http://127.0.0.1:55321/auth/v1/token?grant_type=password')
assert.equal(exactDirect.observe('PATCH', 'http://127.0.0.1:55321/rest/v1/production_estimates?id=eq.synthetic').kind, 'target-mutation-path')
assert.deepEqual(exactDirect.observedTargetMutationPaths, ['PATCH /rest/v1/production_estimates'])
const wrongDirectMethod = exactDirect.observe('POST', 'http://127.0.0.1:55321/rest/v1/production_estimates')
assert.equal(wrongDirectMethod.kind, 'unexpected-non-read')
assert.equal(wrongDirectMethod.block, true)

for (const statusRpc of ['program_due_generation_status', 'service_due_generation_status']) {
  const status = immediateRpc.observe('POST', `http://127.0.0.1:55321/rest/v1/rpc/${statusRpc}`)
  assert.equal(status.kind, 'read-only-rpc')
  assert.equal(status.block, false)
}
for (const generatorRpc of ['generate_due_program_items', 'generate_due_program_items_v2', 'generate_due_service_tasks', 'generate_due_service_tasks_v2']) {
  const classifier = createSeasonRequestClassifier({ blockUnexpectedNonReadRequests: true })
  classifier.observe('POST', 'http://127.0.0.1:55321/auth/v1/token?grant_type=password')
  const result = classifier.observe('POST', `http://127.0.0.1:55321/rest/v1/rpc/${generatorRpc}`)
  assert.equal(result.kind, 'unexpected-rpc')
  assert.equal(result.block, true)
}

for (const authUrl of [
  'http://127.0.0.1:55321/auth/v1/token?grant_type=refresh_token',
  'http://127.0.0.1:55321/auth/v1/token',
  'http://127.0.0.1:55321/auth/v1/token?grant_type=password&unexpected=true',
]) {
  const wrongGrant = createSeasonRequestClassifier({ blockUnexpectedNonReadRequests: true })
  wrongGrant.observe('POST', authUrl)
  assert.equal(wrongGrant.observe('POST', 'http://127.0.0.1:55321/rest/v1/rpc/generate_due_program_items').kind, 'pre-auth')
  assert.deepEqual(wrongGrant.unexpectedRpcs, [])
}

const wrongMethod = createSeasonRequestClassifier({ blockUnexpectedNonReadRequests: true })
wrongMethod.observe('GET', 'http://127.0.0.1:55321/auth/v1/token?grant_type=password')
assert.equal(wrongMethod.observe('POST', 'http://127.0.0.1:55321/rest/v1/rpc/generate_due_program_items').kind, 'pre-auth')

for (const method of ['GET', 'PATCH', 'DELETE']) {
  const nonPostReadName = createSeasonRequestClassifier({ blockUnexpectedNonReadRequests: true })
  nonPostReadName.observe('POST', 'http://127.0.0.1:55321/auth/v1/token?grant_type=password')
  const result = nonPostReadName.observe(method, 'http://127.0.0.1:55321/rest/v1/rpc/can_access_farm')
  assert.equal(result.kind, 'unexpected-rpc')
  assert.equal(result.block, true)
}

console.log('SEASON_REQUEST_CLASSIFIER_REGRESSION_PASS')
