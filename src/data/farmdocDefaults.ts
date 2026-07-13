import type { CostCategory } from './profitability'

/**
 * University of Illinois farmdoc 2026 Illinois crop budgets (May 2026 revision),
 * central Illinois HIGH-productivity, corn-after-soybeans / soybeans-after-corn.
 * Source: farmdocdaily.illinois.edu "2026 Illinois Crop Budgets" — see
 * docs/profitability-research-2026-07.md §4-5. These are labeled STARTING values;
 * every line is meant to be overwritten by the farmer's own number.
 * Refresh annually (farmdoc revises Aug / Jan / May).
 */
export const FARMDOC_SOURCE_NOTE = 'U of I farmdoc 2026 budget — central Illinois, high productivity. Replace any number with your own.'

export type FarmdocCropKind = 'corn' | 'soybeans'
export function farmdocCropKind(commodityName: string): FarmdocCropKind | null {
  if (/bean|soy/i.test(commodityName)) return 'soybeans'
  if (/corn/i.test(commodityName)) return 'corn'
  return null
}

export type FarmdocLine = { name: string; category: CostCategory; amount_per_acre: number }

const CORN_LINES: FarmdocLine[] = [
  { name: 'Fertilizers', category: 'fertilizer', amount_per_acre: 229 },
  { name: 'Pesticides', category: 'chemical', amount_per_acre: 116 },
  { name: 'Seed', category: 'seed', amount_per_acre: 129 },
  { name: 'Drying', category: 'custom', amount_per_acre: 15 },
  { name: 'Storage', category: 'custom', amount_per_acre: 14 },
  { name: 'Crop insurance', category: 'crop_insurance', amount_per_acre: 31 },
  { name: 'Machine hire / lease', category: 'custom', amount_per_acre: 20 },
  { name: 'Utilities', category: 'custom', amount_per_acre: 6 },
  { name: 'Machine repair', category: 'repairs', amount_per_acre: 38 },
  { name: 'Fuel and oil', category: 'fuel', amount_per_acre: 26 },
  { name: 'Light vehicle', category: 'custom', amount_per_acre: 2 },
  { name: 'Machinery depreciation', category: 'equipment_depreciation', amount_per_acre: 89 },
  { name: 'Hired labor', category: 'labor', amount_per_acre: 28 },
  { name: 'Building repair and rent', category: 'custom', amount_per_acre: 6 },
  { name: 'Building depreciation', category: 'custom', amount_per_acre: 17 },
  { name: 'Farm insurance', category: 'custom', amount_per_acre: 16 },
  { name: 'Miscellaneous', category: 'custom', amount_per_acre: 12 },
  { name: 'Interest (non-land)', category: 'interest', amount_per_acre: 39 },
  { name: 'Land (central IL cash rent)', category: 'land', amount_per_acre: 321 },
]

const SOYBEAN_LINES: FarmdocLine[] = [
  { name: 'Fertilizers', category: 'fertilizer', amount_per_acre: 66 },
  { name: 'Pesticides', category: 'chemical', amount_per_acre: 70 },
  { name: 'Seed', category: 'seed', amount_per_acre: 83 },
  { name: 'Storage', category: 'custom', amount_per_acre: 8 },
  { name: 'Crop insurance', category: 'crop_insurance', amount_per_acre: 11 },
  { name: 'Machine hire / lease', category: 'custom', amount_per_acre: 19 },
  { name: 'Utilities', category: 'custom', amount_per_acre: 5 },
  { name: 'Machine repair', category: 'repairs', amount_per_acre: 35 },
  { name: 'Fuel and oil', category: 'fuel', amount_per_acre: 22 },
  { name: 'Light vehicle', category: 'custom', amount_per_acre: 2 },
  { name: 'Machinery depreciation', category: 'equipment_depreciation', amount_per_acre: 77 },
  { name: 'Hired labor', category: 'labor', amount_per_acre: 25 },
  { name: 'Building repair and rent', category: 'custom', amount_per_acre: 12 },
  { name: 'Building depreciation', category: 'custom', amount_per_acre: 16 },
  { name: 'Farm insurance', category: 'custom', amount_per_acre: 15 },
  { name: 'Miscellaneous', category: 'custom', amount_per_acre: 12 },
  { name: 'Interest (non-land)', category: 'interest', amount_per_acre: 33 },
  { name: 'Land (central IL cash rent)', category: 'land', amount_per_acre: 321 },
]

export const FARMDOC_2026 = {
  corn: { expected_yield_per_acre: 241, expected_price_per_bushel: 4.5, lines: CORN_LINES },
  soybeans: { expected_yield_per_acre: 76, expected_price_per_bushel: 11.5, lines: SOYBEAN_LINES },
} as const satisfies Record<FarmdocCropKind, { expected_yield_per_acre: number; expected_price_per_bushel: number; lines: FarmdocLine[] }>

/** Typical $/ac for a category (corn budget), quoted by the "what am I forgetting?" coach. */
export function farmdocTypicalLine(kind: FarmdocCropKind, category: CostCategory) {
  return FARMDOC_2026[kind].lines.find((line) => line.category === category) ?? null
}
