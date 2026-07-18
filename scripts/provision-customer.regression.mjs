import { firstPasswordRedirectTo, provisionCustomer } from './provision-customer-lib.mjs'
import { runProvisionCustomerCli } from './provision-customer.mjs'

function assert(value, message) { if (!value) throw new Error(message) }

const email = 'owner@example.test'
const user = { id: '00000000-0000-4000-8000-000000000001', email, app_metadata: { initial_farm_owner: true } }
let createdInput = null
let resetInput = null
let listCalls = 0
let resetError = null
const client = {
  auth: {
    admin: {
      async createUser(input) { createdInput = input; return { data: { user }, error: null } },
      async listUsers({ page }) { listCalls += 1; return page === 1 ? { data: { users: [], nextPage: 2 }, error: null } : { data: { users: [user], nextPage: null }, error: null } },
    },
    async resetPasswordForEmail(target, options) { resetInput = { target, options }; return { data: {}, error: resetError } },
  },
}
const createClientImpl = () => client
const bootstrapSecret = 'fixture-bootstrap-secret-that-must-never-escape-Aa1!'

const created = await provisionCustomer({ email: ' OWNER@example.test ', serviceKey: 'fixture-service-key', emailDeliveryReady: true, createClientImpl, createSecret: () => bootstrapSecret })
assert(created.mode === 'create' && created.email === email && created.initialFarmOwner, 'Create mode did not return the approved owner identity.')
assert(createdInput?.password === bootstrapSecret && createdInput?.email_confirm === true && createdInput?.app_metadata?.initial_farm_owner === true, 'Create mode did not create the exact confirmed owner account.')
assert(resetInput?.target === email && resetInput?.options?.redirectTo === firstPasswordRedirectTo, 'Create mode did not send the exact first-password recovery route.')
assert(!Object.hasOwn(created, 'password') && !JSON.stringify(created).includes(bootstrapSecret), 'Create mode exposed the unknowable bootstrap secret.')

createdInput = null; resetInput = null
const resent = await provisionCustomer({ mode: 'resend', email, serviceKey: 'fixture-service-key', emailDeliveryReady: true, createClientImpl })
assert(resent.mode === 'resend' && listCalls === 2 && createdInput === null, 'Resend mode recreated or failed to validate the existing account.')
assert(resetInput?.target === email && resetInput?.options?.redirectTo === firstPasswordRedirectTo, 'Resend mode did not send the exact first-password route.')

resetError = new Error('SMTP unavailable')
let partialFailure = null
try { await provisionCustomer({ email, serviceKey: 'fixture-service-key', emailDeliveryReady: true, createClientImpl, createSecret: () => bootstrapSecret }) } catch (error) { partialFailure = error }
assert(partialFailure instanceof Error && partialFailure.message.includes('--resend-setup') && !partialFailure.message.includes(email), 'Partial create success did not provide a non-executable resend recovery path.')
assert(!partialFailure.message.includes(bootstrapSecret), 'Partial create failure exposed the bootstrap secret.')

const metacharacterEmail = 'owner;echo-owned@example.test'
let metacharacterFailure = null
try { await provisionCustomer({ email: metacharacterEmail, serviceKey: 'fixture-service-key', emailDeliveryReady: true, createClientImpl, createSecret: () => bootstrapSecret }) } catch (error) { metacharacterFailure = error }
assert(metacharacterFailure instanceof Error && !metacharacterFailure.message.includes(metacharacterEmail) && !metacharacterFailure.message.includes('node scripts/'), 'A mail failure rendered untrusted email as a paste-ready shell command.')

const unapprovedClient = () => ({ auth: { admin: { async listUsers() { return { data: { users: [{ ...user, app_metadata: {} }], nextPage: null }, error: null } } }, async resetPasswordForEmail() { throw new Error('must not send') } } })
let unapprovedRejected = false
try { await provisionCustomer({ mode: 'resend', email, serviceKey: 'fixture-service-key', emailDeliveryReady: true, createClientImpl: unapprovedClient }) } catch (error) { unapprovedRejected = error instanceof Error && /not an approved initial farm owner/.test(error.message) }
assert(unapprovedRejected, 'Resend mode sent setup mail to an account without the initial-owner authorization flag.')

let gateRejected = false
try { await provisionCustomer({ email, serviceKey: 'fixture-service-key', createClientImpl }) } catch (error) { gateRejected = error instanceof Error && /email delivery is not release-ready/.test(error.message) }
assert(gateRejected, 'Provisioning could create an owner before custom SMTP readiness was explicitly enabled.')

const cliEnvironment = {
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
  FARM_RX_AUTH_EMAIL_DELIVERY_READY: 'true',
}
const cliOutput = { log() { throw new Error('CLI wrote output before a rejected command could be stopped.') } }
const maliciousArgument = 'owner;echo-owned@example.test'
let promptCalls = 0
let cliProvisionCalls = 0
let shellArgumentRejected = false
try {
  await runProvisionCustomerCli(
    [maliciousArgument],
    cliEnvironment,
    cliOutput,
    {
      async readEmail() { promptCalls += 1; return email },
      async provision() { cliProvisionCalls += 1; return created },
    },
  )
} catch (error) {
  shellArgumentRejected = error instanceof Error && !error.message.includes(maliciousArgument) && /secure prompt/.test(error.message)
}
assert(shellArgumentRejected && promptCalls === 0 && cliProvisionCalls === 0, 'CLI accepted or rendered an untrusted positional email before the secure prompt.')

const cliRecords = []
const cliLogger = { log(...parts) { cliRecords.push(parts.join(' ')) } }
let promptedEmail = null
let cliInput = null
await runProvisionCustomerCli(
  [],
  cliEnvironment,
  cliLogger,
  {
    async readEmail() { promptedEmail = email; return email },
    async provision(input) { cliInput = input; return created },
  },
)
assert(promptedEmail === email && cliInput?.mode === 'create' && cliInput?.email === email, 'No-argument create mode did not pass prompted email data to provisioning.')

cliInput = null
await runProvisionCustomerCli(
  ['--resend-setup'],
  cliEnvironment,
  cliLogger,
  {
    async readEmail() { return email },
    async provision(input) { cliInput = input; return resent },
  },
)
assert(cliInput?.mode === 'resend' && cliInput?.email === email && cliRecords.length > 0, 'Resend mode did not use the secure email prompt.')

console.log('Customer provisioning regressions passed (unshared bootstrap secret, exact first-password email, owner-only resend, truthful partial success, and prompt-only CLI email input).')
