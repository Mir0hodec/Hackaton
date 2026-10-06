const CACHE = 'naryadai-team-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.filter((k) => k.startsWith('naryadai-shell-') && k !== CACHE).map((k) => caches.delete(k)),
          ),
        ),
    ]),
  ),
);
self.addEventListener('fetch', (event) => {
  const req = event.request,
    u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate' && ['/', '/demo'].includes(u.pathname)) {
    event.respondWith(
      fetch(req)
        .then(async (r) => {
          if (r.ok && !r.redirected) (await caches.open(CACHE)).put(req, r.clone());
          return r;
        })
        .catch(async () => {
          return (
            (await caches.match(req)) ||
            new Response(
              'Откройте приложение при подключении к интернету, затем оно будет доступно офлайн.',
              { headers: { 'Content-Type': 'text/plain;charset=utf-8' } },
            )
          );
        }),
    );
  } else if (/\.(js|css|png|woff2)$/.test(u.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then(async (r) => {
            if (r.ok) (await caches.open(CACHE)).put(req, r.clone());
            return r;
          }),
      ),
    );
  }
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window' })
      .then((clients) => (clients.length ? clients[0].focus() : self.clients.openWindow('/'))),
  );
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('НарядAI · обновление смены', {
      body: 'Новый наряд или изменение статуса. Откройте приложение, чтобы посмотреть подробности.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'naryadai-update',
      renotify: true,
      data: { url: '/' },
    }),
  );
});
