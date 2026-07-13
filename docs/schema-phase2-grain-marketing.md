# Farm Rx Phase-2 Grain Marketing Schema — Owner Review Draft

These files are a database blueprint only. They have not been applied to a database.

## Grain alert settings

`grain_alert_settings` stores one private email-delivery preference row for each farm. The farm ID is both its primary key and its link to the farm, which makes a second settings row for the same workspace impossible.

`alert_emails` is an array because the Alerts screen edits the addresses as one setting. It may be empty, but it may contain no more than three trimmed, looks-like-email values. This supports the farmer plus an advisor or spouse; Mason's approval of a second address on 2026-07-13 replaces the earlier owner-only default. The database check catches obvious malformed values, but actual delivery still depends on the email provider accepting the address. `updated_at` records the last settings change.

The row is as private as grain. Only someone allowed to read private farm financials can select it. Writes use the same farm-editor rule as the existing grain tables, and representatives still receive no write policy. The farm stamp cannot be changed after creation.

## Marketing alert rules

`marketing_alert_rules` stores the farmer's price targets, percent-marketed goals, and date reminders. Every rule repeats the Module 2 PositionScope: farm, crop year, commodity, optional operating entity, and optional named enterprise. The composite entity link prevents a rule from pointing at an entity in another farm.

The type check gives each rule exactly the fields it needs. A price target requires a direction and a positive price no greater than $1,000 per bushel. A percent-marketed goal requires a percentage greater than zero and no more than 100. A deadline requires a reminder date. Direction is forbidden on non-price rules, and threshold is forbidden on deadline rules, so changing rule types cannot leave misleading old values behind. The farmer's message is optional, `active` can pause a rule without deleting it, and `last_triggered_at` supports duplicate-alert suppression later.

Reads require the private-financial permission added in 0008. Writes follow the existing grain editor policies and repeat the same-farm entity check. The farm stamp is immutable, and `updated_at` uses the shared database trigger.

## Firm offers

`firm_offers` stores standing buyer bids and working orders. It uses the same PositionScope as contracts so an open offer can appear in a projected position without being counted as sold grain.

Buyer and bushels are required. A cash offer requires `price`; a basis offer requires `basis`; and an HTA offer requires `price`, where `price` represents the futures price. This mirrors the existing `grain_contracts` rule while keeping the phase-2 column names from the plan. Basis may be negative. Contract month, expiration, delivery location, and notes remain optional because not every buyer supplies them at entry time.

An offer may be open, filled, expired, or canceled. A filled offer may temporarily have no contract link while the conversion flow is completing, but any populated `filled_contract_id` requires filled status. The composite foreign key proves the resulting contract belongs to the same farm. Deleting that contract clears only the link and preserves the offer history.

Reads use private-financial access; writes use the existing grain editor rule. Entity-scoped policies and the composite foreign keys prevent cross-farm links. The farm stamp is immutable, and the standard `updated_at` trigger records edits.

## Grain-bin moisture

Migration 0029 adds optional `moisture_pct` and `moisture_checked_on` fields to the existing `grain_bins` table. Moisture must be between 0 and 40 percent when present. The date is independent so the application can preserve when a check happened even if a reading later needs correction. No existing row is rewritten, and the current grain-bin RLS continues to protect both columns automatically.

## Bin transactions

`bin_transactions` stores an append-only in/out movement history for each physical bin. Bushels must be positive, while `direction` supplies the sign. Commodity is a real commodity foreign key rather than free text, and the composite bin link proves that the transaction and bin belong to the same farm. A bin with transaction history cannot be deleted, which preserves the ledger. `occurred_on` is a required business date; `created_at` is the audit timestamp. Optional `source_kind` leaves room to distinguish manual entries, opening balances, harvest receipts, or contract deliveries without pretending those integrations already exist.

Append-only means authenticated clients receive select and insert access only. There is no update or delete grant and no update or delete policy. A correction must be a new opposite-direction transaction, following Module 3's immutable adjustment-ledger pattern. Reads also require private-financial access and repeat the same-farm bin check; inserts require ordinary farm edit access and the same parent check.

`bin_inventory` remains the current snapshot used by existing writers. This draft does not rewrite it, dual-write into the new ledger, or create a derived balance that would omit older inventory. The follow-up for Chunk 5 is to choose a cutover date, seed an opening transaction for each current bin balance, make new bin changes write ledger entries, and then expose a security-invoker balance view computed as in minus out. That follow-up must also preserve `bin_inventory`'s crop-year identity while the new transaction shape follows the approved Phase-2 columns. Until that behavior change is reviewed, the ledger is additional history and `bin_inventory` remains the displayed on-hand source.

## Budget insurance inputs

Migration 0030 adds four optional Revenue Protection inputs to `crop_budgets`: coverage percentage, APH yield, projected price, and premium per acre. Coverage must be 50–95 percent, APH and projected price must be positive, and premium may be zero but not negative. All four columns are nullable so insurance remains an optional budget section and existing budgets stay valid without a data rewrite.

No RLS change is needed. `crop_budgets` already has row-level security from 0007, and 0008 changed its read policy to `can_read_private_financials`. The existing policy automatically covers these new columns.

## Apply order and dependencies

Apply only after human review, in filename order:

1. `0027_marketing_alerts.sql` after 0004, 0005, and 0008.
2. `0028_firm_offers.sql` after 0004, 0005, and 0008.
3. `0029_bin_upgrades.sql` after 0004, 0005, 0008, 0010, and 0011.
4. `0030_budget_insurance.sql` after 0006, 0007, and 0008.

The four migrations are additive: they create new types and tables or add nullable columns and checks. They do not drop objects, rewrite data, change existing constraints, alter application code, or apply anything to a database.

Say 'apply the phase-2 schema' when ready.
