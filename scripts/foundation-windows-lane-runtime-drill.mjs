// Executable drills over the Windows execution lane's runtime accounting.
//
// Why this file exists as a separate gate. scripts/foundation-static-guards.mjs asserts that certain
// lines are PRESENT in scripts/verify-foundation.ps1, and scripts/verify-foundation-mutations.mjs
// asserts that removing one of those lines turns a named guard red. Neither observes behavior: a line
// can be present and unreachable, and an adversarial review demonstrated three edits that keep every
// pinned line intact while the lane does nothing. Two of them are caught by the accounting function
// inside the orchestrator. The third is not, because it defeats the accounting's own in-process probe:
// the probe drives the accounting from a loop, so a forged accounting can read the probe's loop
// variable out of the caller's scope, echo each expected message back, and then return silently when
// the real call arrives. Measured against the orchestrator before this file existed, that forgery
// passed the probe and the real check end to end.
//
// So these drills run the accounting OUT OF PROCESS, from a top-level script scope with no probe frame
// above it, against a mutated copy of the orchestrator's own function definitions. The forgery above
// has nothing to detect there, so its silent-return branch is the one that executes and the drill sees
// it. Case 'lane call removed entirely' is the one that catches it.
//
// What these drills still do not prove: that the lane really executed on a real run. An editor who
// rewrites this file and the orchestrator together, consistently, defeats both. Only executing the lane
// on a runner that does not take the Windows skip closes that, and .github/workflows/foundation.yml
// runs on ubuntu-latest. The cases below are cheap, they run everywhere, and none of them starts the
// real regression chain - they mutate function definitions and exercise the bookkeeping only.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ORCHESTRATOR = 'scripts/verify-foundation.ps1'
const MARKER = 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS'
// Every case slices the orchestrator here. The anchor is the first executable statement after the
// function definitions, so the slice is exactly "the functions and nothing that runs them". If the
// anchor ever disappears this file throws rather than silently drilling an empty string.
const ANCHOR = 'Push-Location $root'

// Normalize to LF before anything looks for a needle. The mutation needles below end in '\n', and this
// repository carries no .gitattributes rule forcing LF, so a CRLF checkout would leave every needle
// unmatched. That surfaces as "the mutation no longer applies" rather than as a silent pass, but it
// fails the gate on the operator's line endings instead of on a defect. PowerShell reads LF happily.
const source = readFileSync(ORCHESTRATOR, 'utf8').replace(/\r\n/g, '\n')
const anchorIndex = source.indexOf(ANCHOR)
if (anchorIndex < 0) throw new Error(`${ORCHESTRATOR} no longer contains the ${JSON.stringify(ANCHOR)} anchor these drills slice at.`)
const definitions = source.slice(0, anchorIndex)

const onWindows = process.platform === 'win32'
const shell = onWindows ? 'powershell' : 'pwsh'

const LANE = 'function Invoke-FoundationWindowsExecutionLane {\n'
const ACCOUNTING = 'function Assert-FoundationWindowsExecutionLaneAccountedFor {\n'

