import { readFileSync } from 'node:fs'

const expectedProjects = ['password-form-desktop', 'password-form-phone']

function collectTests(suites, tests = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) tests.push(...(spec.tests ?? []))
    collectTests(suite.suites, tests)
  }
  return tests
}

export function verifyPasswordFormReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Password-form report is not an object.')
  const stats = report.stats
  if (!stats || stats.expected !== 2 || stats.skipped !== 0 || stats.unexpected !== 0 || stats.flaky !== 0) {
    throw new Error(`Password-form report counts were not exactly 2 passed, 0 skipped, 0 failed, 0 flaky: ${JSON.stringify(stats)}`)
  }

  const tests = collectTests(report.suites)
  if (tests.length !== 2) throw new Error(`Password-form report contained ${tests.length} tests instead of 2.`)
  const projects = tests.map((test) => test.projectName).sort()
  if (JSON.stringify(projects) !== JSON.stringify(expectedProjects)) throw new Error(`Password-form report projects were wrong: ${JSON.stringify(projects)}`)

  for (const test of tests) {
    const statuses = (test.results ?? []).map((result) => result.status)
    if (test.expectedStatus !== 'passed' || test.status !== 'expected' || statuses.length !== 1 || statuses[0] !== 'passed') {
      throw new Error(`Password-form project ${test.projectName} did not pass exactly once: ${JSON.stringify({ expectedStatus: test.expectedStatus, status: test.status, statuses })}`)
    }
    if ((test.annotations ?? []).some((annotation) => annotation.type === 'skip')) throw new Error(`Password-form project ${test.projectName} was skipped.`)
  }

  return { passed: 2, projects }
}

if (process.argv[1] && process.argv[1].endsWith('verify-password-form-report.mjs')) {
  const path = process.argv[2]
  if (!path) throw new Error('Password-form report path is required.')
  const result = verifyPasswordFormReport(JSON.parse(readFileSync(path, 'utf8')))
  console.log(`Password-form JSON report verified: ${result.passed} passed, 0 skipped, 0 failed (${result.projects.join(', ')}).`)
}
