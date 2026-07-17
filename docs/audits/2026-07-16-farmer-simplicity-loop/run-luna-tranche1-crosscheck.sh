#!/usr/bin/env bash
set -euo pipefail

PROMPT_PATH='/c/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/docs/audits/2026-07-16-farmer-simplicity-loop/LUNA-TRANCHE-1-CROSSCHECK-PROMPT.md'
OUTPUT_PATH='C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\docs\audits\2026-07-16-farmer-simplicity-loop\LUNA-TRANCHE-1-CROSSCHECK-OUTPUT.md'
WORKTREE='C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity'
PROMPT="$(cat "$PROMPT_PATH")"

codex exec \
  -m gpt-5.6-luna \
  -c 'model_reasoning_effort="medium"' \
  -c 'approval_policy="never"' \
  -s read-only \
  -C "$WORKTREE" \
  -o "$OUTPUT_PATH" \
  "$PROMPT" < /dev/null
