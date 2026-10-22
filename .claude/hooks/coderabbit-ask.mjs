// PreToolUse guard: CodeRabbit runs on Farm Rx only when Mason asks for it
// (2026-10-21). Any GitHub CLI command that mentions @coderabbitai stops and
// asks him first, even though `gh pr comment` is otherwise allowed.
import { readFileSync } from 'node:fs'

let command = ''
try {
  command = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.command ?? ''
} catch {
  process.exit(0)
}

if (/\bgh\b/.test(command) && /@coderabbit/i.test(command)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: 'This would ask CodeRabbit to post on a Farm Rx pull request. CodeRabbit runs only when Mason asks for it.',
    },
  }))
}
