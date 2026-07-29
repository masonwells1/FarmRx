**BLOCKER — “pure” snapshot methods mutate repository state.** Their own contracts prohibit mutation, but both snapshot paths update retained workspace/cache fields (and Fields clears receipt state):

- [fields.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/fields.ts:186) requires snapshots to “never … mutate.”
- [QueuedFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:89) assigns workspace state and clears receipts; its offline path also assigns/clears workspace at lines 96–100.
- [equipmentTasks.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/equipmentTasks.ts:23) likewise promises no mutation.
- [QueuedEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:66) assigns workspace state; its offline path does the same at lines 73–77.

This lets a projection/Today read alter later normal save behavior, directly violating the isolation guarantee. **NO-GO** until snapshots use only local variables and do not clear or update retained repository state.

The remaining static checks were clean: the canonical Fields parser rejects malformed, duplicate, cross-farm, and dangling rows; Equipment validates numeric precision/range and relationships while accommodating deleted-interval history; request filters/bodies are explicitly asserted in E2E; profile token/epoch checks are paired; and the code tranche is 18 files (17 tracked modifications plus `deviceClockFence.ts`). Residual risk remains because this was intentionally source-only—no build, runtime, IndexedDB, browser, or network verification was run.

External mutation: no
