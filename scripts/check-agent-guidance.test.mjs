import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGuidanceText } from './check-agent-guidance.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseline = {
  agents: readFileSync(resolve(root, 'AGENTS.md'), 'utf8'),
  claude: readFileSync(resolve(root, 'CLAUDE.md'), 'utf8'),
  development: readFileSync(resolve(root, 'docs/agent-development-guide.md'), 'utf8'),
  delivery: readFileSync(resolve(root, 'docs/agent-delivery.md'), 'utf8'),
}

assert.deepEqual(validateGuidanceText(baseline), [], 'The checked-in guidance must satisfy its contract.')

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

mustFail('bloated shared contract', (files) => ({
  ...files,
  agents: `${files.agents}${'\nextra'.repeat(101)}`,
}), '100-line')

mustFail('Claude detail duplication', (files) => ({
  ...files,
  claude: `${files.claude}\nready-for-coderabbit`,
}), 'duplicates shared')

console.log('Agent guidance mutation tests passed.')
