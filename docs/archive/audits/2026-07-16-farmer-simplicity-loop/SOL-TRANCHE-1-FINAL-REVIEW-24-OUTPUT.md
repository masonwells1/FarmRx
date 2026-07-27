## Findings

1. **HIGH — a failed older login can still erase a newer accepted cross-tab login.**
   Evidence: [AuthProvider.tsx:442](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:442) checks nonce ownership, restores the old auth snapshot, checks ownership again at line 446, then restores the old intent unconditionally at line 447. If Tab B accepts session C between lines 446–447, Tab A overwrites C’s accepted intent with B’s old intent. The verification then fails, but [AuthProvider.tsx:497](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:497) matches that overwritten B intent against provider-local B and restores B’s snapshot at line 500. Result: newer session C, tokens, nonce, lineage, and timestamp are replaced by reload-trusted B.

   The mounted fixture covers the named historical races and exact-byte comparisons, but its injected ownership loss targets the first new auth-byte commit, not this rollback-intent window ([queuedOperationContext.regression.ts:1014](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:1014)). The fixture already has the necessary per-write hook at [queuedOperationContext.regression.ts:49](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:49).

   Required correction: serialize all app-controlled auth tuple mutations across tabs under one shared lock, and adopt only a freshly reread coherent shared tuple—never provider-local state matched only against an intent marker. Add the exact post-check/pre-intent-write interleaving regression.

2. **MEDIUM — malformed prior intent bytes are restored instead of failing closed.**
   [AuthProvider.tsx:205](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:205) double-reads coherently, but malformed non-null intent bytes parse to `null` at line 215. Lines 219–221 reject pending and signed-out records but incorrectly treat malformed bytes like a legitimate absent legacy intent. After password failure, lines 445–455 restore the valid session plus malformed marker and publish the old user as signed in.

   Required correction: reject capture when `intentBytesBefore !== null && intent === null`, then add mounted returned-error and rejected-promise malformed-tuple tests.

## Wider review and reconciliation

No additional HIGH/MEDIUM blocker surfaced in the sampled offline access, seven-day/clock fence, eleven serialized queue lanes, Fields/flex, Equipment FIFO/provenance, Program provenance, operational RLS, pure snapshots, retry-state, strict mock, or credential paths.

Fresh local read-only results:

- Mounted queued/auth regression: PASS.
- Farm access, Fields repository, field-edit patch, Equipment, and Program regressions: PASS.
- Foundation static guard and pure-snapshot guards: PASS, including 11/11 snapshot checks.
- Credential scan: `47 files / 0 findings`.
- Git: 43 tracked changes + 4 non-audit untracked files; staged 0; HEAD equals `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`.
- Routes: base and current are identical, ordered 18/18.
- Option 2 SHA-256: exact `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.
- `git diff --check`: PASS; only Git CRLF-conversion notices.
- The durable route guard pins the exact ordered manifest, and source inspection confirms its controlled route mutation turns `routes:exact-ordered-manifest` red.

The full 39 regressions, forced TypeScript, standalone-E2E TypeScript, production build, dependency audit, 11/11 mutation drill, and disposable PostgreSQL/RLS probes remain outer-reported evidence; I did not rerun lanes that write build/temp artifacts, start PostgreSQL, contact services, or use browsers.

LOW follow-ups:

- After fixing both blockers, add a real multi-process two-tab browser test; the excluded browser lane is particularly relevant to this interleaving.
- Before applying the provenance migration, quantify and approve its deliberate rebuild beginning with the table-wide deletion at [20260717023021_repair_service_log_meter_provenance.sql:17](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/20260717023021_repair_service_log_meter_provenance.sql:17).
- Exact model and reasoning-effort identifiers are not exposed to me, so I cannot truthfully confirm `gpt-5.6-sol / Extra High`.

**NO-GO**

External mutation: no
