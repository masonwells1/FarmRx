# Foundation Audit — Field Operations

**Scope:** Harvest, Field Log, Scouting/photos, Weather/spray guidance, queues, migrations, and grain/bin reconciliation.  
**Method:** Read-only code and design audit; no live database, network, or environment-file access. Focused repository regressions passed for Field Log, Harvest, Scouting, Weather, Grain, and bin ledger paths.

## Result

| Severity | Count |
|---|---:|
| P0 — money wrong, data loss, security | 0 |
| P1 — broken feature / unsafe operational result | 2 |
| P2 — correctness risk | 4 |
| P3 — polish | 0 |

## P1 findings

### P1 — Harvest actuals do not reconcile into Grain production or bin balances

Harvest is intentionally an independent per-field aggregate, not a load/scale-ticket or grain-cart system: the design explicitly excludes grain-cart integration. [docs/harvest-design.md:53](C:\FarmRx\docs\harvest-design.md:53) [docs/harvest-design.md:55](C:\FarmRx\docs\harvest-design.md:55)

The Harvest RPC only updates `crop_assignments.harvested_bushels`, `harvest_date`, and realized price. [supabase/migrations/0022_harvest.sql:146](C:\FarmRx\supabase\migrations\0022_harvest.sql:146) Grain marketing instead uses the separately entered `production_estimates.actual_bushels` when `drives_math` is `actual`. [src/data/grain.ts:139](C:\FarmRx\src\data\grain.ts:139) [src/data/grain.ts:142](C:\FarmRx\src\data\grain.ts:142) The Grain repository only derives planted acres and expected bushels from field assignments; it preserves the separate Grain actual-bushel value. [src/data/SupabaseGrainRepository.ts:40](C:\FarmRx\src\data\SupabaseGrainRepository.ts:40) Bin on-hand is likewise based on `bin_inventory` plus manually appended bin movements, not harvest entries. [src/data/binLedger.ts:30](C:\FarmRx\src\data\binLedger.ts:30) [src/data/SupabaseGrainDataGateway.ts:50](C:\FarmRx\src\data\SupabaseGrainDataGateway.ts:50)

**Farmer failure:** A farmer records 80,000 harvested bushels across fields, then opens Grain expecting contracts, marketed percentage, and bins to reflect that crop. Grain can still use the preseason estimate or an independently entered actual amount, while bins remain empty until manually entered. Marketing percentages and available-to-sell decisions can therefore be wrong.

**Suggested fix:** Keep v1’s aggregate harvest model if desired, but add an explicit reconciliation panel: Harvest total by crop/year, Grain actual-bushel value, bin on-hand, and unexplained difference. Require an intentional “copy harvest total to Grain actual production” action with confirmation; do not silently change bins. Long term, introduce immutable harvest-load records that can create linked bin-in movements.

### P1 — A failed forecast can still present stale conditions as “Good spray now” and trigger a good-window notification

When a live forecast request fails, the service returns any valid cached forecast as `stale: true`; it has no maximum stale age. [src/data/weatherService.ts:65](C:\FarmRx\src\data\weatherService.ts:65) [src/data/weatherService.ts:69](C:\FarmRx\src\data\weatherService.ts:69) The UI still evaluates that cached current sample, renders its full green/yellow/red verdict, and labels it “Spray now.” [src/WeatherModule.tsx:48](C:\FarmRx\src\WeatherModule.tsx:48) It only adds a caption saying the forecast is old. [src/WeatherModule.tsx:48](C:\FarmRx\src\WeatherModule.tsx:48) The same stale result can also cause a “Spray window is good” notification. [src/WeatherModule.tsx:30](C:\FarmRx\src\WeatherModule.tsx:30) [src/WeatherModule.tsx:34](C:\FarmRx\src\WeatherModule.tsx:34)

**Farmer failure:** Yesterday’s calm, dry cache is shown after today’s network outage. The page can show a green “Good — Spray now” light even though wind, rain, or inversion conditions have changed.

**Suggested fix:** Treat stale forecast data as `unknown` or at least cap it at `caution`; suppress “good window” notifications unless the forecast is fresh. Show the age prominently and require refresh before a positive recommendation.

## P2 findings

### P2 — Field-local weather times are calculated from field-zone data but displayed in the browser’s time zone

The weather request correctly asks Open-Meteo for `timezone=auto`, meaning forecast timestamps are in the field’s local zone. [src/data/weatherService.ts:68](C:\FarmRx\src\data\weatherService.ts:68) Daylight calculations compare absolute timestamps and are sound. [src/data/weatherService.ts:85](C:\FarmRx\src\data\weatherService.ts:85) However, “best window” hour labels and “As of” timestamps are formatted with `Intl.DateTimeFormat` without the field’s time zone, so they use the device/browser zone. [src/data/weatherService.ts:103](C:\FarmRx\src\data\weatherService.ts:103) [src/data/weatherService.ts:107](C:\FarmRx\src\data\weatherService.ts:107) [src/WeatherModule.tsx:13](C:\FarmRx\src\WeatherModule.tsx:13)

