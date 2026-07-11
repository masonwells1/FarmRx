# Farm Rx FOUNDATION BLOCK — Implementation Blueprint

**Design status:** implementation-ready blueprint. No application code or database was changed or run by this design session. Migration `0008_employee_privacy.sql` is a draft and has not been applied.

## Plain English for Mason

### What changes for the farmer

- The login screen becomes a real, secure email-and-password sign-in. The farmer stays signed in on the installed Farm Rx app and can sign out when finished.
- Fields stop being practice data and come from that farmer's real, private Supabase farm workspace.
- If signal drops while a field save is being sent, Farm Rx keeps the entry on that device and sends it in order when service returns. It says **“Saved on this device — waiting for signal”**, not **“Synced.”**
- Grain and financial numbers are hidden from employees unless the owner or a trusted manager deliberately turns on **View financials** for that employee.

### What stays the same

- The Fields screens, labels, and `FieldsRepository` interface stay the same. Terra swaps the implementation behind the existing seam.
- The large-type/touch rules remain non-negotiable: at least 18px base text, at least 48px tap targets, and plain farmer English.
- The Crop RX brand stays in the wrapper and login. Navigation stays Fields, Grain, Inventory, Profitability, Equipment, and Tasks.
- The existing farm share toggle plus the named Crop RX rep grant remains the only way a rep can read grain or profitability. `0008` does not broaden it.

### What stays in practice mode

- **Grain stays mock.** Draft migrations `0004` and `0005` are not in the database, so a live Grain repository must not be constructed.
- Profitability also remains unimplemented; draft migrations `0006` and `0007` are not in the database.
- This block protects writes during bad signal. It is not full offline browsing. A fresh app start with no signal cannot load the farm from the server.

## Non-negotiable implementation gates

Fields must not be switched to live merely because authentication works. The applied Module 1 database and the existing TypeScript contract do not currently match.

The applied schema is missing these required round-trip columns:

| Existing UI property | Required database location |
|---|---|
| `Arrangement.landlord_phone` | `arrangements.landlord_phone text` |
| `Arrangement.landlord_contact_notes` | `arrangements.landlord_contact_notes text` |
| `CropAssignment.harvested_bushels` | `crop_assignments.harvested_bushels numeric(16,2)`, null or at least zero |
| `CropAssignment.expected_yield_per_acre` | `crop_assignments.expected_yield_per_acre numeric(12,4)`, null or above zero |
| `CropAssignment.expected_price_per_bu` | `crop_assignments.expected_price_per_bu numeric(12,6)`, null or at least zero |

Terra must first prepare a separate, additive, reviewed draft migration (the next available migration number after the team decides ordering). That migration must add these columns and the transactional save support described below. Do not hide values in `notes`, do not drop them, and do not claim a save succeeded when only part of the bundle reached the database.

The same support migration must add:

1. `public.repository_write_receipts(farm_id uuid, operation_id uuid, user_id uuid, completed_at timestamptz, result jsonb, primary key (farm_id, operation_id))`, with a composite farm foreign key convention and RLS/no direct client writes.
2. A restricted `SECURITY DEFINER` RPC named `public.save_field_bundle(p_farm_id uuid, p_operation_id uuid, p_draft jsonb) returns jsonb`. It must bind the caller to `auth.uid()`, require `can_edit_farm(p_farm_id)`, validate every parent against `p_farm_id`, execute the whole field/arrangement/crop-assignment save in one transaction, and record/return the same result for a repeated operation ID.
3. Explicit `REVOKE` from `PUBLIC` and `anon`, and `GRANT EXECUTE` only to `authenticated`. The function must set `search_path = public, pg_temp` and never accept a user ID or trust a farm stamp nested inside `p_draft`.

The RPC is required because one UI save spans up to three tables. Separate browser requests could leave a field updated while its arrangement or crop rows failed. The receipt makes replay safe if the server committed but the response was lost.

