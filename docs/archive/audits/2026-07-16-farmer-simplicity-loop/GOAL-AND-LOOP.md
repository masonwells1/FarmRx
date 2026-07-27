# Farm Rx Farmer Simplicity Layer — Goal And Closed Loop

## Objective

Turn Farm Rx's existing modules into one obvious daily experience for nontechnical farmers while preserving the production safety, privacy, offline durability, and Crop RX design system already proved in the foundation release.

The approved product scope is:

1. A `Today` home screen that answers "Am I okay today?"
2. A global `Quick Record` path for the most common farm actions.
3. A first-week setup checklist that gets a new farm to useful data without training.
4. A shared `Basic / More details` pattern for dense forms.
5. Navigation shaped by the signed-in user's role and available work.
6. Recovery and help improvements, including draft confidence and account/support paths.

## Non-Negotiable Product Rules

- Existing Farm Rx brand tokens and visual language remain the source of truth.
- Base text and controls must remain usable for a 55-year-old farmer on a phone, in sunlight, possibly wearing gloves.
- A common action must be reachable within two taps from `Today`.
- One clear primary action per screen region.
- Plain English; no software-team or medical metaphors.
- Grain and financial privacy remain visible and enforced by the database.
- Every save shows one of: `Saved`, `Saved on this device — waiting for signal`, or `Needs attention`.
- No production migration, deployment, customer communication, merge, or main push is implied by this loop.

## Roles

### Root orchestrator — Sol Extra High

Owns requirements, authority boundaries, worktree/branch state, task assignment, integration, proof, finding adjudication, and the final pre-commit decision.

### Sol worker — High

Owns architecture, permissions, cross-module data contracts, offline/recovery safety, implementation of risk-sensitive shared foundations, and focused proof.

### Terra worker — Medium

Owns farmer-facing information hierarchy, responsive interaction, reuse of the existing design system, representative browser workflows, and bounded UI implementation.

### Luna worker — Low/Medium

Owns route/component inventory, mechanical scope reconciliation, accessibility/test matrices, secret-like material scanning without printing values, and durable evidence consistency.

### Fresh Sol adversarial reviewer — Extra High

Receives requirements, current diff, and proof results only. It receives no implementation rationale and may not fix during its first pass.

## Closed Loop

### Phase 0 — Preflight

- Work from a fresh branch based on verified `origin/main`.
- Preserve the unrelated files in the original checkout.
- Record current authority: local code and test changes are approved; outward production actions are not.
- Confirm requested worker models are available. Do not silently substitute.

Gate: clean isolated worktree, exact base SHA, model/authority boundary recorded.

### Phase 1 — Visual Target

- Capture the existing Farm Rx visual language.
- Generate exactly three independent `Today` directions within the current brand.
- Mason selects one direction before UI implementation.

Gate: one selected visual target with an unambiguous image reference.

### Phase 2 — Independent Reconnaissance

- Sol maps architecture, permissions, aggregation safety, offline behavior, and the smallest safe data contract.
- Terra maps the current farmer journey, reusable components, responsive constraints, and exact two-tap flows.
- Luna inventories routes, components, tests, accessibility requirements, and proof gaps.
- All reconnaissance is read-only.

Gate: a reconciled implementation backlog with bounded files, proof commands, and stop conditions.

### Phase 3 — Serialized Implementation

Only one writer works at a time. Proposed slices:

1. Today read model and read-only dashboard route.
2. Today responsive UI and navigation/default-route integration.
3. Quick Record launcher using existing destination workflows.
4. First-week setup checklist derived from canonical farm state.
5. Shared progressive-disclosure form component and a representative low-risk rollout.
6. Role-shaped navigation using trusted current access data.
7. Recovery/help/account improvements that do not weaken authentication.

Each slice requires focused proof before the next writer starts.

### Phase 4 — Full Verification

Required local gates:

- `npx tsc -b --force`
- `npm run regression`
- `npm run build`
- `npm audit --audit-level=high`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-foundation.ps1`
- Focused browser workflow proof for desktop and phone-sized layouts.
- Weak-signal, offline, double-tap, stale-session, role, and recovery checks relevant to changed flows.

If a check fails, preserve the concise failure and continue independent checks. Do not call the gate green while required proof is failed or unrun.

### Phase 5 — Mandatory Adversarial Review

- Freeze writers.
- Fresh Sol Extra High tries to disprove every changed guarantee.
- Terra independently operates the farmer workflows and checks readability, two-tap reach, and visible save/retry behavior.
- Luna independently reconciles scope, proof, test quality, accessibility, secrets, and artifacts.

Gate: every finding has an ID, severity, evidence, disposition, owner, and verifying proof.

### Phase 6 — Fix/Review Repeat

- BLOCKER/P0/P1 findings must be fixed and reproven.
- P2 must be fixed or explicitly accepted by Mason with business reasoning.
- P3 may be deferred only with a named owner and regression/proof expectation.
- After fixes, rerun focused gates, full gates, and a fresh Sol delta review.

Gate: no unresolved BLOCKER/P0/P1; every P2 has a disposition.

### Phase 7 — Hard Pre-Commit Barrier

- Run `git diff --check`.
- Review status, diff stat, changed files, and untracked files.
- Scan changed/untracked content for credential-like material without printing values.
- Confirm no `.env`, generated browser artifact, secret, unrelated file, or temporary evidence is staged.
- Write `PRE-COMMIT-DECISION.md` with the verdict, changes, proof, adversarial results, remaining risk, and proposed commit message.
- Stop and ask Mason: `Approve this commit?`

No commit, push, PR, merge, production migration, or deployment occurs before its required approval.

## Done Means

- The selected design is implemented in the authorized local scope.
- The main farmer journeys work at representative desktop and phone sizes.
- Every changed save/recovery/role path has real proof proportional to its risk.
- Fresh Sol adversarial review and independent Terra/Luna checks are complete.
- No unresolved BLOCKER/P0/P1 remains.
- The worktree contains no secret or unrelated change.
- Mason receives the complete pre-commit packet and the exact branch/commit/publish state.
