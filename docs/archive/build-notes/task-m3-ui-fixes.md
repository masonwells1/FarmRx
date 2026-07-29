# TASK — Fix Module 3 Inventory UI per review (Terra, workspace-write)

CRITICAL EXECUTION RULE: You are headless with NO human available. Never present a plan and
wait — asking for approval is a task failure. Everything here is PRE-APPROVED; implement
fully, then report with proof.

PRE-APPROVED scope: modify src/** only. No migrations, no git, no DB ops, no servers.

Fix ALL 9 findings in **docs/review-m3-ui.md** (read it first; numbering matches).
Spec: docs/build-notes/task-m3-ui.md + docs/schema-module3.md + migrations 0010/0011.

P1s:
1. Explicit conversion factors allowed ONLY when at least one side is a package/count unit;
   volume↔weight rejected outright (no density guessing, ever).
2. Full envelope validation before trusting storage: every field/enum/relationship/farm
   binding/positive-quantity/factor validated; semantically corrupt envelope fails closed.
3. Application snapshots must include ALL regulatory facts from 0010 (signal word, max
   label rate/unit/basis, etc.), copied as scalar values at save.
4. Compliance panel must mirror the 0010 rup_application_completeness semantics: federal
   items only for RUP products; ALL migration-defined operational items (incl. humidity,
   missing REI/PHI, rate-total mismatch, rate-above-label-max) under "Good practice";
   never claim completeness while defined checks are unevaluated.
5. Receipt lifecycle UI: receipt history list, draft edit + finalize, received-row
   cancel-with-required-reason calling cancelReceipt.
6. Product-kind constraints enforced in repository AND form: RUP only for chemicals;
   seed requires crop/variety; conditional fields per kind.

P2s:
7. Multi-product spray records: repeatable product rows submitted together.
8. All Inventory text ≥18px (RUP badge, warnings, snapshot facts).
9. Regression teeth: mutate every catalog fact post-save and assert every historical scalar
   + saved factor unchanged; add rejection tests for volume↔weight factors and semantically
   corrupt envelopes.

Proof required (run, paste real output): `npm run build` clean · `npx tsc --noEmit` clean ·
`npm run regression` all 5 suites pass.
FINAL message: numbered fixes, proof output, deviations if any.