One more draft-to-draft mismatch must be settled before applying Module 4: the current UI/mock flex formula is `{ type, trigger, bonus_rate }`, while draft `0006` expects `{ basis, trigger, rate_pct, cap_per_acre? }` and applies percentage-of-revenue math. Do not silently rename those keys; the calculation meaning differs for price and yield formulas. This does not block Module 1 live Fields if the raw current shape is round-tripped unchanged, but it blocks applying `0006` until the owner-approved flex-rent rule is consistent.

## Proposed file and module boundaries

Terra should use these files. This is a design list, not authorization from this session to create them.

| File | One responsibility |
|---|---|
| `src/lib/supabaseConfig.ts` | Committed public browser credentials and exact project identity. |
| `src/lib/supabaseClient.ts` | The single configured `SupabaseClient`. |
| `src/auth/AuthProvider.tsx` | Restore/listen to the session and expose auth state/actions. |
| `src/auth/RequireSession.tsx` | Hold routing during restore; redirect signed-out users. |
| `src/auth/bootstrapFarm.ts` | First-owner farm/entity setup using the existing insert trigger. |
| `src/data/FieldsDataGateway.ts` | Narrow database adapter boundary used by repositories and fakes. |
| `src/data/SupabaseFieldsDataGateway.ts` | Supabase queries plus `save_field_bundle` RPC. |
| `src/data/SupabaseFieldsRepository.ts` | Implements the existing `FieldsRepository` and maps rows/types. |
| `src/data/QueuedFieldsRepository.ts` | Durable write queue decorator; knows no Supabase query syntax. |
| `src/data/writeQueue.ts` | Versioned localStorage queue, verified persistence, ordered replay. |
| `src/data/syncStatus.ts` | Small observable store for pending/sync/error status. |
| `src/data/backends.ts` | Explicit per-module backend manifest and guarded factories. |
| `src/data/index.ts` | Composition only; exports the same names consumed by UI. |
| `src/data/SupabaseFieldsRepository.regression.ts` | Network-free adapter/fake regression suite. |

`src/App.tsx` may be changed by Terra only for auth wiring, sign-out, and a global sync-status notice. The Fields page/module must continue calling the same two repository methods and must not learn Supabase query details.

## Supabase client configuration

`@supabase/supabase-js` is not currently a dependency. Terra adds it, then creates exactly one client.

`src/lib/supabaseConfig.ts`:

```ts
/**
 * PUBLIC browser client credentials. These values ship to every Farm Rx user.
 * RLS protects the data. Secrets and service-role keys never belong here or
 * anywhere else in this repository.
 */
export const supabaseConfig = Object.freeze({
  projectRef: 'agvsozfbstpekuqxpqjr',
  url: 'https://agvsozfbstpekuqxpqjr.supabase.co',
  publishableKey: 'sb_publishable_NonG7JNpCB3jqHwEq4xhLg_hY7fAwnM',
} as const)
```

`src/lib/supabaseClient.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { supabaseConfig } from './supabaseConfig'

const hostname = new URL(supabaseConfig.url).hostname
if (hostname !== `${supabaseConfig.projectRef}.supabase.co`) {
  throw new Error('Farm Rx is not connected to its expected data service.')
}

export const supabase = createClient(
  supabaseConfig.url,
  supabaseConfig.publishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: `farm-rx-auth:${supabaseConfig.projectRef}`,
    },
  },
)
```

Supabase's browser storage persists the refresh session across PWA closes and `autoRefreshToken` renews it while the app is active. There is no `.env` file and no fallback project URL.

## Authentication

### V1 account decision

V1 uses **owner-provisioned accounts**, not self-serve sign-up. Crop RX sets customers up, which prevents unknown authenticated users from creating unclaimed farms and gives Mason a clear onboarding moment. The browser exposes sign-in and sign-out only. Password reset/invite completion may be added as a separate scoped flow; `detectSessionInUrl: true` leaves that route open without adding public sign-up.

