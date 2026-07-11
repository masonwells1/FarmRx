export const moduleBackends = Object.freeze({
  fields: 'supabase',
  grain: 'supabase',
  inventory: 'mock',
  profitability: 'mock',
} as const satisfies {
  fields: 'supabase'
  grain: 'mock' | 'supabase'
  inventory: 'mock' | 'supabase'
  profitability: 'mock' | 'supabase'
})
