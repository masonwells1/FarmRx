// Provision one Farm Rx owner account and send its first-password email.
// The service-role key is read from the environment and never printed.
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { pathToFileURL } from 'node:url'
import { provisionCustomer } from './provision-customer-lib.mjs'

export function commandMode(args) {
  if (args.length === 0) return 'create'
  if (args.length === 1 && args[0] === '--resend-setup') return 'resend'
  throw new Error('Customer email addresses are entered only at the secure prompt. Run with no arguments, or with --resend-setup only.')
}

export async function readCustomerEmail() {
  const terminal = createInterface({ input: stdin, output: stdout })
  try {
    return await terminal.question('Customer owner email: ')
  } finally {
    terminal.close()
  }
}

export async function runProvisionCustomerCli(
  args = process.argv.slice(2),
  environment = process.env,
  output = console,
  { provision = provisionCustomer, readEmail = readCustomerEmail } = {},
) {
  // Parse all command-line input before prompting or touching Auth. A customer email must never
  // travel through the shell command line, shell history, or a copied terminal command.
  const mode = commandMode(args)
  const email = await readEmail()
  const result = await provision({
    mode,
    email,
    serviceKey: environment.SUPABASE_SERVICE_ROLE_KEY ?? '',
    emailDeliveryReady: environment.FARM_RX_AUTH_EMAIL_DELIVERY_READY === 'true',
  })

  output.log('\n=== Farm Rx owner setup email sent ===')
  output.log('Email:             ', result.email)
  output.log('User id:           ', result.userId)
  output.log('initial_farm_owner:', result.initialFarmOwner)
  output.log('Next: the farmer opens the newest email and chooses their first password. No password is relayed by Crop RX.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProvisionCustomerCli().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Farm Rx could not provision this customer.')
    process.exitCode = 1
  })
}
