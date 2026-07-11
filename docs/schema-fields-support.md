# Farm Rx Fields Live-Save Support — Owner Review Draft

These files are a database blueprint only. They have not been applied to a database.

## What this migration adds

- **Landlord contact details:** Fields arrangements gain a phone number and contact-notes field, so the live database can return everything already shown and saved by the Fields screen.
- **Crop planning and harvest values:** Crop assignments gain harvested bushels, expected yield per acre, and expected price per bushel. The database rejects negative bushels or prices and requires an entered expected yield to be above zero.
- **One safe Fields save:** The `save_field_bundle` database function saves the field, its current land arrangement, and the included crop assignments as one unit. It preserves arrangement history, keeps existing crop-assignment IDs, and changes only the crop years included in the save. An empty crop list leaves crop assignments alone.
- **Write receipts:** Each save carries a unique operation ID. After a complete save, the database stores the exact canonical result under that ID. Replaying the same operation returns that stored result instead of creating duplicate arrangement history or crop rows.
- **One safe first-farm setup:** The `bootstrap_first_farm` database function creates the signed-in farmer's first farm, owner membership, and first operating entity in one transaction. Concurrent calls for the same account are serialized, and retries return the existing setup instead of creating another farm.

## Why this protects a farmer on bad signal

A Fields save can touch three tables. If the browser sent three separate requests and the signal failed between them, the field might change while its lease or crop rows did not. The database function removes that partial-save window: either the whole bundle and its receipt commit, or none of them do.

A lost response is also safe. The server may have completed the save even though the phone never received the answer. Farm Rx can retry with the same operation ID. The receipt lets the database return the first completed result without performing the save again.

## How privacy works

The function uses the signed-in account supplied by Supabase and requires that account to have the existing edit permission for the selected farm. It does not accept a user ID, and it ignores farm or user stamps hidden inside the submitted data.

Every entity, field, arrangement, and existing crop-assignment reference is checked against the selected farm. Each submitted crop assignment must say whether it is new: `is_new: false` requires its ID to resolve to that exact field and farm, while `is_new: true` requires its ID not to exist anywhere. An unresolved existing ID is rejected instead of being inserted as a new row.

Receipt `user_id` values are immutable UUID provenance stamps rather than foreign keys to memberships. This preserves who performed a save without preventing a member from later being removed. Receipt results remain same-farm because the save function builds them only from farm-keyed rows, stores them under that farm ID, and the farm foreign key deletes them with the farm. Farmers cannot read or write the receipt table directly, and anonymous users cannot run either function.

## Exact RPC contracts

### First-farm bootstrap

Call `bootstrap_first_farm(p_farm_name text, p_entity_name text, p_entity_type text)` only as an authenticated user. Farm and entity names are trimmed and must be non-empty. `p_entity_type` is trimmed and must exactly match the foundation `entity_type` enum: `individual`, `sole_proprietorship`, `partnership`, `llc`, `corporation`, or `trust`.

The function locks bootstrap attempts by the signed-in user ID. If that user has no membership, it creates a farm with `created_by` set to the signed-in user and `share_with_rep` set to `false`; the existing 0002 trigger creates the active owner membership; then it creates the first entity in the same transaction. It returns `{"farm": <canonical farm row>, "entity": <canonical entity row>}`.

If the user already has any membership—including invited, active, suspended, or revoked—the function validates the inputs but creates nothing. It deterministically returns the earliest membership's canonical farm and that farm's earliest entity in the same JSON shape. `entity` is JSON `null` if that pre-existing farm has no entity. Anonymous and public callers have no execute permission.

### Fields bundle save

Call `save_field_bundle(p_farm_id uuid, p_operation_id uuid, p_draft jsonb)` as an authenticated user with edit permission for the farm. `p_operation_id` is the idempotency key: replaying the same farm-and-operation pair by the same user returns the stored canonical result; another user cannot reuse it.

`p_draft.crop_assignments` must be an array, and every item must contain JSON boolean `is_new`. For `is_new: false`, `id` must be a valid existing assignment on this exact field and farm; a missing, stale, other-field, or other-farm ID raises an error. For `is_new: true`, an optional supplied `id` must not exist anywhere; when omitted, the server generates one, and any collision raises instead of updating an existing row. The successful result is `{"field": <canonical field row>, "arrangement": <canonical current arrangement row>, "cropAssignments": [<all canonical assignment rows for the field>]}`. The marker is an input instruction and is not stored in or returned with assignment rows.

## What this draft does not change

This migration only adds five nullable columns, one private receipt table, and two restricted functions. It does not drop or alter an existing column, rewrite an existing row, or touch Grain or Profitability. Existing Fields data remains in place, with the five new values blank until farmers enter them.

The draft is designed to follow the applied `0001`–`0003` Fields foundation directly. It does not require any later draft migration. It still needs review and development-database proof before anyone applies it.