Crop RX creates the Auth account through a trusted Supabase administrative path outside this browser app. A service-role key is never sent to the PWA or committed.

### Provider contract

```ts
type AuthPhase = 'restoring' | 'signed_out' | 'signed_in'

interface AuthContextValue {
  phase: AuthPhase
  session: Session | null
  user: User | null
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
}
```

- On provider mount, call `supabase.auth.getSession()` once.
- Subscribe immediately to `supabase.auth.onAuthStateChange`; update the context for `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, and `USER_UPDATED` without duplicating clients.
- Unsubscribe on unmount.
- `signIn` calls `supabase.auth.signInWithPassword({ email: email.trim(), password })`. Navigate to `/fields` only when both `data.session` exists and `error` is null.
- `signOut` calls `supabase.auth.signOut({ scope: 'local' })`. Only after it resolves should local auth state become signed out and routing move to `/login`.
- Never log passwords, access tokens, refresh tokens, or the returned session.

### Routing behavior

- While `phase === 'restoring'`, show one full-page message: **“Opening your farm…”** Do not briefly show the login or private app shell.
- A signed-out visit to any private route redirects to `/login` with `replace` and remembers only the safe internal path.
- A signed-in visit to `/login` redirects to `/fields` (or the remembered internal path).
- A session expiry moves the user to `/login` and shows **“Your sign-in ended. Please sign in again.”**
- The sign-out control belongs in the branded wrapper, has a 48px tap target, and uses the plain label **“Sign out.”**

Login form text remains at least 18px. During submission disable the button and label it **“Signing in…”** Suggested failures:

| Condition | Farmer-facing words |
|---|---|
| Wrong email/password | “That email or password did not work. Check both and try again.” |
| No signal/timeout | “We could not reach Farm Rx. Check your signal and try again.” |
| Rate limit | “Too many tries. Wait a few minutes, then try again.” |
| Unknown | “Farm Rx could not sign you in right now. Please try again.” |

Raw Supabase/Postgres/RLS messages stay in development diagnostics, not farmer UI.

### First real owner bootstrap

`0002` already supplies the bootstrap: it is the `farms_bootstrap_owner_membership` **trigger**, not a client-callable RPC. `0003` correctly revoked direct execution from authenticated users. The client must never call `bootstrap_farm_owner_membership()`.

After the first provisioned owner signs in:

1. Query accessible farms. In v1, exactly one means continue; more than one fails closed with **“We found more than one farm for this account. Crop RX needs to finish your setup.”**
2. If none exists and the account has been marked by the Crop RX onboarding flow as the initial owner, show the one-time farm setup form. Do not auto-create from arbitrary email text.
3. Call:

```ts
const { data: farm, error: farmError } = await supabase
  .from('farms')
  .insert({
    name: farmName.trim(),
    created_by: user.id,
    share_with_rep: false,
  })
  .select('*')
  .single()
```

The insert policy binds `created_by` to `auth.uid()`. After the insert, the trigger inserts the active owner membership using `auth.uid()`. The trigger's lack of an API execute grant is intentional and does not stop trigger execution.

4. Create the first operating entity only after the farm insert succeeds:

```ts
const { data: entity, error: entityError } = await supabase
  .from('entities')
  .insert({
    farm_id: farm.id,
    name: entityName.trim(),
    entity_type: selectedEntityType,
    is_active: true,
  })
  .select('*')
  .single()