**Farmer failure:** A farmer traveling across time zones, or managing fields in another time zone, sees “Best window today: 9 AM–1 PM” in phone time rather than field time.

**Suggested fix:** Persist or return Open-Meteo’s resolved timezone and pass it as `timeZone` to every display formatter. Label the zone on the card.

### P2 — Harvest accepts arbitrary future harvest dates

The Harvest form has a planting-date minimum but no maximum date. [src/HarvestModule.tsx:45](C:\FarmRx\src\HarvestModule.tsx:45) [src/HarvestModule.tsx:46](C:\FarmRx\src\HarvestModule.tsx:46) Client validation only verifies that the date exists. [src/data/harvest.ts:39](C:\FarmRx\src\data\harvest.ts:39) The database RPC only rejects dates before planting, not future dates. [supabase/migrations/0022_harvest.sql:136](C:\FarmRx\supabase\migrations\0022_harvest.sql:136)

**Farmer failure:** A typo such as `2036-10-12` is accepted and can make yield history and seasonal reporting appear to contain a future harvest.

**Suggested fix:** Add a field-local/current-date maximum in the form, client validator, and SQL RPC, matching the one-day-tolerance pattern used by Field Log and Scouting.

### P2 — Scouting photo objects can be orphaned after uncertain upload/save/delete outcomes

Photo bytes are uploaded before the note RPC records metadata. [src/data/scoutingStorage.ts:7](C:\FarmRx\src\data\scoutingStorage.ts:7) [src/ScoutingModule.tsx:27](C:\FarmRx\src\ScoutingModule.tsx:27) If an upload commits but its response is lost, the code only records paths after the awaited upload resolves, so it cannot clean up the ambiguous current object. [src/data/scoutingStorage.ts:8](C:\FarmRx\src\data\scoutingStorage.ts:8) Deleting a note first deletes the metadata row, then separately removes the storage object from the browser. [src/data/QueuedScoutingRepository.ts:20](C:\FarmRx\src\data\QueuedScoutingRepository.ts:20) [src/data/QueuedScoutingRepository.ts:23](C:\FarmRx\src\data\QueuedScoutingRepository.ts:23)

The bucket is private and farm-scoped, so this is not cross-farm photo exposure: the bucket is non-public and reads require `can_access_farm`. [supabase/migrations/0020_scouting.sql:129](C:\FarmRx\supabase\migrations\0020_scouting.sql:129) [supabase/migrations/0020_scouting.sql:133](C:\FarmRx\supabase\migrations\0020_scouting.sql:133)

**Farmer failure:** A weak connection or closed tab after an upload/delete can leave unlisted phone photos in Storage, consuming quota and retaining data longer than the farmer expects.

**Suggested fix:** Create a durable deletion/upload-cleanup outbox before changing metadata, retry it on startup, and add an authenticated server-side reconciliation job that removes old storage objects with no `scouting_photos` row.

### P2 — Offline deletes are queued but immediately shown as failed in Field Log and Scouting

Field Log queues an offline delete and returns successfully to the caller. [src/data/QueuedFieldLogRepository.ts:34](C:\FarmRx\src\data\QueuedFieldLogRepository.ts:34) The UI then forces a live reload; offline reload failure is caught as a delete error. [src/FieldLogModule.tsx:25](C:\FarmRx\src\FieldLogModule.tsx:25) Scouting has the same sequence: it queues deletion, then reload failure is displayed as an error. [src/data/QueuedScoutingRepository.ts:31](C:\FarmRx\src\data\QueuedScoutingRepository.ts:31) [src/ScoutingModule.tsx:30](C:\FarmRx\src\ScoutingModule.tsx:30)

**Farmer failure:** In a field without signal, the farmer deletes a mistaken rain entry or scouting note, sees an error, and may repeat the action. The deletion is actually waiting to sync, but the screen does not truthfully show that state.

**Suggested fix:** Return a typed pending receipt for deletes, optimistically remove/tombstone the row locally, and show “Deleted on this device — waiting for signal” instead of forcing an offline reload.

### P2 — Field Log and Scouting future-date limits use UTC, not the farmer/field calendar day

Both modules calculate their allowed maximum from UTC midnight plus one day. [src/data/fieldLog.ts:42](C:\FarmRx\src\data\fieldLog.ts:42) [src/data/scouting.ts:13](C:\FarmRx\src\data\scouting.ts:13) Late in a U.S. evening, UTC may already be tomorrow, allowing entries two local calendar days ahead. Their forms consume those UTC-derived limits. [src/FieldLogModule.tsx:32](C:\FarmRx\src\FieldLogModule.tsx:32) [src/ScoutingModule.tsx:39](C:\FarmRx\src\ScoutingModule.tsx:39)

**Farmer failure:** At 8 PM Central, a user can accidentally file tomorrow-plus-one observations while the UI treats them as within the allowed one-day tolerance.

