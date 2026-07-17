#!/usr/bin/env bash
set -euo pipefail
P='/c/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/docs/audits/2026-07-16-farmer-simplicity-loop/TERRA-TRANCHE-1-FINAL-REVIEW-14-PROMPT.md'
O='C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\docs\audits\2026-07-16-farmer-simplicity-loop\TERRA-TRANCHE-1-FINAL-REVIEW-14-OUTPUT.md'
W='C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity'
export TSX_DISABLE_CACHE=1
codex exec -m gpt-5.6-terra -c 'model_reasoning_effort="medium"' -c 'approval_policy="never"' -s read-only -C "$W" -o "$O" "$(cat "$P")" < /dev/null
