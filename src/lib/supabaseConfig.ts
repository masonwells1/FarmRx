/**
 * PUBLIC browser client credentials. These values ship to every Farm Rx user.
 * RLS protects the data. Secrets and service-role keys never belong here or
 * anywhere else in this repository.
 */
export const supabaseConfig = Object.freeze({
  projectRef: 'agvsozfbstpekuqxpqjr',
  url: 'https://agvsozfbstpekuqxpqjr.supabase.co',
  publishableKey: 'sb_publishable_NonG7JNpCB3jqHwEq4xhLg_hY7fAwnM',
} as const)
