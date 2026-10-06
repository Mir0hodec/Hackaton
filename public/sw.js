const CACHE = 'naryadai-team-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.filter((k) => k.startsWith('naryadai-') && k !== CACHE).map((k) => caches.delete(k)),
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
  const order = event.notification.data?.order;
  const url = order ? '/?order=' + encodeURIComponent(order) : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients[0];
      if (!client) return self.clients.openWindow(url);
      if (order) client.postMessage({ type: 'open-order', order });
      return client.focus();
    }),
  );
});

// Push приходит пустым: персональные и производственные данные не передаются push-службе.
// Текст уведомления service worker получает с нашего сервера по сессии пользователя.
const fallback = () =>
  self.registration.showNotification('НарядAI · обновление смены', {
    body: 'Новый наряд или изменение статуса. Откройте приложение, чтобы посмотреть подробности.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'naryadai-update',
    renotify: true,
    data: { url: '/' },
  });

self.addEventListener('push', (event) => {
  event.waitUntil(
    fetch('/api/service?view=notifications', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(async ({ items }) => {
        const fresh = (items || []).filter((a) => Date.now() - Date.parse(a.created) < 5 * 60000).slice(0, 3);
        if (!fresh.length) return fallback();
        for (const a of fresh.reverse()) {
          await self.registration.showNotification((a.emergency ? '🔴 ' : '') + a.title, {
            body: a.text,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: a.id,
            requireInteraction: !!a.emergency,
            vibrate: a.emergency ? [400, 150, 400, 150, 800] : [200],
            silent: false,
            data: { order: a.order || null },
          });
        }
      })
      .catch(fallback),
  );
});
