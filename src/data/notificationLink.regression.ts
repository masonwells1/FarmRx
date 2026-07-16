import { strict as assert } from 'node:assert'
import { safeNotificationLink } from './notificationLink'

const origin = 'https://farm-rx.vercel.app'
assert.equal(safeNotificationLink('/weather?field=1#hourly', origin), '/weather?field=1#hourly')
for (const unsafe of ['/\\evil.example', '//evil.example', '/..//evil.example', 'https://evil.example/path', '/\u0000evil', 123, null]) {
  assert.equal(safeNotificationLink(unsafe, origin), '/notifications', `unsafe notification link was accepted: ${String(unsafe)}`)
}
assert.equal(new URL(safeNotificationLink('/%2F%2Fevil.example', origin), origin).origin, origin)
assert.equal(safeNotificationLink('/weather/../grain?crop=corn#contracts', origin), '/grain?crop=corn#contracts')
console.log('Notification link regression passed (canonical same-origin paths only).')