// Each case: how to mutate the definitions, what the harness does, and what must happen.
// expectReal: a message the real accounting call must throw, or null meaning it must stay silent.
// expectProbe: 'passes' | 'fails' | 'either' - 'either' is only for a case where the mutation is
// required to be detected by one layer or the other, and the drill does not care which.
const CASES = [
  {
    label: 'bare return at the top of the lane',
    mutate: (s) => s.replace(LANE, `${LANE}  return\n`),
    callLane: true,
    expectProbe: 'passes',
    expectReal: 'Foundation Windows execution lane never ran; its outcome was never recorded.',
  },
  {
    label: 'lane asserts its own success, then returns',
    mutate: (s) => s.replace(LANE, `${LANE}  $script:windowsExecutionLaneOutcome = 'executed'\n  return\n`),
    callLane: true,
    expectProbe: 'passes',
    expectReal: 'Foundation Windows execution lane reported an execution it cannot evidence; the chain completion marker is absent from the output it captured.',
  },
  {
    // The case that catches a forged accounting. No mutation at all: the harness simply never calls the
    // lane, which is what `if ($false) { <the exact pinned call line> }` amounts to at runtime.
    label: 'lane call removed entirely',
    mutate: (s) => s,
    mutates: false,
    callLane: false,
    expectProbe: 'passes',
    expectReal: 'Foundation Windows execution lane never ran; its outcome was never recorded.',
  },
  {
    // Positive control for the drill itself. Without it, an accounting function that threw on
    // everything would pass every case above and this file would report success for a broken detector.
    label: 'an evidenced execution is accepted',
    mutate: (s) => s,
    mutates: false,
    callLane: false,
    seed: [`$script:windowsExecutionLaneOutcome = 'executed'`, `$script:windowsExecutionOutput = @('${MARKER}')`],
    expectProbe: 'passes',
    expectReal: null,
  },
  {
    // Sol's probe-detecting forgery, kept as a permanent regression. It is expected to be caught by the
    // probe's positive control; if a future refinement slips past the probe, the real call in the
    // 'lane call removed entirely' case above is the backstop. Either layer firing is a pass here.
    label: 'accounting forged to recognize its own probe',
    mutate: (s) => s.replace(ACCOUNTING, `${ACCOUNTING}  $probeCase = Get-Variable case -Scope 1 -ErrorAction SilentlyContinue\n  if ($null -ne $probeCase) {\n    throw [Exception]::new([string]$probeCase.Value.Expected)\n  }\n  return\n`),
    callLane: false,
    expectProbe: 'either',
    expectReal: 'either',
  },
]

if (onWindows) {
  // Windows-only, because off Windows 'skipped' is the honest answer and the accounting is right to
  // accept it. Asserting a throw here on the ubuntu runner would fail the gate for telling the truth.
  CASES.push({
    label: 'platform gate always takes the skip',
    mutate: (s) => s.replace("if (-not ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows)) {", 'if ($true) {'),
    callLane: true,
    expectProbe: 'passes',
    expectReal: 'Foundation Windows execution lane skipped itself on Windows, where it is required to execute.',
  })
}

// The accounting function must be pure bookkeeping over its two script variables, and this is what makes
// the drill able to speak for a real run at all. Every forgery in this file's history worked by SENSING
// its surroundings and behaving differently: Sol's original read the accounting probe's loop variable out
// of the caller's scope, and the next one distinguishes this drill from the orchestrator by testing
// whether a sibling script exists beside $PSScriptRoot - false in a temp directory, true in scripts/ -
// so it could forge success only on real runs while every layer here stayed green. Rather than trying to
// make a temp copy indistinguishable from the repository, which cannot be done, refuse the vocabulary
// that senses the difference. This is a narrowing of what an editor can write, not a proof of execution.
const PURITY = ['$PSScriptRoot', '$PSCommandPath', '$MyInvocation', 'Get-Variable', 'Get-PSCallStack', 'Test-Path', 'Get-Item', 'Get-ChildItem']
const accountingStart = definitions.indexOf(ACCOUNTING)
if (accountingStart < 0) throw new Error(`${ORCHESTRATOR} no longer defines the accounting function these drills exercise.`)
const accountingEnd = definitions.indexOf('\nfunction ', accountingStart + 1)
const accountingBody = definitions.slice(accountingStart, accountingEnd < 0 ? definitions.length : accountingEnd)
const impurities = PURITY.filter((token) => accountingBody.includes(token))

const harness = (testCase) => [
  '',
  "$ErrorActionPreference = 'Stop'",
  '$probeFailure = $null',
  'try { Assert-FoundationWindowsExecutionLaneAccountingIsFatal | Out-Null } catch { $probeFailure = $_.Exception.Message }',
  'if ($null -eq $probeFailure) { Write-Output \'DRILL-PROBE passed\' } else { Write-Output "DRILL-PROBE failed" }',
  ...(testCase.seed ?? []),
  ...(testCase.callLane ? ['Invoke-FoundationWindowsExecutionLane'] : []),
  '$realFailure = $null',
  'try { Assert-FoundationWindowsExecutionLaneAccountedFor | Out-Null } catch { $realFailure = $_.Exception.Message }',
  'if ($null -eq $realFailure) { Write-Output \'DRILL-REAL silent\' } else { Write-Output "DRILL-REAL threw :: $realFailure" }',
  // Last line, deliberately. Without it a case that ended early - a stray `exit 0` reached through a
  // seed or a mutation - printed no DRILL-REAL line at all, and the two verdicts that tolerate silence
  // ('either' and an expected-null) read a MISSING line as a satisfied expectation. The case then passed
  // having executed nothing, while the count printed at the end still claimed it.
  'Write-Output \'DRILL-COMPLETE\'',
  '',
].join('\n')

