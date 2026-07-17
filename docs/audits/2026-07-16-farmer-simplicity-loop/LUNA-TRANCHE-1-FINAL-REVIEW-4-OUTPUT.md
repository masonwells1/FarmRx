REJECT — one HIGH finding.

- HIGH — replay completion is not gated before readiness. In [src/App.tsx:443-446](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:443), Grain, Inventory, Profitability, and Equipment replay use `void`; lines 451–453 publish the profile and set `"ready"` without awaiting them. A slow or failed replay can therefore leave the user in the ready UI while authorized replay/generation is still running. Await all replay promises before `setProfile`/`setState("ready")`, preserving fail-closed behavior.

Model/effort: `gpt-5.6-luna`, Medium.

Scope reconciled: exactly 20 core + 10 replay-containment code/test files. `deviceClockFence.ts` is the one untracked declared code file; audit artifacts are evidence-only. Option 2 remains selected; no new route was added.

Checks performed:

- `git diff --check`: PASS.
- Scope and secret-like scans: PASS; no modified-file secrets found.
- Static inspection: replay centralization, capability gating, queue validation, clock fencing, and strict mock structure reviewed.
- TypeScript/regression/build execution was attempted but blocked by the read-only environment (`EPERM` creating the `tsx` temp directory / npm access denial). No browser, Playwright, Git, service, or database mutation occurred.

Residual risk: browser behavior, live services/database, deployment, and the reported full proof suite remain unverified here.

External mutation: no.
