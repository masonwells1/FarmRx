import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { missingRoutedGuidanceFiles, validateGuidanceText, validateManualCodeRabbit } from './check-agent-guidance.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseline = {
  agents: readFileSync(resolve(root, 'AGENTS.md'), 'utf8'),
  claude: readFileSync(resolve(root, 'CLAUDE.md'), 'utf8'),
  development: readFileSync(resolve(root, 'docs/agent-development-guide.md'), 'utf8'),
  delivery: readFileSync(resolve(root, 'docs/agent-delivery.md'), 'utf8'),
}

assert.deepEqual(validateGuidanceText(baseline), [], 'The checked-in guidance must satisfy its contract.')
assert.deepEqual(
  missingRoutedGuidanceFiles(baseline, (file) => file !== 'docs/branch-inventory-2026-09-03.md'),
  ['docs/branch-inventory-2026-09-03.md'],
  'A missing document routed from AGENTS.md must fail validation.',
)

function mustFail(name, mutate, expected) {
  const changed = mutate({ ...baseline })
  const failures = validateGuidanceText(changed)
  assert(failures.some((failure) => failure.includes(expected)), `${name} did not trigger ${expected}: ${failures.join('; ')}`)
}

mustFail('silent-stop protection removal', (files) => ({
  ...files,
  agents: files.agents.replace('should not have to nudge', 'may need to remind the agent'),
}), 'autonomous momentum')

mustFail('non-coder acknowledgement removal', (files) => ({
  ...files,
  agents: files.agents.replace('cannot safely review code or diffs', 'reviews code and diffs'),
}), 'cannot review code')

mustFail('delivery route removal', (files) => ({
  ...files,
  agents: files.agents.replaceAll('docs/agent-delivery.md', 'docs/missing-delivery-guide.md'),
}), 'protected delivery detail')

mustFail('live-data gate removal', (files) => ({
  ...files,
  agents: files.agents.replace('live migration or live data change', 'database work'),
}), 'protect live data')

mustFail('branch and pull-request authority removal', (files) => ({
  ...files,
  agents: files.agents.replace('Agents may push branches and open, update, label, and comment on pull requests without asking', 'Agents must ask before publishing work'),
}), 'standing branch and pull-request authority')

mustFail('bloated shared contract', (files) => ({
  ...files,
  agents: `${files.agents}${'\nextra'.repeat(101)}`,
}), '100-line')

mustFail('Claude detail duplication', (files) => ({
  ...files,
  claude: `${files.claude}\nexpected_bushels`,
}), 'duplicates shared')

const manualCodeRabbit = {
  codeRabbit: readFileSync(resolve(root, '.coderabbit.yaml'), 'utf8'),
  automationSources: {
    '.github/workflows/foundation.yml': readFileSync(resolve(root, '.github/workflows/foundation.yml'), 'utf8'),
  },
}

assert.deepEqual(validateManualCodeRabbit(manualCodeRabbit), [], 'The checked-in CodeRabbit configuration must be manual-only.')

assert(
  validateManualCodeRabbit({
    ...manualCodeRabbit,
    codeRabbit: manualCodeRabbit.codeRabbit.replace('    enabled: false', '    enabled: true'),
  }).some((failure) => failure.includes('automatic reviews must stay disabled')),
  'Enabling automatic reviews must fail validation.',
)

assert(
  validateManualCodeRabbit({
    ...manualCodeRabbit,
    codeRabbit: manualCodeRabbit.codeRabbit.replace('    labels: []', '    labels: ["review-ready"]'),
  }).some((failure) => failure.includes('label-triggered reviews must stay disabled')),
  'Adding a label-triggered review must fail validation.',
)

assert(
  validateManualCodeRabbit({
    ...manualCodeRabbit,
    automationSources: { '.github/workflows/automation.yml': 'run: gh pr comment --body "@coderabbitai review"' },
  }).some((failure) => failure.includes('must not automate CodeRabbit review requests')),
  'A workflow-posted review command must fail validation.',
)

console.log('Agent guidance mutation tests passed.')
