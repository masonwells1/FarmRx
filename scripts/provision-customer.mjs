// Provision one Farm Rx customer. Run by Claude from Mason's machine only.
// The service-role key is a SECRET: it is read from the environment, never
// committed, and never shipped to the app. Usage:
//   node scripts/provision-customer.mjs farmer@email.com
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = 'https://agvsozfbstpekuqxpqjr.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const email = (process.argv[2] || '').trim().toLowerCase()

if (!serviceKey) { console.error('Set SUPABASE_SERVICE_ROLE_KEY first.'); process.exit(1) }
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Pass a valid email.'); process.exit(1) }

// Strong, human-typeable one-time password.
const password = randomBytes(9).toString('base64url') + 'A9!'

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,                       // no confirmation email needed; they can sign in now
  app_metadata: { initial_farm_owner: true } // the flag that unlocks the "Set up your farm" screen
})

if (error) {
  // Most common: the email already has an account.
  console.error('Could not create user:', error.message)
  process.exit(1)
}

console.log('\n=== Farm Rx account created ===')
console.log('Email:            ', email)
console.log('Starting password:', password)
console.log('User id:          ', data.user.id)
console.log('initial_farm_owner:', data.user.app_metadata?.initial_farm_owner === true)
console.log('\nRelay the email + starting password to the farmer by phone/text (do not email the password).')
