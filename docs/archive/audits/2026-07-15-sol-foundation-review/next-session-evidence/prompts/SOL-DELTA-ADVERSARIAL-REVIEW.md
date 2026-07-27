# Fresh Sol delta adversarial review

You are the mandatory independent post-fix reviewer for the Farm Rx release gate.

## Runtime contract

- Report the actual model and reasoning effort shown by your runtime header.
- Do not call Claude, Fable, another agent, or another model.
- Work read-only. Do not edit source, tests, evidence, git state, or any external service.
- Do not commit, stage, push, deploy, apply migrations, send providers, or mutate Supabase/Vercel/GitHub.
- Do not read the orchestrator ledger, implementation report, release results, pre-commit decision, Terra/Luna reports, or `NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`.

## Required inputs

Read:

1. `CLAUDE.md`, `docs/farm-rx-handoff.md`, `docs/GOAL.md`, and `docs/audits/2026-07-15-sol-foundation-review/REPAIR-ROADMAP.md`.
2. The full base `49614e75140fdf4dee94d916e32b386bef922f1a` to working-tree diff, including untracked candidate files but excluding the unrelated `NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`.
3. Your predecessor's independent findings in `docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/prompts/SOL-FINAL-ADVERSARIAL-OUTPUT.md`.
4. `docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/COMMAND-LOG.md` only as a list of claimed proof; do not treat it as proof you personally ran.

## Required attacks

Independently adjudicate every `FRX-FRESH-001` through `FRX-FRESH-010` finding. For each, state `CLOSED`, `OPEN`, or `PARTIAL`, with exact code and test evidence. In particular attack:

- a stale queue transaction and a stale IndexedDB writer crossing revoke, quarantine, and later regrant in another tab;
- corrupt/missing revocation fences, empty queues, recovery vault durability, and stale cache readability;
- old and new push RPC coexistence and the documented deploy order;
- provider success followed by one or repeated database completion failures;
- terminal target exhaustion on a later zero-claim sweep;
- physical-domain weather corruption, first-good observation, older-good-after-newer-bad ordering, fixed-clock replay, 50 hanging fields, unrelated push execution, and partial-failure health;
- notification links with backslashes, controls, absolute/protocol-relative URLs, encoded separators, and valid internal query/hash paths.

Also search the changed surface for new P0/P1/P2 defects introduced by the fixes. Check auth/ACL/search_path, transaction/race behavior, secret leakage, deterministic tests, and migration syntax. You may run non-mutating checks that fit a read-only sandbox. Do not trust same-author regressions without examining whether they could pass for the wrong reason.

## Output

Write a concise but complete report containing:

1. Actual model and effort.
2. Commands/checks personally run.
3. A closure matrix for FRX-FRESH-001 through 010.
4. Any new findings with severity, reachable scenario, impact, exact code, smallest fix, and verification.
5. Proof gaps and residual risks, separated from defects.
6. A single verdict: `RELEASE BLOCKED` or `NO P0/P1/P2 DEFECT FOUND IN REVIEWED SCOPE`.
7. Explicit confirmation that no external mutation occurred.
