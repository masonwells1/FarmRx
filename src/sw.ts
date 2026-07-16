/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { safeNotificationLink } from './data/notificationLink'

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> }
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
self.skipWaiting()
clientsClaim()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const notificationText = (value: unknown, maximum: number, fallback = '') => typeof value === 'string' ? value.slice(0, maximum) : fallback

self.addEventListener('push', (event) => {
  let parsed: unknown = {}
  try { parsed = event.data?.json() } catch { parsed = {} }
  const payload = plainObject(parsed) ? parsed : {}
  const title = notificationText(payload.title, 160, 'Farm Rx alert') || 'Farm Rx alert'
  const body = notificationText(payload.body, 500)
  const link = safeNotificationLink(payload.link, self.location.origin)
  const notificationId = notificationText(payload.notification_id, 100)
  const tag = notificationId ? `farm-rx-notification-${notificationId}` : undefined
  event.waitUntil(self.registration.showNotification(title, { body, tag, data: { link, notificationId } }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = safeNotificationLink(event.notification.data?.link, self.location.origin)
  event.waitUntil((async () => { const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); const existing = clients.find((client) => new URL(client.url).origin === self.location.origin); if (existing) { await existing.focus(); if ('navigate' in existing) await existing.navigate(link); return } await self.clients.openWindow(link) })())
})
