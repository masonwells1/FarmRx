export const moduleBackends = Object.freeze({
  fields: 'supabase',
  grain: 'mock',
  profitability: 'mock',
} as const satisfies {
  fields: 'supabase'
  grain: 'mock' | 'supabase'
  profitability: 'mock' | 'supabase'
})
