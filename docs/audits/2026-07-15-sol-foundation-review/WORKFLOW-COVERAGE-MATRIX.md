# Workflow Coverage Matrix

Legend: **Strong** = guarded with meaningful local proof; **Conditional** = branch implementation passes but live/device proof requires a release action; **Partial** = important behavior is not fully exercised.

| Area | End-to-end path reviewed | Branch controls and proof | Assessment |
|---|---|---|---|
| Auth and sign-in | Login -> Supabase session -> Farm access gate -> selected farm -> repositories | Built login/browser tests; cached session context; sign-out cache clearing; RLS matrix | **Strong locally / Conditional live** — Auth settings and real-account matrix remain |
| Onboarding and provisioning | Authenticated no-farm state -> owner bootstrap -> farm/membership -> shell | Fresh migrations and static RPC trace | **Partial** — public-signup and production provisioning settings not rechecked |
| Membership, roles, privacy, rep access | Membership/grant -> access/edit/manage/private helpers -> RLS -> UI/repository | Fresh manager/worker/read-only/rep off/rep on/stranger matrix; selected farm revalidated | **Strong locally / Conditional live** |
| Multi-farm selection | Accessible farms -> explicit picker -> active context -> farm-scoped queue/cache/request -> switch confirmation | `App.tsx:214,444-462`; two-farm browser choice/switch/cache isolation | **Strong** |
| Fields, entities, leases, crops | Form -> expected aggregate versions -> queued repository -> versioned RPC -> same-farm rows -> UI | `0036` session attacks, receipt replay, whole child-set comparison, offline browser save/reload | **Strong locally / Conditional migration** |
| Grain production/contracts/offers/bins/insurance | UI validators -> queued repository -> optimistic direct rows or hardened RPC/ledger -> RLS -> position | Existing 0033 and Grain regressions plus direct-row expected timestamps | **Strong locally / Conditional migration** |
| Marketing math and alerts | Manual bid -> two-day freshness -> exact scope -> transition state -> notification/push queue -> delivery recheck | Client regression; 0037 fixed-clock scope/freshness/dedupe proof; revised Edge source | **Strong evaluator / Conditional deployment** |
| Profitability and land economics | Budget/cost/allocation form -> expected timestamp -> gateway -> private RLS -> reports | Regressions, 0034 RPC proof, conditional direct-row update proof | **Strong locally / Conditional migration** |
| Inventory and spray compliance | Product/receipt/application form -> queue projection -> direct product CAS or bundled/ledger RPC -> compliance/on-hand UI | Inventory regression; cache/projection; shared queue lock; existing receipt/application RPC guards | **Strong locally**; real EPA-sensitive device workflow remains manual proof |
| Equipment, tasks, maintenance | Form/assignment -> queue -> expected timestamp or service RPC -> task/due views | Equipment regression; queue lock; 0035 service/task proof; direct conditional-update session attack | **Strong locally / Conditional migration** |
| Field Log | Form -> queue/cache projection -> receipt-backed save/delete -> timeline | Repository regression and shared queue transaction | **Strong locally**; no dedicated browser edit/delete replay scenario |
| Harvest | Form -> crop expected timestamp -> queue -> versioned harvest RPC -> crop actuals -> Grain | 0036 two-session conflict/lost-response proof; queue version rebasing | **Strong locally / Conditional migration** |
| Scouting/photos/notes | Note/photo -> queue/cache -> private storage + RPC -> cleanup outbox -> UI | Repository regression, shared cross-tab queue, private-path/static RLS proof | **Partial** — physical upload/delete/cleanup and quota proof remain |
| Programs and task/application handoff | Template/pass -> receipt RPC -> assignment/task/application snapshot -> due evaluator | Program regressions; 0035 task authority; 0037 app-closed due/dedupe proof | **Strong locally / Conditional scheduler** |
| Weather and spray window | Field coordinates -> Open-Meteo local observation -> conservative evaluator -> false→true state -> notification | Pure weather regression; 0037 transition/dedupe database proof | **Strong evaluator / Conditional Edge runtime and live weather** |
| Notifications, email, push | Notification -> own-user RLS -> push delivery row -> claim/backoff -> service worker | Notifications regressions; 0035 queue proof; 0037 event-to-delivery-row proof | **Conditional** — real subscribed device and provider delivery remain |
| PWA/offline | Service worker shell -> cached farm context -> IndexedDB workspace -> pending queue projection -> reconnect replay | Desktop+phone offline reopen/create/reload, expiry fail-closed, sign-out clearing | **Strong browser proof / Conditional installed devices and pressure** |
| Cross-tab/offline queue | User action -> shared queue transaction -> Web Lock or lease -> durable envelope -> broadcast -> replay | Two-page notification attack; 40 concurrent append regression; mutation guard | **Strong** |
| Stale write and missed response | Editor version -> compare-and-swap/RPC -> 409 conflict or prior operation receipt -> UI message/queue park | 0036 field/harvest sessions, direct equipment update sessions, idempotent retry regression | **Strong for audited mutable saves**; richer compare/merge UX remains optional follow-up |
| Third-party browser code | Market component -> dedicated frame URL -> sandbox opaque origin -> frame-only CSP -> TradingView | Hostile desktop/phone test; parent script-src self-only; CSP hash guard | **Strong branch proof / Conditional live headers** |
| Mobile navigation | Four primary links + More -> all remaining destinations -> route | 22-test browser suite includes four widths on desktop and phone projects | **Strong** |
| Migrations, RPCs, RLS, storage | 0001-0037 fresh apply -> disposable behavior -> role matrix | 0033/34/35/36/37 PASS; RLS matrix PASS | **Strong locally / Blocked live drift** |
| CI and regression proof | PR -> foundation workflow -> one combined command -> browser/database/static/mutation gates | `.github/workflows/foundation.yml`; `scripts/verify-foundation.ps1`; full PASS | **Strong branch proof** |
| Cross-module reconciliation | Fields/Harvest -> Grain; leases -> Profitability; Inventory/Programs -> application/cost; Equipment/Programs -> tasks/notifications | Existing repository regressions, 0033-0035 database probes, expected-version guards, cached projections | **Strong structural proof / Partial real multi-module browser proof** |

## Reconciliation conclusions

- Fields and Harvest now share the same field-level transaction lock and expected crop versions, so a quick-harvest save cannot race a stale full-field bundle.
- Offline sequential edits are rebased only on the canonical version returned by the preceding replay. An external change before the first replay still conflicts and parks instead of being overwritten.
- Append-only bin, delivery, adjustment, application-correction, meter, and operation-receipt paths retain ledger/idempotency behavior; they were not converted into ordinary editable rows.
- Program-owned task transitions remain server-authoritative. Marking a Program pass applied does not falsely imply inventory drawdown unless an application record exists.
- Scheduled alerts create ordinary `notifications`; the existing trigger creates exactly one `push_deliveries` row. Delivery-provider execution remains a deployment/device gate.
