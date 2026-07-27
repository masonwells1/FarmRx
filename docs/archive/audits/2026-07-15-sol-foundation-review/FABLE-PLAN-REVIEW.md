# Claude Fable One-Time Plan Review

**Date:** 2026-07-15
**Model:** Claude Fable
**Effort:** low
**Mode:** read-only (`Read`, `Glob`, and `Grep` only)
**Plan reviewed:** `AUTONOMOUS-REPAIR-LOOP.md`
**Verdict:** NEEDS REVISION

This was the single Claude/Fable review authorized by Mason. No second review will be run. Sol incorporated the actionable corrections into the execution-ready plan.

## P1 corrections

1. **Test the real Vercel header configuration.** Vite preview does not serve headers from `vercel.json`. The plan must run the built app through a test server that consumes the actual `vercel.json` rules, assert route coverage in that file, and keep live response-header verification as a post-deploy gate. SOL-FND-005 remains conditional until live proof.
2. **Prove the new release gate turns red.** The completed gate must be mutation-tested with deliberate route, queue-lock, RLS-expectation, and service-worker-cache breakages. Each break must fail the correct gate and then be reverted.
3. **Do not overstate production-dependent closure.** SOL-FND-001, SOL-FND-005, and SOL-FND-006 retain named real-device or live activation gates. The draft-PR verdict can be at most conditionally solid until those gates pass.

## P2 corrections

4. **Keep Phase 2 and Phase 3 guarantees separate.** Phase 2 can prove single-tab, operation-ID replay; two-tab contention and stale replay are certified only after Phase 3 and then recertified end to end.
5. **Make branch-push authority explicit.** Mason's approval of the reviewed plan may authorize only the named non-production branch push and one draft pull request. It does not authorize any other push.
6. **Respect phase dependencies when blocked.** Independent work may continue only when it does not depend on the blocked gate. Phase 3 cannot advance past a blocked Phase 2; Phases 4-6 still require Phase 1's proof harness.

## P3 correction

7. **Document offline revocation exposure.** Cached data remains visible until revalidation when a grant is revoked while the device is offline. The plan must define a bounded cache-validity window, especially for financial data, and report the residual clearly.

## Residual manual/live gates identified by Fable

- Live Supabase migrations, Auth/security settings, scheduler activation, Edge Function deployment, and secrets.
- Production response headers and CSP behavior.
- Installed iOS/Android offline/reopen/replay/storage-pressure proof and app-closed real-device push.
- Live two-farm/two-user isolation and revocation.
- Production-domain email delivery.
- Merge and production deployment.

## Reviewer-positive observations

Fable found the overall phase order, paired farm-selection/offline work, read-only-live versus writable-disposable boundary, append-only ledger preservation, no-test-weakening rule, and production stop list sound once the corrections above are applied.