```

If entity creation fails, do not create a second farm on retry. Re-query the owner's farm, see that it has no entity, and resume at entity setup. Say **“Your farm was created, but we still need its operating name. Nothing was lost.”** A later support migration may wrap both steps in one RPC, but the current trigger safely establishes ownership first.

The initial-owner marker is an onboarding control that still needs implementation outside this public PWA. Until it exists, Crop RX should create the first farm through a trusted admin workflow and let the browser only discover it. This prevents every provisioned employee account with zero memberships from becoming a new farm owner.

## Fields repository contract and adapter boundary

The public contract stays exact:

```ts
export interface FieldsRepository {
  getData(): Promise<FieldsData>
  saveField(draft: FieldDraft): Promise<Field>
}
```

Supabase is isolated behind a fakeable gateway:

```ts
export interface FieldsDataGateway {
  loadWorkspace(farmId: string): Promise<FieldsRowBundle>
  saveFieldBundle(input: SaveFieldBundleInput): Promise<SavedFieldBundle>
}

export interface SaveFieldBundleInput {
  farmId: string
  operationId: string
  draft: FieldDraft
}

export interface SavedFieldBundle {
  field: Field
  arrangement: Arrangement
  cropAssignments: CropAssignment[]
}
```

`SupabaseFieldsRepository` receives `{ gateway, getFarmId, createId, clock }` in its constructor. Tests pass a fake gateway and deterministic IDs/clock. It must never silently instantiate a mock or catch a live error and return seed data.

The queue needs to reuse an operation ID after an uncertain response without widening the UI contract. Use this internal-only capability:

```ts
export interface FieldsOperationWriter {
  saveFieldOperation(draft: FieldDraft, operationId: string): Promise<Field>
}

