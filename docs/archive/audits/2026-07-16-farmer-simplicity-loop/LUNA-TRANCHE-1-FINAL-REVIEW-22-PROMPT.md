# Luna independent proof review 22 — final auth fixture and scope

Act as a fresh-context, read-only proof reviewer using actual `gpt-5.6-luna` at Medium reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not trust summaries, earlier verdicts, manifests, or PASS claims. Do not edit/create files, alter Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Reviews 20 and 21 are rejected. Return `GO` only if no HIGH or MEDIUM correctness or proof-quality blocker remains.

Recheck your expired-pending finding. Production now separates the raw validated intent record from the time-trusted pending request; an expired pending record must convert to a durable signed-out fence and reject both a persisted session and an otherwise valid offline transport fallback. Verify the mounted exact-byte cases.

Judge the two other Review-21 concerns accurately: the signed-out record is a universal deny fence that blocks all old lineages until deliberate manual sign-in, which is stricter than binding one prior session; browser module state is isolated per tab JavaScript realm, while the two-provider same-process test injects separate per-provider state to model that reality.

Audit the complete fixture: two independent providers/clients, same origin and different paths, separate Storage views, async ordered delivery, automatic client broadcast, exact bytes and UI, cleanup, signout-only restore, raw and sibling delayed sign-out, pending-before-success, stale same-account lineage, competing older failure/success, delayed clearFarmAccess, expired pending, and signed-out offline fallback. Inspect production nonce ownership and synchronous sign-out fencing.

Reconcile exactly 44 non-audit files, `AuthProvider.tsx` as the sole implementation-file addition beyond the recorded prior 43-file checkpoint, unchanged ordered 18/18 routes, zero staged, HEAD/base equality, Option 2 hash `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`, and credential scan 44/0. Spot-check wider offline queues, retry truth, farm rollback, Fields/flex, Equipment and Program/service provenance, RLS, and strict mocks.

Outer exact-byte proof reports all 39 regressions, forced and standalone E2E TypeScript, production build, audit 0, guards/mutations, credential scan, scope/routes/hash/staged, and nine isolated PostgreSQL probes green. Browser/Playwright/phone are deliberately excluded.

Report findings first with exact evidence and smallest correction. End with categorical `GO` or `NO-GO`, LOW follow-ups, actual model/effort if visible, scope/proof reconciliation, skipped-lane limits, and `External mutation: no` only if true.
