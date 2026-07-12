# Weather inventory label-limit finding

## Decision

The current inventory schema does **not** store product-specific environmental
label limits that the Weather + Spray feature can evaluate. Feature A should
therefore omit the optional **Check against a product** picker in v1 and ship
the product-agnostic good-practice light. Product-specific refinement must wait
for a future migration that models label limits explicitly.

Sources inspected: `supabase/migrations/0010_module3_inventory.sql`,
`supabase/migrations/0011_module3_rls.sql`, and `src/data/inventory.ts`.

## Requested environmental limits

| Environmental limit | Exact product/label storage |
| --- | --- |
| Maximum wind speed | Not present. |
| Minimum or maximum application temperature | Not present. |
| Rain-free interval / rainfast hours | Not present. |
| Temperature-inversion restriction | Not present. |
| Drift restriction, buffer, nozzle, droplet-size, or downwind rule | Not present. |

There is no separate product-label table. `0011_module3_rls.sql` adds RLS and
permissions to the `0010` inventory tables but adds no label-limit columns.
The `InventoryProduct` interface in `src/data/inventory.ts` mirrors the catalog
fields below and likewise defines no environmental-limit property.

## Label-related data that does exist

`public.inventory_products` stores regulatory identity, safety, interval, and
rate data, but none of these columns is an environmental spray-window limit.
The exact `0010` definitions are:

```sql
epa_registration_number text
is_restricted_use boolean not null default false
signal_word text
restricted_entry_interval_hours numeric(10, 2)
preharvest_interval_hours numeric(10, 2)
max_label_rate numeric(16, 6)
max_label_rate_unit public.inventory_quantity_unit
max_label_rate_basis public.application_rate_basis
```

`public.application_products` snapshots those same product facts onto a saved
application. Its exact relevant definitions are:

```sql
epa_registration_number_snapshot text
is_restricted_use_snapshot boolean not null
signal_word_snapshot text
restricted_entry_interval_hours_snapshot numeric(10, 2)
preharvest_interval_hours_snapshot numeric(10, 2)
max_label_rate_snapshot numeric(16, 6)
max_label_rate_unit_snapshot public.inventory_quantity_unit
max_label_rate_basis_snapshot public.application_rate_basis
```

`public.application_records` does record weather observed for a particular
application, but these are historical observations, not product limits:

```sql
wind_speed_mph numeric(8, 2)
wind_direction text
temperature_f numeric(8, 2)
relative_humidity_pct numeric(5, 2)
```

Because observed application weather cannot tell the app what a product label
permits, it must not be treated as a substitute for environmental label limits.
