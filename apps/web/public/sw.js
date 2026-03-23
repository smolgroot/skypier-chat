const SKYPIER_CACHE = 'skypier-app-v1';
const SKYPIER_APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
];

function isCacheableGetRequest(request) {
  if (request.method !== 'GET') {
    return false;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return false;
  }

  if (url.pathname.startsWith('/api/')) {
    return false;
  }

  return true;
}

async function addCoreShellToCache() {
  const cache = await caches.open(SKYPIER_CACHE);
  await Promise.all(
    SKYPIER_APP_SHELL_URLS.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch {
        // Continue on best-effort cache fill.
      }
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await addCoreShellToCache();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('skypier-app-') && key !== SKYPIER_CACHE)
        .map((key) => caches.delete(key)),
    );

    await self.clients.claim();
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'SKYPIER_RECOVER_CONNECTIVITY', source: 'sw-activate' });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (!isCacheableGetRequest(request)) {
    return;
  }

  const isNavigation = request.mode === 'navigate';

  event.respondWith((async () => {
    const cache = await caches.open(SKYPIER_CACHE);

    if (isNavigation) {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          await cache.put('/index.html', networkResponse.clone());
        }
        return networkResponse;
      } catch {
        const cachedPage = await cache.match('/index.html') || await cache.match('/');
        if (cachedPage) {
          return cachedPage;
        }
        return new Response('Offline and no cached app shell is available yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    }

    const cached = await cache.match(request);
    if (cached) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok) {
            await cache.put(request, fresh.clone());
          }
        } catch {
          // Keep serving stale cache while offline.
        }
      })());
      return cached;
    }

    try {
      const networkResponse = await fetch(request);
      if (networkResponse && networkResponse.ok) {
        await cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      const fallback = await cache.match('/index.html');
      if (fallback && request.destination === 'document') {
        return fallback;
      }
      throw new Error('Network unavailable and resource not cached.');
    }
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data ?? {};
  if (data.type === 'SKYPIER_REQUEST_RECOVERY') {
    event.source?.postMessage({ type: 'SKYPIER_RECOVER_CONNECTIVITY', source: 'sw-message' });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    const existing = allClients[0];
    if (existing) {
      existing.focus();
      existing.postMessage({ type: 'SKYPIER_RECOVER_CONNECTIVITY', source: 'notification-click' });
      return;
    }

    const created = await self.clients.openWindow('/');
    created?.postMessage({ type: 'SKYPIER_RECOVER_CONNECTIVITY', source: 'notification-click' });
  })());
});
