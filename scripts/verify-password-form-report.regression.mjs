import { verifyPasswordFormReport } from './verify-password-form-report.mjs'

const passedTest = (projectName) => ({ projectName, expectedStatus: 'passed', status: 'expected', annotations: [], results: [{ status: 'passed' }] })
const report = (tests, stats) => ({ stats, suites: [{ specs: [{ tests }], suites: [] }] })
const passingStats = { expected: 2, skipped: 0, unexpected: 0, flaky: 0 }
const mustReject = (label, candidate) => {
  try { verifyPasswordFormReport(candidate) } catch { return }
  throw new Error(`Password-form report verifier accepted controlled ${label} output.`)
}

verifyPasswordFormReport(report([passedTest('password-form-desktop'), passedTest('password-form-phone')], passingStats))
mustReject('skip-all', report([
  { projectName: 'password-form-desktop', expectedStatus: 'skipped', status: 'skipped', annotations: [{ type: 'skip' }], results: [{ status: 'skipped' }] },
  { projectName: 'password-form-phone', expectedStatus: 'skipped', status: 'skipped', annotations: [{ type: 'skip' }], results: [{ status: 'skipped' }] },
], { expected: 0, skipped: 2, unexpected: 0, flaky: 0 }))
mustReject('zero-test', report([], { expected: 0, skipped: 0, unexpected: 0, flaky: 0 }))
mustReject('failed-test', report([
  { projectName: 'password-form-desktop', expectedStatus: 'passed', status: 'unexpected', annotations: [], results: [{ status: 'failed' }] },
  passedTest('password-form-phone'),
], { expected: 1, skipped: 0, unexpected: 1, flaky: 0 }))
mustReject('wrong-project', report([passedTest('password-form-desktop'), passedTest('password-form-tablet')], passingStats))

console.log('Password-form report verifier regression: PASS (skip-all, zero-test, failure, and wrong-project reports rejected).')
