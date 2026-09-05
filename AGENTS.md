# Farm Rx Agent Contract

This is the small shared contract every coding agent loads. Detailed procedures live in the linked guides; do not copy them back here.

## Owner and communication

- Mason Wells owns Farm Rx and has no formal coding background. He cannot safely review code or diffs, so the agent owns the technical process and explains the outcome, business impact, risk, and proof in plain English.
- Be short and direct. Define jargon once when it matters and give one recommended next step.
- Mason should not have to nudge the agent to continue or ask whether it silently stopped. Keep working through every safe, authorized step until the result is complete or a genuine Mason-only gate is reached.
- If a command, tool, check, or approach fails, promptly say what failed, what it means, and what is being tried next. Exhaust safe alternatives without waiting for a nudge.
- If work truly cannot continue, begin with `NEEDS MASON - ACTION REQUIRED` or `NEEDS MASON - DECISION REQUIRED`, then give the blocker, recommendation, consequence of doing nothing, and exact app-native action.

## Read only what the task needs

- Current goal, scope, and status: `docs/GOAL.md` and `docs/README.md`.
- Enduring product, privacy, domain, and architecture rules: `docs/farm-rx-handoff.md`.
- Development, data, UI, and verification rules: `docs/agent-development-guide.md` and, for UI work, `docs/design/README.md`.
- Season-readiness scenarios: `docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md` and `docs/season-readiness/ORCHESTRATOR-RUNBOOK.md`.
- Protected delivery, CodeRabbit, and outward-action gates: `docs/agent-delivery.md`.
- Customer go-live: `docs/ship-checklist.md`.
- Dated branch evidence: `docs/branch-inventory-2026-09-03.md`; reverify before relying on it.

Current source, executable tests, migrations, and live read-only evidence outrank prose, memory, summaries, handoffs, and old reviews.

## Authority and momentum

- `Answer`, `explain`, `review`, `diagnose`, `inspect`, `audit`, `status`, or `plan` authorizes relevant read-only work only.
- `Build`, `change`, `fix`, `finish`, `handle`, or `implement` authorizes the normal reversible local lifecycle: inspect, decide routine details, edit, test, verify, and create a local commit.
- Treat natural requests such as “can you,” “help me,” and “I want” as requests to do the work when the outcome is actionable. Do not stop after a plan or ask “Should I continue?” while safe in-scope work remains.
- Treat `read-only`, `do not write`, `do not push`, `do not merge`, and similar restrictions literally.
- Make routine technical choices from current source and established patterns. Ask only when a missing choice would materially change the business outcome or an exact hard-gated action was not requested.

## Product and code standard

- Build on the existing Farmer Simplicity layer and modules. Do not add a second product architecture, standalone modules, vendors, broad redesigns, speculative features, or proof-only product fields unless Mason explicitly changes the outcome.
- Choose the simplest complete implementation. Prefer readable, direct, focused code and existing patterns over clever compression, speculative abstractions, unnecessary dependencies, or unrelated cleanup.
- Preserve dirty or occupied worktrees and unrelated user changes. Use an isolated current-base worktree for multi-file or risky work.
- Farm Rx has its own Supabase project. Treat `C:\CRX_Manager` as read-only reference material and never modify it from Farm Rx work.
- The 2026-07-18 owner directive says no real farmer use until 2027. Use synthetic fixtures and disposable local services for season proof; never use live customer data.

## Proof and completion

- Done means the changed behavior ran and was observed, not merely that code was written or tests passed.
- Match proof to risk. Use `npx tsc -b --force` for TypeScript verification; follow the development guide for broader checks.
- For substantial work, start with a compact `GOAL`, `DONE WHEN`, `PLAN`, `TOUCHING`, meaningful `RISK`, and normally `NEEDS MASON: Nothing - continuing automatically`.
- Close substantial work with `VERDICT: COMPLETE`, `READY FOR APPROVAL`, `BLOCKED`, or `PARTIAL`. State what changed, proof observed, who owns anything remaining, and one recommended next step.

## Hard outward gates

Agents may push branches and open, update, label, and comment on pull requests without asking (Mason, 2026-09-05). Only Mason personally posts the manual CodeRabbit review command described in the delivery guide. The pre-push hook still refuses any push that targets `main`.

Get Mason's explicit approval in the current conversation before merge; deploy; live migration or live data change; secrets, authentication, or permissions change; customer account action; customer communication; destructive action; purchase; or binding commitment. Local edits, tests, verification, commits, branch pushes, and pull-request work do not authorize a later hard-gated action.

Never expose secrets, bypass hooks or required checks, force-push, push directly to `main`, use destructive recovery, or infer approval from silence. Before protected delivery or another outward action, follow `docs/agent-delivery.md` and recheck the current state.

## Keep this file lean

Put task procedures in `docs/`, repeatable workflows in scripts, and hard guarantees in tests or hooks. If removing a line would not change every agent's behavior, move or remove it.
