import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'

const projectRef = 'agvsozfbstpekuqxpqjr'
const userId = '00000000-0000-4000-8000-000000000001'
const farmId = '00000000-0000-4000-8000-000000000010'
const now = '2026-07-18T12:00:00.000Z'
const savedAt = '2026-07-18T12:01:00.000Z'

type Role = 'owner' | 'manager' | 'worker' | 'read_only'

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 86_400
  const payload = Buffer.from(JSON.stringify({ sub: userId, aud: 'authenticated', exp: expiresAt, session_id: `session-${userId}` })).toString('base64url')
  return { access_token: `eyJhbGciOiJub25lIn0.${payload}.signature`, refresh_token: 'privacy-test-refresh', expires_in: 86_400, expires_at: expiresAt, token_type: 'bearer', user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'farmer@example.test', app_metadata: {}, user_metadata: {}, identities: [], created_at: now } }
}

async function seedSession(context: BrowserContext) {
  const value = session()
  await context.addInitScript(({ sessionKey, intentKey, storedSession, intent }) => { localStorage.setItem(sessionKey, JSON.stringify(storedSession)); localStorage.setItem(intentKey, JSON.stringify(intent)) }, {
    sessionKey: `farm-rx-auth:${projectRef}`,
    intentKey: `farm-rx-auth-intent:v1:${projectRef}`,
    storedSession: value,
    intent: { version: 1, nonce: 'privacy-test-session', phase: 'accepted', userId, sessionLineage: `session-${userId}`, startedAtMs: Date.now() },
  })
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
}

async function mockPrivacyFarm(page: Page, role: Role, failSave = false) {
  let shared = false
  let updatedAt = now
  let patchRequests = 0
  const unexpected: string[] = []
  await page.route('https://*.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1]
    const farm = () => ({ id: farmId, name: 'Prairie View', share_with_rep: shared, created_by: userId, created_at: now, updated_at: updatedAt })
    const reject = async (message: string) => { unexpected.push(message); await fulfillJson(route, { message }, 400) }

    if (url.pathname === '/auth/v1/user') return fulfillJson(route, session().user)
    if (url.pathname === '/rest/v1/rpc/get_current_farm_access_epochs') return fulfillJson(route, [{ farm_id: farmId, access_epoch: 1 }])
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const rpc = url.pathname.split('/').at(-1)
      if (rpc === 'program_due_generation_status' || rpc === 'service_due_generation_status') return fulfillJson(route, { has_due: false, task_needed: false, notification_needed: false, local_date: '2026-07-12' })
      if (rpc === 'generate_due_service_tasks_v2' || rpc === 'generate_due_program_items_v2') throw new Error(`False due preflight unexpectedly called ${rpc}`)
      if (rpc === 'generate_due_service_tasks' || rpc === 'generate_due_program_items') throw new Error(`False due preflight unexpectedly called legacy ${rpc}`)
      const canManage = role === 'owner' || role === 'manager'
      const answers: Record<string, boolean> = {
        can_access_farm: true,
        is_active_farm_member: true,
        can_edit_farm: role !== 'read_only',
        can_manage_farm: canManage,
        can_read_private_financials: canManage,
        has_explicit_rep_access: false,
        operational_integrity_capability_probe: true,
      }
      if (Object.hasOwn(answers, rpc ?? '')) return fulfillJson(route, answers[rpc!]!)
      return reject(`unexpected rpc ${rpc}`)
    }
    if (table === 'farms' && request.method() === 'PATCH') {
      patchRequests += 1
      let body: unknown
      try { body = request.postDataJSON() } catch { return reject('privacy body was not JSON') }
      const expectedHeaders = request.headers()['x-farm-rx-access-epochs']
      const exactQuery = url.searchParams.get('id') === `eq.${farmId}` && url.searchParams.get('updated_at') === `eq.${updatedAt}` && url.searchParams.get('select') === '*'
      if (!exactQuery || request.headers()['x-farm-rx-expected-user-id'] !== userId || expectedHeaders !== JSON.stringify({ [farmId]: 1 }) || JSON.stringify(body) !== JSON.stringify({ share_with_rep: true })) return reject('privacy request contract mismatch')
      if (failSave) return fulfillJson(route, { message: 'temporary failure' }, 503)
      shared = true; updatedAt = savedAt
      return fulfillJson(route, farm())
    }
    if (table === 'farms' && request.method() === 'GET') return fulfillJson(route, url.searchParams.has('id') ? farm() : [farm()])
    if (table === 'farm_memberships') return fulfillJson(route, { farm_id: farmId, user_id: userId, role, status: 'active', can_view_financials: role === 'owner' || role === 'manager' })
    if (table === 'farm_rep_access') return fulfillJson(route, null)
    if (table === 'notifications') return fulfillJson(route, [])
    if (table) return fulfillJson(route, [])
    await route.abort('blockedbyclient')
  })
  return { unexpected, patchRequests: () => patchRequests }
}

test.use({ serviceWorkers: 'block' })

test('an owner changes rep sharing only after confirmation and server proof', async ({ context, page }) => {
  await seedSession(context)
  const requests = await mockPrivacyFarm(page, 'owner')
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Farm privacy' })).toBeVisible()
  const sharing = page.getByRole('switch', { name: 'Share my grain position with my Crop RX rep' })
  await expect(sharing).toHaveAttribute('aria-checked', 'false')
  page.once('dialog', (dialog) => { expect(dialog.message()).toContain('private financial information'); void dialog.accept() })
  await sharing.click()
  await expect(page.getByRole('switch', { name: 'Share my grain position with my Crop RX rep' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Shared with your assigned rep')).toBeVisible()
  expect(requests.patchRequests()).toBe(1)
  expect(requests.unexpected).toEqual([])
})

test('a failed response never flips the privacy control optimistically', async ({ context, page }) => {
  await seedSession(context)
  const requests = await mockPrivacyFarm(page, 'owner', true)
  await page.goto('/privacy')
  const sharing = page.getByRole('switch', { name: 'Share my grain position with my Crop RX rep' })
  page.once('dialog', (dialog) => { void dialog.accept() })
  await sharing.click()
  await expect(sharing).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('alert')).toContainText(/could not|try again/i)
  await expect(page.getByRole('button', { name: 'Check current setting' })).toBeVisible()
  expect(requests.patchRequests()).toBe(1)
  expect(requests.unexpected).toEqual([])
})

test('a worker sees the privacy truth but cannot change it', async ({ context, page }) => {
  await seedSession(context)
  const requests = await mockPrivacyFarm(page, 'worker')
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Farm privacy' })).toBeVisible()
  await expect(page.getByText('Only a farm owner or manager can change this setting.')).toBeVisible()
  await expect(page.getByRole('switch')).toHaveCount(0)
  expect(requests.patchRequests()).toBe(0)
  expect(requests.unexpected).toEqual([])
})
