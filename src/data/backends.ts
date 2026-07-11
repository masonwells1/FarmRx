export const moduleBackends = Object.freeze({
  fields: 'supabase',
  grain: 'mock',
} as const satisfies {
  fields: 'supabase'
  grain: 'mock' | 'supabase'
})
