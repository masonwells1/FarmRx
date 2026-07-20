import assert from 'node:assert/strict'
import { isTrustedSupabaseConfig, resolveSupabaseConfig, type SupabaseConfigEnvironment } from './supabaseConfig'

const production = {
  mode: 'production',
  projectRef: 'agvsozfbstpekuqxpqjr',
  url: 'https://agvsozfbstpekuqxpqjr.supabase.co',
  publishableKey: 'sb_publishable_NonG7JNpCB3jqHwEq4xhLg_hY7fAwnM',
} as const
const local = {
  VITE_LOCAL_SUPABASE_PROJECT_REF: 'farmrx-farmer-simplicity-2027-local',
  VITE_LOCAL_SUPABASE_URL: 'http://127.0.0.1:55321',
  VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1234567890_ABCDEFGHIJ',
} as const

assert.deepEqual(resolveSupabaseConfig(false), production, 'Production default drifted.')
assert.deepEqual(resolveSupabaseConfig(true), production, 'Development without an explicit override stopped using production.')
assert.equal(Object.isFrozen(resolveSupabaseConfig(false)), true, 'Production configuration is mutable.')

const resolvedLocal = resolveSupabaseConfig(true, local)
assert.deepEqual(resolvedLocal, {
  mode: 'local',
  projectRef: local.VITE_LOCAL_SUPABASE_PROJECT_REF,
  url: local.VITE_LOCAL_SUPABASE_URL,
  publishableKey: local.VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY,
})
assert.equal(Object.isFrozen(resolvedLocal), true, 'Local configuration is mutable.')
assert.equal(isTrustedSupabaseConfig(resolvedLocal), true, 'Validated loopback configuration was not trusted by the client fence.')

function rejected(environment: SupabaseConfigEnvironment, message: string): void {
  assert.throws(() => resolveSupabaseConfig(true, environment), message)
}

rejected({ VITE_LOCAL_SUPABASE_URL: local.VITE_LOCAL_SUPABASE_URL }, 'A partial local override was accepted.')
rejected({ ...local, VITE_LOCAL_SUPABASE_URL: 'http://192.168.1.20:54321' }, 'A LAN hostname was accepted.')
rejected({ ...local, VITE_LOCAL_SUPABASE_URL: 'https://127.0.0.1:55321' }, 'An HTTPS local override was accepted.')
rejected({ ...local, VITE_LOCAL_SUPABASE_URL: 'http://localhost.example.com:55321' }, 'A loopback-looking remote hostname was accepted.')
rejected({ ...local, VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_1234567890_ABCDEFGHIJ' }, 'A secret key was accepted.')
rejected({ ...local, VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY: 'service_role_1234567890_ABCDEFGHIJ' }, 'A service-role key was accepted.')

const serviceRolePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')
rejected({ ...local, VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY: `eyJhbGciOiJIUzI1NiJ9.${serviceRolePayload}.signature` }, 'A legacy service-role JWT was accepted.')

const anonPayload = Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')
const legacyAnon = resolveSupabaseConfig(true, {
  ...local,
  VITE_LOCAL_SUPABASE_URL: 'http://localhost:55321',
  VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY: `eyJhbGciOiJIUzI1NiJ9.${anonPayload}.signature`,
})
assert.equal(legacyAnon.mode, 'local', 'A legacy browser-safe anon key was rejected.')

// Production deliberately ignores even complete or partial override input so
// build-time environment contamination cannot redirect the released browser.
assert.deepEqual(resolveSupabaseConfig(false, {
  ...local,
  VITE_LOCAL_SUPABASE_URL: 'https://attacker.example',
  VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do_not_use',
}), production, 'Production honored a local override.')
assert.deepEqual(resolveSupabaseConfig(false, {
  VITE_LOCAL_SUPABASE_URL: local.VITE_LOCAL_SUPABASE_URL,
}), production, 'Production failed on a partial override instead of staying pinned.')

assert.equal(isTrustedSupabaseConfig({ ...production, url: 'https://example.com' }), false, 'Production client fence trusted a remote URL.')
assert.equal(isTrustedSupabaseConfig({ ...resolvedLocal, url: 'http://example.com' }), false, 'Local client fence trusted a remote URL.')

console.log('Supabase configuration regressions passed.')