**Suggested fix:** Define a farm time zone and calculate “today” and the allowed future day in that zone in both browser and SQL policy/RPC checks.

## Verified-good behavior

- **Units are internally consistent.** Weather explicitly requests Fahrenheit, mph, and inches; types and UI labels use those same units. [src/data/weatherService.ts:68](C:\FarmRx\src\data\weatherService.ts:68) [src/data/weather.ts:3](C:\FarmRx\src\data\weather.ts:3) [src/data/weather.ts:7](C:\FarmRx\src\data\weather.ts:7) Field Log stores rainfall in inches, and Harvest renders bushels per planted acre. [src/data/fieldLog.ts:10](C:\FarmRx\src\data\fieldLog.ts:10) [src/HarvestModule.tsx:36](C:\FarmRx\src\HarvestModule.tsx:36)

- **Spray thresholds match the documented generic guidance.** Wind bands, rain probability, four-hour rain look-ahead, and the `>85°F` caution are implemented as specified. [src/data/weatherService.ts:89](C:\FarmRx\src\data\weatherService.ts:89) [src/data/weatherService.ts:99](C:\FarmRx\src\data\weatherService.ts:99)

- **No-cache weather failure fails closed.** If no usable cache exists, the service throws rather than inventing conditions. [src/data/weatherService.ts:69](C:\FarmRx\src\data\weatherService.ts:69) GDD similarly refuses incomplete history and communicates the last covered date or stale status. [src/data/weatherService.ts:79](C:\FarmRx\src\data\weatherService.ts:79) [src/FieldLogModule.tsx:42](C:\FarmRx\src\FieldLogModule.tsx:42)

- **Harvest writes are farm-scoped, role-gated, idempotent, and preserve estimates.** The RPC checks edit permission and crop ownership, serializes duplicate operations through receipts, and updates only harvest-specific columns. [supabase/migrations/0022_harvest.sql:49](C:\FarmRx\supabase\migrations\0022_harvest.sql:49) [supabase/migrations/0022_harvest.sql:57](C:\FarmRx\supabase\migrations\0022_harvest.sql:57) [supabase/migrations/0022_harvest.sql:126](C:\FarmRx\supabase\migrations\0022_harvest.sql:126) [supabase/migrations/0022_harvest.sql:146](C:\FarmRx\supabase\migrations\0022_harvest.sql:146)

- **Field Log protects farm ownership, entry shape, and replay safety.** The composite field/farm foreign key, type-specific rainfall/note check, permission gate, and receipt-based operation lock are present. [supabase/migrations/0019_field_log.sql:32](C:\FarmRx\supabase\migrations\0019_field_log.sql:32) [supabase/migrations/0019_field_log.sql:36](C:\FarmRx\supabase\migrations\0019_field_log.sql:36) [supabase/migrations/0019_field_log.sql:122](C:\FarmRx\supabase\migrations\0019_field_log.sql:122) [supabase/migrations/0019_field_log.sql:130](C:\FarmRx\supabase\migrations\0019_field_log.sql:130)

- **Scouting photos are private, validated, farm-scoped, and server-limited.** Photo metadata is tied to the note and farm with a cascading foreign key. [supabase/migrations/0020_scouting.sql:43](C:\FarmRx\supabase\migrations\0020_scouting.sql:43) [supabase/migrations/0020_scouting.sql:51](C:\FarmRx\supabase\migrations\0020_scouting.sql:51) Save-path validation requires the expected farm/field/note path prefix. [supabase/migrations/0020_scouting.sql:368](C:\FarmRx\supabase\migrations\0020_scouting.sql:368) Migration 0021 enforces a 20 MB limit and explicit image MIME allowlist server-side. [supabase/migrations/0021_scouting_bucket_limits.sql:5](C:\FarmRx\supabase\migrations\0021_scouting_bucket_limits.sql:5)

- **Photo-bearing scouting entries do not pretend to work offline.** The UI either uploads with a connection or queues text-only notes and tells the farmer that photos must be added later. [src/ScoutingModule.tsx:27](C:\FarmRx\src\ScoutingModule.tsx:27) [src/data/QueuedScoutingRepository.ts:30](C:\FarmRx\src\data\QueuedScoutingRepository.ts:30)

- **Bins reconcile their own baseline inventory and immutable ledger movements correctly, including a visible warning for negative raw balance or mixed commodities.** [src/data/binLedger.ts:30](C:\FarmRx\src\data\binLedger.ts:30) [src/data/binLedger.ts:37](C:\FarmRx\src\data\binLedger.ts:37) [src/GrainModule.tsx:228](C:\FarmRx\src\GrainModule.tsx:228) The database makes ledger movements append-only. [supabase/migrations/0029_bin_upgrades.sql:55](C:\FarmRx\supabase\migrations\0029_bin_upgrades.sql:55)

No additional real issues were found in the reviewed unit conversions, field/farm ownership checks, role gates, receipt-based create/edit replay, GDD continuity checks, or bin-ledger arithmetic.