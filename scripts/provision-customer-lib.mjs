import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const farmRxSupabaseUrl = 'https://agvsozfbstpekuqxpqjr.supabase.co'
export const firstPasswordRedirectTo = 'https://farm-rx.vercel.app/update-password'

function normalizedEmail(value) {
  const email = value.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Pass a valid customer email address.')
  return email
}

function ownerResult(user, mode) {
  return {
    mode,
    email: user.email,
    userId: user.id,
    initialFarmOwner: user.app_metadata?.initial_farm_owner === true,
  }
}

async function findExistingOwner(admin, email) {
  const matches = []
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw new Error(`Farm Rx could not verify the existing account: ${error.message}`)
    matches.push(...data.users.filter((user) => user.email?.trim().toLowerCase() === email))
    if (!data.nextPage) break
    page = data.nextPage
  }
  if (matches.length !== 1) throw new Error(matches.length ? 'Farm Rx found more than one matching account. Stop and review Auth users.' : 'Farm Rx could not find that existing account.')
  const user = matches[0]
  if (user.app_metadata?.initial_farm_owner !== true) throw new Error('That account is not an approved initial farm owner. Setup email was not sent.')
  return user
}

async function sendFirstPasswordEmail(admin, email, accountWasCreated) {
  const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: firstPasswordRedirectTo })
  if (!error) return
  const remediation = accountWasCreated
    ? 'The account was created, but its first-password email could not be sent. Fix Auth email delivery, then rerun provisioning with --resend-setup and enter the same email at the prompt.'
    : 'Farm Rx verified the owner account, but could not resend its setup email. Fix Auth email delivery and retry --resend-setup, entering the same email at the prompt.'
  throw new Error(`${remediation} (${error.message})`)
}

export async function provisionCustomer({
  email: emailInput,
  mode = 'create',
  serviceKey,
  emailDeliveryReady = false,
  createClientImpl = createClient,
  createSecret = () => `${randomBytes(32).toString('base64url')}Aa1!`,
}) {
  if (!serviceKey) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY for this terminal session first.')
  if (!emailDeliveryReady) throw new Error('Farm Rx Auth email delivery is not release-ready. Prove custom SMTP, then set FARM_RX_AUTH_EMAIL_DELIVERY_READY=true for this terminal session.')
  if (mode !== 'create' && mode !== 'resend') throw new Error('Provisioning mode must be create or resend.')
  const email = normalizedEmail(emailInput)
  const admin = createClientImpl(farmRxSupabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  if (mode === 'resend') {
    const user = await findExistingOwner(admin, email)
    await sendFirstPasswordEmail(admin, email, false)
    return ownerResult(user, mode)
  }

  // The bootstrap secret makes the Auth row valid but is never returned,
  // logged, emailed, or relayed. The farmer chooses the only known password
  // through the narrow recovery capability sent immediately below.
  const bootstrapSecret = createSecret()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: bootstrapSecret,
    email_confirm: true,
    app_metadata: { initial_farm_owner: true },
  })
  if (error || !data.user) throw new Error(`Farm Rx could not create this owner account: ${error?.message ?? 'No user was returned.'}`)
  await sendFirstPasswordEmail(admin, email, true)
  return ownerResult(data.user, mode)
}
