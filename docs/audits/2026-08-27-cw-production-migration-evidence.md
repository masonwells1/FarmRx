# CW production migration evidence locator

## Scope

This documentation-only locator supplies provenance for the time-stamped 2026-08-27 CW production migration record. It contains no customer data, secrets, SQL credentials, or production-user-path evidence.

## Immutable action records

The source is the append-only host session record:

`C:\Users\mason\.codex\sessions\2026\08\25\rollout-2026-08-25T12-06-19-01a039e3-137a-7ca2-af3f-8cbfd5271b5b.jsonl`

Each locator below identifies an event by its stable ordinal and the SHA-256 of that complete raw JSON line. The source timestamps are UTC; on 2026-08-27 `America/Chicago` was UTC-05:00.

| Event ordinal | UTC timestamp | America/Chicago timestamp | Action | Raw-line SHA-256 |
| --- | --- | --- | --- | --- |
| 1805 | 2026-08-27T17:20:47Z | 2026-08-27 12:20:47 -05:00 | First CW migration application | `d2d921f816e60351f0ae5022bacf505174f6d58e430994c46c5483b6803b0762` |
| 1917 | 2026-08-27T17:24:34Z | 2026-08-27 12:24:34 -05:00 | Generated migration-ledger key changed to canonical `20260813133808` | `4047dae98c0c4cb654e88082e2d502f68c354dd0d7ac4ab05fddd1ec3a0b5a9f` |
| 1937 | 2026-08-27T17:25:15Z | 2026-08-27 12:25:15 -05:00 | Second CW index migration and canonical `20260820135357` ledger record | `629607e6153801598c466ae40aeaa642bb4407653996d156519d787651ccf346` |
| 1962 | 2026-08-27T17:26:07Z | 2026-08-27 12:26:07 -05:00 | Second ledger statement normalized to exact committed bytes | `85bb79f4225882b06b5eeb5649820c90fb5d61c28af78bd2394812b98e44c343` |
| 1968 | 2026-08-27T17:26:31Z | 2026-08-27 12:26:31 -05:00 | Post-apply SQL verification | `173079ea8565926596e11a7d06f8d0d43f3634523ea7d78dc7b0c5e7a52eaf1d` |

## Exact release source

The action sequence was re-attested against clean Farm Rx `origin/main`/HEAD `e7a2a3442ff0d5d4e8230a61933e66d515c981b3`. The live migration statements matched the source blobs `6e37cfb47456ed28e9b259f7e5520f5a1697708e` and `5eaae2bf172659a23b6c6fa749940a2ff376e2d9`.

## Limits

This locator establishes database-action provenance only. It does not establish a production CW browser journey, real-farmer use, customer-data action, or any authority beyond the migration/ledger action actually recorded above.
