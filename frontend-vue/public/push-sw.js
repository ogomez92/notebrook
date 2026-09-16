/*
 * Push notification handlers for the service worker.
 *
 * Pulled into the Workbox-generated worker through `importScripts` (see
 * vite.config.ts), so precaching keeps working untouched. The payload shape is
 * produced by backend/src/services/push/webpush-provider.ts:
 *   { title, body, tag?, data: { kind, channelId?, messageId? } }
 */

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Notebrook'
  const options = {
    body: payload.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: payload.data || {}
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const channelId = event.notification.data && event.notification.data.channelId
  const targetUrl = channelId ? `/?channel=${channelId}` : '/'

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => 'focus' in client)
    if (existing) {
      await existing.focus()
      if (channelId) {
        // MainView listens for this and switches channel without a reload.
        existing.postMessage({ type: 'open-channel', channelId })
      }
      return
    }
    await self.clients.openWindow(targetUrl)
  })())
})
