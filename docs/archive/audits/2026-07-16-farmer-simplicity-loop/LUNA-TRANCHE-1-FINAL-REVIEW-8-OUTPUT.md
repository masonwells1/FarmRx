NO-GO

HIGH — split identity/farm lookup remains in [src/data/index.ts:26](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/index.ts:26) and [src/data/index.ts:42](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/index.ts:42):

```ts
{ userId: await currentUserId(), farmId: await currentFarmId() }
```

`currentFarmId()` independently calls `currentFarmContext()`, which independently calls `currentUserId()`. During an A→B switch, these awaits can produce a mixed `{ userId: A, farmId: B }` context. The queued-context regression does not exercise these production composition sites, and its static assertions do not inspect `data/index.ts`.

Smallest repair: use one atomic context lookup at both sites:

```ts
const fieldsGetContext = currentFarmContext
const fieldLocationClient = createFieldLocationClient({ getContext: currentFarmContext, ... })
```

Race (a) is adequately guarded: validation generations invalidate older startup/reconnect/setup work; replay tokens supersede older authorizations; checks occur before and after awaits; retry actions publish only after awaited replay. The executable and static assertions would fail for removal of those guards.

Other requested checks were clean: exact 20+10 scope, audit evidence excluded, Option 2 SHA-256 matches, routes unchanged, flex validation, role gates, awaited readiness, pure snapshots, Equipment FIFO, strict mocks/echoes, hidden replay removal, and supplied TypeScript/regression/build/audit/static proof.

Model/effort: requested `gpt-5.6-luna`, Medium. No files, Git state, browser, live service, database, or external state were changed. Browser and live-service behavior remain intentionally unverified.