export class SupabaseFieldsRepository
implements FieldsRepository, FieldsOperationWriter {
  async saveField(draft: FieldDraft): Promise<Field> {
    return this.saveFieldOperation(draft, this.createId())
  }

  async saveFieldOperation(
    draft: FieldDraft,
    operationId: string,
  ): Promise<Field> {
    // Validate/map, then call gateway.saveFieldBundle with this exact ID.
  }
}
```

`QueuedFieldsRepository` receives a `FieldsRepository & FieldsOperationWriter`, but exports only `FieldsRepository`. The UI therefore sees exactly `getData()` and `saveField(draft)` while replay can safely reuse the stored ID.

### `getData()` mapping

After auth/farm context resolves one farm ID, `loadWorkspace(farmId)` issues these reads (parallel after the farm row is known):

| Returned property | Table/query |
|---|---|
| `farm` | `farms.select('*').eq('id', farmId).single()` |
| `entities` | `entities.select('*').eq('farm_id', farmId).order('name')` |
| `fields` | `fields.select('*').eq('farm_id', farmId).order('name')` |
| `crop_assignments` | `crop_assignments.select('*').eq('farm_id', farmId).order('crop_year').order('planting_sequence')` |
| `arrangements` | `arrangements.select('*').eq('farm_id', farmId).order('effective_from')` |
| `commodities` | `commodities.select('*').eq('is_active', true).order('name')` |

Every farm-scoped query includes the resolved farm ID even though RLS also protects it. Any query error rejects the entire `getData()` call; do not return a partial workspace. Require exactly one farm row, validate all foreign IDs in memory, and convert PostgREST numeric values with a strict `toFiniteNumber` mapper. Preserve `null` rather than converting it to `''`, `0`, or `undefined`. Unknown enum values and non-finite numbers are errors.

The current `FieldsData` shape is one farm. V1 therefore fails closed if account setup resolves zero or multiple usable farms; it never chooses “the first row.” A future farm switcher can provide an explicit selected farm ID without changing the repository methods.

### `saveField(draft)` mapping and exact behavior

The repository validates the same farmer-facing rules as the mock, assigns UUIDs on the client for every new row, and sends one RPC call:

```ts
const input: SaveFieldBundleInput = {
  farmId,
  operationId: crypto.randomUUID(),
  draft: normalizedDraft,
}
```

The RPC performs this mapping atomically:

- **Field:** insert supplied `id` for a new field or update the existing row. Write `farm_id` from `p_farm_id`, never from JSON; map name, entity, acres, county, state, legal description, FSA numbers, soil index. Preserve existing `created_at` and `is_active`; let database triggers set `updated_at`.
- **Entity check:** require `(operating_entity_id, p_farm_id)` to exist before any write.
- **Arrangement:** compare all terms, including the two contact fields and optional values. An unchanged/same-effective-date edit updates the current row in place and preserves its ID/`created_at`. Changed terms with a later date close the current row at one day before the new effective date and insert the supplied new arrangement ID. A changed earlier date rejects. There must remain only one open arrangement.
- **Crop assignments:** an empty array means “do not change crop assignments,” matching the mock's basics/quick-add behavior. A non-empty array affects only the years present in that draft. Preserve every supplied existing ID after proving it belongs to this field and farm; reject an unknown/stale supplied ID. Insert client-assigned IDs for new rows, update preserved rows, delete omitted rows only within affected years, and leave all other years untouched. Enforce unique `(field, year, commodity, planting_sequence)` and the field-acre check.
- **Optional values:** all optional strings round-trip as trimmed text or `null`; numeric optionals round-trip as the same finite number or `null`. Zero remains zero where allowed. The strict mapper returns all properties required by `Field`, `Arrangement`, and `CropAssignment`.
- **Confirmation:** return only after the transaction and receipt commit, then map the returned canonical rows. Any Supabase error, missing returned row, malformed result, RLS denial, or validation failure rejects. No success toast may be based on a request merely being sent.

The RPC receipt gives the same canonical result when `operationId` is replayed. A network timeout is therefore ambiguous but safe: queue the same operation ID; never generate a new one for that retry.

### Proven mock behaviors translated to live

| Regression behavior | Live equivalent |
|---|---|
| Landlord phone/contact notes round-trip | Additive columns are a live-swap gate; save through RPC, re-read through gateway, compare exact normalized values. |
| Fields write leaves Grain bytes untouched | Fields live code never reads/writes `farm-rx-local-data`. Grain mock owns its local slice. Inject the live `FieldsRepository` into `MockGrainRepository` so Grain can calculate from live Fields without copying or rewriting Fields data. |
| Storage failure rejects and changes nothing | Queue persistence uses write-then-read verification; failure rejects. Remote save is one DB transaction; failure rolls it all back. |
| Corrupt/unknown envelope remains untouched | Queue parser accepts only its exact version/schema. Corrupt queue causes a visible blocked-sync error and no overwrite. It is separate from the mock envelope. |
| Same-date arrangement edit preserves ID | RPC updates that row in place. |
| Future arrangement change preserves history | RPC closes the current row the day before and inserts one current row atomically. |
| Crop-assignment IDs survive edits | Client sends existing IDs; RPC verifies ownership and upserts those same IDs. Unknown IDs fail closed. |
| Grain/Fields compartment separation | Constructor injection removes `MockGrainRepository`'s direct import of `MockFieldsRepository`; each repository writes only its own backend. |
| Grain save cannot overwrite current Fields | Grain envelope writer continues projecting out `fields`; regression runs with an injected fake/live Fields repository and asserts the grain write never touches it. |

Required constructor change behind the data seam:

```ts
export class MockGrainRepository implements GrainRepository {
  constructor(private readonly fieldsRepository: FieldsRepository) {}
  // getData() obtains Fields through this.fieldsRepository; Grain persistence
  // still writes only the Grain slice.
}
```

This is data-layer plumbing, not a Fields UI change.

## Explicit repository selection seam

There is no environment-variable switch, URL inference, automatic fallback, or generic “use mock” boolean. One checked-in manifest names the backend for each module:

```ts
export const moduleBackends = Object.freeze({
  fields: 'supabase',
  grain: 'mock',
} as const satisfies {
  fields: 'supabase'
  grain: 'mock' | 'supabase'
})
```

Composition order:

```ts
const liveFields = new SupabaseFieldsRepository(/* explicit dependencies */)

export const fieldsRepository: FieldsRepository =
  new QueuedFieldsRepository(liveFields, /* queue + status dependencies */)

