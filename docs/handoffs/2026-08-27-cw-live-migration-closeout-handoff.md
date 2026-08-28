# CW live-migration closeout handoff

## WHERE

`C:\Users\mason\.codex\worktrees\7b73\FarmRx`, branch `codex/farmrx-cw-closeout-ledger-e7a2`, based on Farm Rx `origin/main` `417fd08284e0cd0e73fb8ab2cd89bffd27a67c6b`. Production Supabase project: `agvsozfbstpekuqxpqjr`.

## GOAL

Publish an append-only Connect Workflows ledger correction that records the completed production migration release without claiming a production user-path test. Done when the documentation-only pull request is reviewed and its reported checks are green; merge remains a separate approval gate.

## PROVEN

- The production migration ledger records canonical versions `20260813133808_connect_workflows_program_inventory` and `20260820135357_add_program_inventory_match_fk_indexes`.
- The erroneous generated ledger version `20260827172046` is absent.
- Both expected Program-to-Inventory foreign-key indexes exist.
- The recorded SQL fingerprints match the reviewed source blobs: `28af4d0d64cad60cf341a8532e06652e` (27,156 bytes) and `31bf20055f5d9d295b3234679986e2f5` (503 bytes).
- The new `program_inventory_matches` table contains zero rows.

## WRITTEN, NOT PROVEN

The append-only closeout entry is documentation only. It does not prove the deployed CW browser paths against production dependencies.

## NOT STARTED

No production user-path test, real farmer use, customer-data action, or additional production mutation is authorized or required for this documentation closeout.

## APPROVAL STATE

Mason approved a documentation-only CW closeout: rebase the local ledger record onto current Farm Rx main, append the verified production migration facts, and publish through the normal pull-request path. This handoff does not carry approval to merge, deploy, test a production user path, migrate, alter data, or take customer action.

## GATES AND BLOCKERS

The original local reconciliation must not be rewritten. Add a new append-only entry that corrects only its now-stale live-migration limit. Obtain a fresh exact-commit read-only review and reported pull-request checks before seeking a separate merge approval.

## FIRST ACTION

Append the bounded CW live-migration reconciliation, run documentation diff hygiene, commit it, then request an exact-commit read-only review.

Verify current state from Git, disk, and connected services before trusting this handoff; it may be stale when read.
