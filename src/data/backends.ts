export const moduleBackends = Object.freeze({
  fields: 'supabase',
  grain: 'supabase',
  inventory: 'supabase',
  profitability: 'supabase',
} as const satisfies {
  fields: 'supabase'
  grain: 'mock' | 'supabase'
  inventory: 'mock' | 'supabase'
  profitability: 'mock' | 'supabase'
})