export const grainServices: GrainServices = {
  grainRepository: new MockGrainRepository(fieldsRepository),
  marketDataService: new MockMarketDataService(),
  profitabilityRepository: new MockProfitabilityRepository(),
  createGrainId,
}
```

Guards that make the wrong backend difficult:

- `supabaseClient.ts` asserts the exact project hostname/ref before constructing the client.
- There is no runtime fallback from Supabase Fields to mock Fields. A live failure is shown honestly.
- A `createSupabaseGrainServices()` factory does not exist until `0004`, `0005`, and `0008` are applied and verified. TypeScript therefore cannot satisfy the `'supabase'` grain branch early.
- A small regression asserts `moduleBackends` equals `{ fields: 'supabase', grain: 'mock' }` for this release.
- Production composition imports mock implementations only for modules explicitly named `mock`.

Later, after Grain schema/privacy verification and a real repository exist, the intended one-line release change is:

```diff
-  grain: 'mock',
+  grain: 'supabase',
```

That line is allowed to compile only when the Supabase Grain factory is present. Do not make the change merely when draft SQL files exist.

## Offline write queue at the repository seam

### Scope and promise

V1 protects Fields writes only. It does not promise a full farm view after a cold offline start. The promise is: once the user taps Save, Farm Rx either confirms the server write, confirms a durable queued copy on this device, or shows an error while leaving the form values on screen.

`QueuedFieldsRepository implements FieldsRepository` decorates the live repository. The Fields UI still calls `getData()` and `saveField()`.

### Durable format

Use a separate key from `farm-rx-local-data`:

```ts
const key = `farm-rx-write-queue:v1:${projectRef}:${userId}:${farmId}`

interface FieldsQueueEnvelopeV1 {
  version: 1
  entries: FieldsQueueEntryV1[]
}

interface FieldsQueueEntryV1 {
  version: 1
  module: 'fields'
  kind: 'saveField'
  operationId: string
  userId: string
  farmId: string
  enqueuedAt: string
  draft: FieldDraft // already normalized and carrying client UUIDs
}
```

Before resolving a queued save, stringify the full next envelope, call `localStorage.setItem`, read the key back, require byte-for-byte equality, parse it, and validate version/schema. If any step fails, restore nothing over an unsafe envelope, reject `saveField`, and say **“This entry could not be saved on this device. Keep this screen open and try again.”**

The queue contains private farm/contact information. Key it by project + authenticated user + farm, never display another user's queue, and never replay it under a different session. Sign-out removes the auth session but does not silently delete unsynced work. On the same user's next sign-in, replay resumes. Device-data deletion must be an explicit action and must warn if pending entries exist.

### Save algorithm

1. Normalize/validate the draft and assign all missing row IDs plus one operation ID before the first network attempt.
2. If the browser is known offline, durably append immediately. Do not attempt a doomed request first.
3. If online/unknown, call the live repository with that operation ID.
4. On confirmed live success, update the in-memory workspace from canonical returned rows and report `synced`.
5. Queue only failures classified as transport failures: offline, fetch failure, connection reset, or timeout/unknown commit. Reuse the same operation ID.
6. Do **not** queue authentication expiry, RLS/permission denial, duplicate-name/validation errors, malformed server results, or other definite server rejections. Reject and show the mapped plain-English error.
7. Resolve `saveField()` after either remote commit confirmation or durable local queue confirmation. These are different statuses. A durable queue is a confirmed device save, never represented as server-synced.

Maintain the last successfully loaded `FieldsData` in memory and overlay queued drafts so the current open session can refresh after an offline save. Do not persist a browse cache in v1. After a cold offline start, keep the queue safe but show **“Your saved entries are waiting on this device. Connect to load your farm.”**

### Ordered replay

Trigger `replay()` after sign-in/farm resolution, on the browser `online` event, and from a manual **“Try again”** action. Only one replay loop may run per user/farm (a process-local mutex).

```ts
async function replay(): Promise<void> {
  while (queue.entries.length > 0) {
    const head = queue.entries[0]
    const result = await operationWriter.saveFieldOperation(
      head.draft,
      head.operationId,
    )
    // Remove only this confirmed/idempotently-received head, persist+verify
    // the shortened queue, then proceed to the next entry.
  }
}
```

- Process strictly first-in/first-out. Do not use `Promise.all` and do not skip a failing head.
- Remove an entry only after the RPC returns the canonical result for its operation ID and the shortened queue itself is durably verified.
- A transport failure stops replay and leaves the head intact.
- A definite validation/conflict/permission failure stops replay, marks **“Needs attention”**, keeps the entry, and exposes a retry/discard decision. Never loop forever or silently discard it.
- Multiple tabs coordinate with `navigator.locks` when available and a short localStorage lease fallback; the server receipt remains the final duplicate guard.

### Honest status surface

`syncStatus.ts` publishes, without changing `FieldsRepository`:

```ts
type SyncState =
  | { kind: 'synced'; pending: 0 }
  | { kind: 'pending'; pending: number }
  | { kind: 'syncing'; pending: number }
  | { kind: 'blocked'; pending: number; message: string }
