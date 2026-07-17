#!/usr/bin/env bash
set -euo pipefail
P='/c/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/docs/audits/2026-07-16-farmer-simplicity-loop/LUNA-TRANCHE-1-FINAL-REVIEW-28-PROMPT.md'
O='C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\docs\audits\2026-07-16-farmer-simplicity-loop\LUNA-TRANCHE-1-FINAL-REVIEW-28-OUTPUT.md'
codex exec --model gpt-5.6-luna --config 'model_reasoning_effort="medium"' --sandbox read-only --output-last-message "$O" - < "$P"
