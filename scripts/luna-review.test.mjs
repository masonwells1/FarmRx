// Self-check for the Luna verdict parser: only a complete, single, final verdict counts.
import assert from 'node:assert/strict'
import { buildPrompt, classify } from './luna-review.mjs'

const canary = 'FARMRX-TEST'
const ok = (body) => classify({ status: 0, error: null, finalText: body, canary })

assert.deepEqual(ok(`no issues\n${canary}-END\nLUNA_REVIEW: CLEAN`), { outcome: 'clean' })
assert.deepEqual(ok(`HIGH a.ts:1 bug\n${canary}-END\nLUNA_REVIEW: FINDINGS 1\n`), { outcome: 'findings', count: 1 })
assert.equal(ok('LUNA_REVIEW: CLEAN').outcome, 'void', 'missing canary means the diff was not read')
assert.equal(ok(`${canary}-END\nLUNA_REVIEW: CLEAN\nLUNA_REVIEW: FINDINGS 2`).outcome, 'void', 'two verdicts')
assert.equal(ok(`${canary}-END\nLUNA_REVIEW: CLEAN\nmore text`).outcome, 'void', 'verdict must be last')
assert.equal(ok(`${canary}-END\nLUNA_REVIEW: FINDINGS 0`).outcome, 'void', 'zero findings is not a verdict')
assert.equal(classify({ status: 1, error: null, finalText: `${canary}-END\nLUNA_REVIEW: CLEAN`, canary }).outcome, 'void')
assert.equal(classify({ status: null, error: new Error('ETIMEDOUT'), finalText: '', canary }).outcome, 'void')
assert.match(buildPrompt('+x', canary), /tail canary: FARMRX-TEST-END/)

console.log('Luna review parser tests passed.')
