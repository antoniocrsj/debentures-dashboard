const CACHE = 'deb-cr-v1'

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['/', '/index.html']))
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  // Não cacheia chamadas de API
  if (e.request.url.includes('/api/')) return

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  )
})
