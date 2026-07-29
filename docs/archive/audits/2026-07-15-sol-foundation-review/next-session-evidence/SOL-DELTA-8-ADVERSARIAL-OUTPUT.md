# Sol Delta 8 Adversarial Output

## Runtime provenance

- Launch: `codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -s read-only -C C:\FarmRx`
- Runtime header: model `gpt-5.6-sol`, reasoning effort `xhigh`, sandbox `read-only`
- Session: `019f6892-3d7e-7802-a1b4-c0c30c242e74`
- The reviewer-facing context identified itself only as "Codex based on GPT-5" and said the exact effort label was not exposed inside that context. The process launch/runtime header above is the model/effort proof.
- The reviewer completed its plan, then emitted no output for more than 90 seconds. The orchestrator applied the required no-progress watchdog. Sending the interrupt caused the already-composed final report to flush; the wrapper exited `0` and reported `471,102` tokens used.
- External mutation: none. The worker was read-only.

## Verdict

`RELEASE BLOCKED`

Harvest finding `FRX-D7-001` is closed. Four new release-blocking defects remain: two P1 and two P2.

## Findings

### FRX-D8-001 - P1 - Scouting photo operations are not operation-bound

The UI uploads photos before the repository captures an operation context. Storage upload/removal and cleanup paths use the ordinary client, so an A-to-B session change or same-user revoke/regrant can recapture a new identity between files and complete the original UI action under the new context.

Required repair: capture one `FarmOperationContext` before the first upload and carry it through upload, cleanup removal, note RPC, queue/outbox mutation, and final publication. Verify before and after every awaited storage/write boundary.

Required regression: pause the first upload, switch A-to-B and separately revoke/regrant the same user, then prove zero later storage calls, zero note writer calls, and zero queue/outbox mutation. Cover delete cleanup and a failure between two files.

### FRX-D8-002 - P1 - Grain-alert automation captures too late and sends email without the fence

`recordMarketingAlertTransitions` waits for a capability probe before context capture. Email delivery is a separate unbound Edge Function invocation, and the function checks membership early but does not recheck the expected subject/membership/epoch immediately before the external provider call.

Required repair: capture before the capability probe and reuse the same context through transition RPCs and delivery. Bind the Edge request to expected identity/farm epochs, validate those server-side, and recheck membership/epoch immediately before sending email.

Required regression: gate the capability probe and Edge invocation across A-to-B, farm switch, and same-user revoke/regrant. Require zero transition RPCs, zero provider calls, and no local sent-key update.

### FRX-D8-003 - P2 - Online-only Grain and Profitability mutations publish success after the fence changes

Four direct Grain operations and Profitability insurance saves return after their awaited mutation without a final operation-context verification. A valid A write can therefore publish success into a now-active B/farm/revoked UI context.

Required repair: verify immediately before mutation, after the awaited mutation, and before returning. Queued wrappers must capture the context and call context-accepting operation variants.

Required regression: gate each mutation, change context before resolution, and require rejection with no local success publication. One valid remote A call is permitted; publication into B must remain zero.

### FRX-D8-004 - P2 - Revocation recovery can steal another user's Scouting cleanup work

The cleanup outbox key is project-only and entries contain farm ID but no user ID. Revocation quarantine partitions solely by farm and can move User B's pending cleanup for Farm F into revoked User A's recovery vault, then remove it from B's active cleanup path.

Required repair: include `userId` in cleanup entries and partition by project/user/farm. Legacy unowned entries must not be assigned to the currently revoked user.

Required regression: create B cleanup for Farm F, revoke A on the same device, and prove B's entry remains drainable while A's recovery contains none of B's work.

## Reviewer proof

- Branch and HEAD matched `codex/farmrx-release-gate-proof` / `49614e75140fdf4dee94d916e32b386bef922f1a`.
- Harvest regression passed with 9 coverage groups.
- Fourteen focused repository/queue regressions passed.
- Five farm-access, notification-link, scheduler, weather, and push regressions passed.
- App and Node TypeScript checks passed.
- `git diff --check` passed apart from global-ignore permission and line-ending warnings.
- Candidate secret scan found zero high-confidence matches; PNG binary-string scan passed.

## Reviewer limitations

The read-only reviewer did not independently execute the production build, browser suite, dependency audit, disposable PostgreSQL migrations, live Supabase/Storage, or the email provider. Its four findings are code-order proofs, not live-service reproductions.