const workDir = mkdtempSync(join(tmpdir(), 'farmrx-lane-drill-'))
const failures = []
let completed = 0
if (impurities.length > 0) {
  failures.push(`the accounting function senses its surroundings (${impurities.join(', ')}); these drills cannot speak for a real run while it can tell them apart from one`)
}
try {
  for (const testCase of CASES) {
    const mutated = testCase.mutate(definitions)
    // A mutation that silently stopped applying would turn its case into a test of unmodified source,
    // which passes for the wrong reason. Cases that deliberately do not mutate say so.
    if (testCase.mutates !== false && mutated === definitions) {
      failures.push(`${testCase.label}: the mutation no longer applies to ${ORCHESTRATOR}`)
      continue
    }
    const caseFile = join(workDir, 'lane-drill-case.ps1')
    writeFileSync(caseFile, mutated + harness(testCase), 'utf8')
    let output = ''
    try {
      output = execFileSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', caseFile], { encoding: 'utf8' })
    } catch (error) {
      // A harness that cannot run at all is a failure of this drill, not a detection.
      failures.push(`${testCase.label}: the drill harness did not complete`)
      continue
    }
    const lines = output.split(/\r?\n/)
    const probeLine = lines.find((line) => line.startsWith('DRILL-PROBE')) ?? ''
    const realLine = lines.find((line) => line.startsWith('DRILL-REAL')) ?? ''
    const probePassed = probeLine === 'DRILL-PROBE passed'
    const realThrew = realLine.startsWith('DRILL-REAL threw')

    // Absence is not evidence. Require the harness to have reached the end and to have reported both
    // verdicts before any expectation below is allowed to be satisfied by silence.
    if (!lines.includes('DRILL-COMPLETE')) {
      failures.push(`${testCase.label}: the drill harness did not run to completion`)
      continue
    }
    if (probeLine === '' || realLine === '') {
      failures.push(`${testCase.label}: the drill harness did not report both the probe and the accounting`)
      continue
    }
    completed += 1

    if (testCase.expectProbe === 'passes' && !probePassed) failures.push(`${testCase.label}: the accounting probe did not pass`)
    if (testCase.expectProbe === 'fails' && probePassed) failures.push(`${testCase.label}: the accounting probe passed and should not have`)

    if (testCase.expectReal === 'either') {
      if (probePassed && !realThrew) failures.push(`${testCase.label}: neither the probe nor the accounting detected the forgery`)
      continue
    }
    if (testCase.expectReal === null) {
      if (realThrew) failures.push(`${testCase.label}: the accounting rejected a valid evidenced execution - ${realLine}`)
      continue
    }
    if (!realThrew) {
      failures.push(`${testCase.label}: the accounting stayed silent and should have thrown`)
      continue
    }
    if (realLine !== `DRILL-REAL threw :: ${testCase.expectReal}`) {
      failures.push(`${testCase.label}: the accounting threw an unexpected message - ${realLine}`)
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`Windows lane runtime drill failed: ${failure}`)
  process.exit(1)
}
// Report cases that actually ran to completion, not the length of the array. The two figures used to be
// the same number written from the array, which would have claimed coverage for a case that exited early.
// The count is platform-dependent by design: the Windows-only platform-gate case cannot run on the
// ubuntu-latest CI runner, so CI validates one case fewer and says so rather than printing a fixed total.
if (completed !== CASES.length) {
  console.error(`Windows lane runtime drill failed: only ${completed} of ${CASES.length} cases completed`)
  process.exit(1)
}
console.log(`Foundation Windows lane runtime drill: PASS (${completed} of ${CASES.length} cases executed and validated on ${process.platform})`)