```

A small global notice in the app wrapper subscribes via `useSyncExternalStore` and uses at least 18px text:

- `synced`: **“All changes synced.”** (may disappear after a short delay)
- `pending`: **“Saved on this device — waiting for signal. 1 change pending.”**
- `syncing`: **“Sending saved changes…”**
- `blocked`: **“1 saved change needs attention. Nothing was deleted.”** plus a 48px **“Try again”** action.

The existing inline word **“Saved”** means accepted durably; the global notice supplies the required synced-versus-pending truth. Terra should update any new success copy to **“Synced”** only when the status store confirms remote receipt.

### Conflict policy

V1 is **last replayed write wins** for the same field. The queue keeps the farmer's saves in the order made, so their later entry is applied after their earlier entry. Across two devices, whichever valid save reaches the server last becomes current. Arrangement history rules still apply, so an invalid earlier effective date fails rather than rewriting history.

This is the smallest understandable policy for a farm usually edited by one owner, and it prevents a weak-signal retry from becoming a duplicate. The tradeoff is that two people editing the same field can overwrite each other's ordinary field values. The server `updated_at`, operation receipts, and logs retain evidence; a later version can add a review screen or optimistic version check. V1 must state this in support documentation and must never silently merge incompatible crop arrays.

## Regression and proof plan

### Executable without network

The live repository regression imports no real Supabase client. It supplies a `FakeFieldsDataGateway`, `FakeStorage`, fixed clock, and fixed UUID source. It must execute at least:

1. `getData()` maps all six result sets, numeric strings/numbers, null optionals, and rejects one failed/partial query.
2. New field save sends exactly one farm-bound bundle and returns only the gateway's canonical field.
3. Every remote rejection propagates; no fake success or mock seed appears.
4. Phone/contact and all five missing-schema properties round-trip after the support migration contract is represented by the fake.
5. Existing crop-assignment IDs are preserved; a stale ID rejects; omitted rows are deleted only in draft years; an empty list changes no assignments.
6. Same-date arrangement edit preserves ID; later-date terms close/insert; earlier changed date rejects.
7. Remote multi-table failure changes no fake database state.
8. Fields save does not read/write `farm-rx-local-data`; Grain token bytes stay unchanged.
9. Offline save writes only the versioned queue key, verifies it, returns a client-stable field ID, and publishes `pending`, not `synced`.
10. localStorage full/corrupt/unknown-version failures reject without overwriting the existing value.
11. Replay is FIFO, uses the original operation IDs, stops on the first failure, and removes only a confirmed head.
12. A lost-response replay receives the stored receipt and does not duplicate arrangement history or assignments.
13. A different signed-in user cannot see or replay the first user's queue.
14. Injected `MockGrainRepository` reads Fields through the selected repository and a Grain save cannot write a Fields copy.
15. Composition asserts Fields live, Grain mock, and the exact Supabase project ref.

Keep the existing mock regressions running too; they remain protection for practice-mode Grain and envelope upgrades.

### One-time manual checks against the real development database

Run these only after the support migration is reviewed/applied to the non-production Farm Rx development database and a deliberate test matrix of Auth users/farms exists:

1. Provision owner, manager, worker, read-only employee, granted employee, named rep, and unrelated user accounts.
2. Sign in through the real login, close/reopen the installed PWA, confirm session restore, wait through a token refresh, and sign out. Confirm private routes never flash while signed out.
3. Bootstrap one test owner: verify the farm insert creates exactly one active owner membership and that direct RPC execution of the trigger function remains denied.
4. Create/edit a field with every optional value, same-date agreement edit, later agreement, double-crop assignments, and preserved assignment IDs. Re-read after a fresh session.
5. Force one invalid child in a bundle and verify no field, arrangement, assignment, or receipt partially commits.
6. Drop signal during/after Save, reload while still offline, reconnect, and verify exactly one replayed result and honest pending/synced text.
7. Confirm Grain still shows practice-mode data and that no Grain table query appears in the browser network log.
8. After applying draft `0008` in that development test only: owner and manager can read Grain/Profitability; an ungranted worker/read-only member cannot; a specifically granted active member can; suspension/revocation removes access immediately.
9. Rep matrix: toggle off + grant on = denied; toggle on + no/current-disabled grant = denied; toggle on + current named grant = read allowed; rep writes remain denied.
10. Cross-farm attack checks: alter nested `farm_id`, entity, field, bin, budget, or crop-assignment IDs and verify RLS/composite checks reject them.
11. Verify every Module 4 SECURITY INVOKER view returns no rows to an ungranted employee and only same-farm rows to authorized readers.

Do not use service-role credentials for customer-path checks; they bypass RLS and prove the wrong thing.

## Draft `0008` privacy explainer for the owner

`0008_employee_privacy.sql` is a blueprint only. It assumes the Grain and Profitability drafts (`0004`–`0007`) have already been applied in that order. This design session did not apply any of them.

It adds one simple permission to each farm membership: **View financials**. The default is OFF.

- Owners and managers can see grain and profitability because those roles run the farm's financial work.
- Workers and read-only employees cannot see those numbers by default.
- An owner or manager can turn on View financials for one specific active employee. Turning it on for one person does not open it for everybody.
- If that membership is suspended or revoked, access stops even if the flag was previously on.
- Employees cannot grant the permission to themselves. Existing membership policies allow only owners/managers to edit membership settings.

The permission lives on `farm_memberships` instead of in a second permissions table because it has exactly the same farm/user identity and lifecycle. That keeps revocation simple and prevents an old permission row from surviving after membership removal.

The database helper `can_read_private_financials(farm_id)` checks the signed-in person on every read. It grants access only when either:

1. the person has an active membership and is an owner/manager or has the per-member flag; or
2. the person is the exact named Crop RX rep, the farm's share toggle is ON, and that rep's separate grant is still enabled.

That second path is copied from the existing rep design. `0008` does not replace it with membership access and does not make the toggle sufficient by itself. Reps still receive no write policy.

Each Grain and Profitability base-table read policy is narrowed to the new helper while retaining its same-farm parent checks. The public USDA calendar remains readable to signed-in users because it contains no private farm data. Profitability calculation views are already `SECURITY INVOKER`, meaning they use the signed-in person's base-table permissions; the restriction therefore carries through every calculation view without a bypass.

### Owner decision still open

Before applying draft `0006`, confirm the real flex-cash-rent calculation. The current Fields UI/mock and the Profitability draft use different formula keys and different meanings for price/yield bonus rates. That decision does not weaken `0008`, but it must be resolved before profitability math is trusted.
