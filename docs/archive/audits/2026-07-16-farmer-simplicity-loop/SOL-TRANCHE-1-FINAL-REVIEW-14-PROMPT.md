# Sol final adversarial release review 14 — repaired 40-file Option 2 checkpoint

Act as the fresh-context, read-only release-gate orchestrator using actual gpt-5.6-sol at Extra High reasoning. Inspect base 48aad521bd1ecb4c5704ef2e6c5bb30e4d522685 through the current working tree directly. Do not trust summaries, PASS text, prior reviewer verdicts, or this prompt's repair claims. Do not edit or create files, change Git state, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply a migration to a persistent database, mutate persistent data, or print credentials. The outer runner alone writes your final response.

Return GO only if no HIGH or MEDIUM correctness, data-integrity, data-isolation, permission, offline-queue, farmer-recovery, migration-safety, concurrency, or release blocker remains. Otherwise return NO-GO with exact file/line evidence, reachable failure sequence, business impact, smallest correction, and a non-vacuous proof. Record LOW follow-ups separately.

Reconcile the exact 40-file checkpoint in SCOPE-CORRECTION.md. Audit files are evidence-only. Confirm the unchanged ordered 18/18 route declarations and selected Option 2 SHA-256 D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38.

Freshly falsify every Review-13 repair rather than accepting it:

1. Interval deletion with ambiguous history must delete the interval without deleting history; only interval_id may become null, and provenance-defining fields must remain immutable.
2. Canonical interval recomputation must use service_date, created_at, and id ordering. Backdated offline replay cannot roll back a newer completion. A later calendar-only service must retain the newest linked meter reading. Reversal must fall back to the next canonical history or clear only when none remains.
3. A supplied unknown /fields/:id/edit identifier must render not-found recovery and have no route to Add Field defaults or save semantics.
4. A failed farm switch must show a plain-language alert, retain the prior selected farm, restore that exact farm's replay authorization, leave queued bytes untouched, and permit one later retry replay without unhandled rejection or cross-farm leakage. If restoration itself fails, the app must fail closed into a retryable gate.
5. Startup/reconnect must not publish retry actions until replay and due generation both succeed. A late due-generation failure after replay must remain visibly blocked with Try again; double clicks must produce one retry; a successful retry must not repeat the already-completed save.
6. The 0042 PostgreSQL 17 probe must use genuinely distinct noted/same-created-at and unnoted/older-created-at fixtures, IS DISTINCT FROM assertions, real authenticated-role direct-delete/private-core/unlinked-insert attacks, interval-deletion ambiguity, stale-interval repair, older replay, calendar-after-meter, reversal fallback, and strict grant/trigger metadata checks.
7. The nonempty queue-lock cancellation proof must derive the receipt from the actual queued save head and prove that exact receipt, queue bytes, cache, writer calls, and sync status remain invariant.

Recheck all earlier repaired invariants: exact provenance and no guessing; deferred constraint and least privileges; atomic Equipment reversal; shared advisory lock; eleven replay entrypoints; synchronous switch/sign-out cancellation; serialized retry; background-only rejection sinks; capability-shaped routes; pure snapshots and durable clock fences; strict queue parsing/write echoes; field relationships/flex validation; Equipment FIFO/rebasing/nested confirmation; exact field-location echoes; strict E2E mocks; no hidden replay; and no credential/debug leakage.

Current outer proof on these exact bytes: forced TypeScript PASS; standalone E2E TypeScript PASS; all 39 regression lanes PASS; production build PASS with only the existing chunk-size warning; dependency audit 0 vulnerabilities; targeted guards 11/11; foundation static guards and controlled mutation drills 11/11 PASS; credential scan 40/0; git diff --check PASS apart from line-ending notices; exact scope 40/40; routes 18/18; Option 2 hash exact; and all nine disposable PostgreSQL 17 probes PASS. Browser/Playwright/phone results are deliberately excluded. Independently inspect the bytes and rerun concise read-only non-browser probes as useful.

End with findings first, categorical verdict, actual model and reasoning effort, scope reconciliation, proof/probes run, skipped-lane residual limits, and External mutation: no only if true.
