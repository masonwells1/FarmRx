#!/usr/bin/env bash
set -euo pipefail

PROMPT_PATH='/c/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/docs/audits/2026-07-16-farmer-simplicity-loop/SOL-TRANCHE-1-CORRECTION-PROMPT.md'
OUTPUT_PATH='C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\docs\audits\2026-07-16-farmer-simplicity-loop\SOL-TRANCHE-1-CORRECTION-OUTPUT.md'
WORKTREE='C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity'
PROMPT="$(cat "$PROMPT_PATH")"

codex exec \
  -m gpt-5.6-sol \
  -c 'model_reasoning_effort="high"' \
  -c 'approval_policy="never"' \
  -s workspace-write \
  -C "$WORKTREE" \
  -o "$OUTPUT_PATH" \
  "$PROMPT" < /dev/null
