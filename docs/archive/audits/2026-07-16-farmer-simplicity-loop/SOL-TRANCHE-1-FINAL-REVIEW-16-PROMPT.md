# Sol final adversarial release review 16 — authenticated-role proof closure

Act as the fresh-context, read-only release-gate orchestrator using actual gpt-5.6-sol at Extra High reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Do not trust summaries, prior verdicts, or reported PASS text. Do not edit or create files, change Git state, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply a migration to a persistent database, mutate persistent data, or print credentials. The outer runner alone writes your final response.

Return GO only if no HIGH or MEDIUM correctness, data-integrity, permission, data-isolation, offline-queue, farmer-recovery, migration-safety, concurrency, proof-quality, or release blocker remains. Otherwise return NO-GO with exact file/line evidence, reachable sequence, business impact, smallest correction, and a non-vacuous proof. Record LOW follow-ups separately.

Reconcile the exact 43 implementation/config/test files in `SCOPE-CORRECTION.md`; audit files are evidence-only. Confirm the unchanged ordered 18/18 routes and Option 2 SHA-256 `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.

Review 15 is rejected historical evidence because Luna found the 0042 positive service workflow ran as database owner with JWT claims rather than `SET LOCAL ROLE authenticated`. The proof is repaired in the existing 43-file scope. Freshly verify that `scripts/verify-0042-disposable.ps1` now:

1. executes both first save and exact idempotent replay through `public.save_service_log_entry` while the SQL session role is genuinely `authenticated` and bound to the owner JWT/epoch headers;
2. proves exactly one public service log and one service-source reading are visible to that role, then resets to the database owner only for the private provenance-table assertion;
3. switches back to the real authenticated role for `public.delete_service_log_with_reversal`, proves the public pair is gone, and uses owner context only for the final private-link absence check;
4. retains the genuine authenticated positive manual meter/task writes and trusted `skip_program_pass` transition, plus hostile read-only, direct Program, service-source, private-core/linker, historical-replay, interval-snapshot, metadata, idempotency, and two-session race checks.

Also freshly attack all governing repairs: read-only operational RLS; manual-only direct meter source; generic and database Program provenance fences including downgrade and old-GUC bypass; trusted Program RPC compatibility and owner invariant; revoked private service helpers; locked empty-search-path public service definer with both-new/exact-replay semantics and historical attachment refusal; atomic farm storage rollback and fail-closed rollback failure; strict startup/reconnect Program generation with truthful retry and no duplicate save; null flex-formula rejection; exact service provenance/reversal/recomputation; missing-field recovery; serialized replay/cancellation and durable clock fences; pure snapshots; strict queues/echoes; capability-shaped routes; Field/flex relationships; Equipment FIFO; strict E2E fixtures; and no credential/debug leakage.

Fresh outer proof on these bytes: forced TypeScript PASS; standalone E2E TypeScript PASS; all 39 regressions PASS; production build PASS with only the existing chunk warning; audit 0; targeted guards 11/11; foundation static guards and controlled mutation drills 11/11; credential scan 43/0; diff/staged-empty/scope/routes/hash gates PASS; all nine PostgreSQL 17 disposable probes PASS, including repaired 0042. Browser/Playwright/phone remain deliberately excluded. Independently inspect and rerun concise read-only non-browser checks as useful.

End with findings first, categorical verdict, actual model/effort if independently visible, scope reconciliation, proof run, skipped-lane residual limits, and `External mutation: no` only if true.
