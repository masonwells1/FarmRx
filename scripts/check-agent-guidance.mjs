import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const defaultRoot = resolve(here, '..')

function lines(text) {
  return text.replace(/\r\n/g, '\n').split('\n').length
}

function requireText(failures, file, text, phrase, reason) {
  if (!text.includes(phrase)) failures.push(`${file}: ${reason}`)
}

export function validateGuidanceText({ agents, claude, development, delivery }) {
  const failures = []

  if (lines(agents) > 100) failures.push('AGENTS.md: exceeds the 100-line lean-contract limit')
  if (lines(claude) > 25) failures.push('CLAUDE.md: exceeds the 25-line Claude-router limit')

  requireText(failures, 'AGENTS.md', agents, 'cannot safely review code or diffs', 'must acknowledge Mason cannot review code')
  requireText(failures, 'AGENTS.md', agents, 'should not have to nudge', 'must require autonomous momentum')
  requireText(failures, 'AGENTS.md', agents, 'what failed, what it means, and what is being tried next', 'must explain failures and recovery')
  requireText(failures, 'AGENTS.md', agents, 'simplest complete implementation', 'must prefer simple complete code')
  requireText(failures, 'AGENTS.md', agents, 'ran and was observed', 'must require behavioral proof')
  requireText(failures, 'AGENTS.md', agents, 'docs/agent-development-guide.md', 'must route implementation detail')
  requireText(failures, 'AGENTS.md', agents, 'docs/agent-delivery.md', 'must route protected delivery detail')
  requireText(failures, 'AGENTS.md', agents, 'Agents may push branches and open, update, label, and comment on pull requests without asking', 'must preserve standing branch and pull-request authority')
  requireText(failures, 'AGENTS.md', agents, 'live migration or live data change', 'must protect live data')
  requireText(failures, 'AGENTS.md', agents, 'customer communication', 'must protect customer contact')

  requireText(failures, 'CLAUDE.md', claude, '`AGENTS.md` is the canonical shared contract', 'must identify the shared canonical contract')
  for (const duplicatedDetail of ['expected_bushels', 'explicit approval before push']) {
    if (claude.includes(duplicatedDetail)) failures.push(`CLAUDE.md: duplicates shared or task-specific detail (${duplicatedDetail})`)
  }

  for (const phrase of ['fewest moving parts', '18px base', 'Row Level Security', 'expected_bushels', 'npx tsc -b --force']) {
    requireText(failures, 'docs/agent-development-guide.md', development, phrase, `missing development invariant: ${phrase}`)
  }
  for (const phrase of ['may push a feature branch and manage its pull request without asking', 'READY FOR APPROVAL', 'Mason personally posts exactly `@coderabbitai review`', 'An agent must not post that command', 'Foundation and Vercel', '--match-head-commit <sha>', 'formal CodeRabbit review is `APPROVED`']) {
    requireText(failures, 'docs/agent-delivery.md', delivery, phrase, `missing delivery gate: ${phrase}`)
  }

  return failures
}

export function validateManualCodeRabbit({ codeRabbit, workflowSources }) {
  const failures = []
  const autoReview = codeRabbit.match(/^  auto_review:\s*\r?\n((?:^    .*\r?\n?)*)/m)?.[0] ?? ''

  requireText(failures, '.coderabbit.yaml', autoReview, 'enabled: false', 'automatic reviews must stay disabled')
  requireText(failures, '.coderabbit.yaml', autoReview, 'auto_incremental_review: false', 'automatic incremental reviews must stay disabled')
  requireText(failures, '.coderabbit.yaml', autoReview, 'labels: []', 'label-triggered reviews must stay disabled')
  requireText(failures, '.coderabbit.yaml', autoReview, 'description_keyword: ""', 'description-triggered reviews must stay disabled')

  for (const [file, source] of Object.entries(workflowSources)) {
    for (const trigger of ['@coderabbitai review', 'ready-for-coderabbit', 'coderabbit-review-requested']) {
      if (source.includes(trigger)) failures.push(`${file}: GitHub workflows must not automate CodeRabbit review requests (${trigger})`)
    }
  }

  return failures
}

export function routedGuidanceFiles({ agents, claude, development, delivery }) {
  const routes = new Set()
  for (const text of [agents, claude, development, delivery]) {
    for (const match of text.matchAll(/`(docs\/[^`]+\.md)`/g)) routes.add(match[1])
  }
  return [...routes].sort()
}

export function missingRoutedGuidanceFiles(texts, pathExists) {
  return routedGuidanceFiles(texts).filter((file) => !pathExists(file))
}

export function validateRepository(root = defaultRoot) {
  const required = [
    'AGENTS.md',
    'CLAUDE.md',
    'docs/README.md',
    'docs/GOAL.md',
    'docs/farm-rx-handoff.md',
    'docs/agent-development-guide.md',
    'docs/agent-delivery.md',
    'docs/design/README.md',
    'docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md',
    'docs/season-readiness/ORCHESTRATOR-RUNBOOK.md',
    'docs/ship-checklist.md',
  ]
  const missing = required.filter((file) => !existsSync(resolve(root, file)))
  const failures = missing.map((file) => `${file}: routed guidance file does not exist`)
  if (missing.length) return failures

  const texts = {
    agents: readFileSync(resolve(root, 'AGENTS.md'), 'utf8'),
    claude: readFileSync(resolve(root, 'CLAUDE.md'), 'utf8'),
    development: readFileSync(resolve(root, 'docs/agent-development-guide.md'), 'utf8'),
    delivery: readFileSync(resolve(root, 'docs/agent-delivery.md'), 'utf8'),
  }
  failures.push(...validateGuidanceText(texts))
  for (const file of missingRoutedGuidanceFiles(texts, (path) => existsSync(resolve(root, path)))) {
    failures.push(`${file}: routed guidance file does not exist`)
  }

  const docsMap = readFileSync(resolve(root, 'docs/README.md'), 'utf8')
  const codeRabbit = readFileSync(resolve(root, '.coderabbit.yaml'), 'utf8')
  for (const path of ['agent-development-guide.md', 'agent-delivery.md']) {
    requireText(failures, 'docs/README.md', docsMap, path, `must link ${path}`)
    requireText(failures, '.coderabbit.yaml', codeRabbit, `docs/${path}`, `must load ${path} as review guidance`)
  }

  const workflowsRoot = resolve(root, '.github/workflows')
  const workflowSources = Object.fromEntries(
    readdirSync(workflowsRoot)
      .filter((file) => /\.ya?ml$/i.test(file))
      .map((file) => [`.github/workflows/${file}`, readFileSync(resolve(workflowsRoot, file), 'utf8')]),
  )
  failures.push(...validateManualCodeRabbit({ codeRabbit, workflowSources }))
  for (const retiredFile of [
    '.github/workflows/coderabbit-final-review.yml',
    '.github/scripts/coderabbit-final-review.cjs',
    '.github/scripts/coderabbit-final-review.test.cjs',
  ]) {
    if (existsSync(resolve(root, retiredFile))) failures.push(`${retiredFile}: retired automatic CodeRabbit request machinery must stay removed`)
  }
  return failures
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const failures = validateRepository()
  if (failures.length) {
    console.error('Agent guidance contract failed:')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
  } else {
    console.log('Agent guidance contract passed.')
  }
}
