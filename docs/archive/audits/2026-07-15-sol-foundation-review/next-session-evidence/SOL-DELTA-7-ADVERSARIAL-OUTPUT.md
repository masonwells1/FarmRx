# Sol Delta 7 Adversarial Review

- Model: `gpt-5.6-sol`
- Effort: `xhigh`
- Sandbox: `read-only`
- Session: `019f6862-f90a-7ea0-aaae-09b3deb1920d`
- Base: `49614e75140fdf4dee94d916e32b386bef922f1a`
- External mutation: none
- Completion status: the reviewer process exited with code 1 after its final-response generation was blocked by an automated cybersecurity-risk filter. The finding below was emitted and independently reproduced before that filter interruption.

## FRX-D7-001 - P1 - Harvest operation can cross a same-farm account change

Reachable scenario:

1. User A starts `QueuedHarvestRepository.saveHarvest` and captures an entry for User A and the selected farm.
2. The operation waits behind the queue transaction lock.
3. The app changes to User B while retaining the same farm identifier.
4. User A's operation resumes. The queue transaction only protects the queue key/revocation token captured after lock acquisition, while `SupabaseHarvestRepository.saveHarvestOperation` independently resolves the then-current account and farm.
5. The live write therefore executes as User B, but originated from User A's operation; no queued recovery copy remains after success.

Executable read-only reviewer proof result:

```json
{"entryUser":"00000000-0000-4000-8000-000000000001","activeUserAtWrite":"00000000-0000-4000-8000-000000000002","queueEntriesAfterWrite":0}
```

Expected: a save must remain bound to the exact account, farm, revocation generation/token, and server access epoch captured when the operation starts. An intervening account/farm/grant change must fail closed before remote mutation, enqueue, receipt publication, workspace mutation, or queue removal.

Actual risk: Harvest's queued entry is scoped only by user/farm IDs, and its live writer re-resolves mutable identity at execution time. A delayed operation can be re-authored across accounts on the same farm.

Business impact: one user's harvest change can be submitted under another user's active session, destroying audit provenance and potentially bypassing the first user's revoked access boundary.

Fix direction: carry a captured `FarmOperationContext` through the queued repository, operation writer, and data gateway; bind the eventual Supabase request to that context; verify the exact context before and after every await and immediately before enqueue, persistence, receipt/workspace mutation, and queue removal. Audit the remaining queued write modules for the same pattern.

Required regression: deterministically hold the Harvest queue lock, capture User A, switch to User B on the same farm, release the lock, and prove the writer is not called and User A's queue/workspace is not mutated. Repeat the same-account/same-farm regrant ABA case.

## Review interruption

The reviewer completed a broader read-only inspection of Fields, Field Log, Harvest, Scouting, Programs, Notifications, and Field Location and identified the same structural pattern as potentially present in those modules. It produced the deterministic Harvest proof above before the output filter interrupted the final finding list. The orchestrator therefore treats the class, not only the single reproduced method, as release-blocking until every queued writer is bound and a fresh Sol delta review returns clean.
