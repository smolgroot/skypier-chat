const SKYPIER_CACHE = 'skypier-app-v1';
const SKYPIER_CONFIG_CACHE = 'skypier-sw-config-v1';
const SKYPIER_CONFIG_URL = '/__skypier_sw_config__';
const SKYPIER_UNREAD_NOTIFICATION_TAG = 'skypier-unread-check';
const SKYPIER_UNREAD_SYNC_TAG = 'skypier-unread-sync';
const SKYPIER_UNREAD_PERIODIC_SYNC_TAG = 'skypier-unread-periodic';
const SKYPIER_UNREAD_CHECK_DEDUPE_MS = 2 * 60 * 1000;
const SKYPIER_UNREAD_CHECK_TIMEOUT_MS = 8000;
const SKYPIER_APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
];

let unreadEndpointUrl = '';
let unreadToken = '';
let unreadRecipientPeerId = '';
let lastUnreadCount = 0;
let lastUnreadNotificationAt = 0;

// Persist config to CacheStorage so it survives SW restarts (required for
// Periodic Background Sync, which wakes a fresh SW with no in-memory state).
async function saveUnreadConfig() {
  try {
    const cache = await caches.open(SKYPIER_CONFIG_CACHE);
    await cache.put(
      SKYPIER_CONFIG_URL,
      new Response(JSON.stringify({
        unreadEndpointUrl,
        unreadToken,
        unreadRecipientPeerId,
        lastUnreadCount,
        lastUnreadNotificationAt,
      }), { headers: { 'Content-Type': 'application/json' } }),
    );
  } catch {
    // Best-effort.
  }
}

async function loadUnreadConfig() {
  try {
    const cache = await caches.open(SKYPIER_CONFIG_CACHE);
    const response = await cache.match(SKYPIER_CONFIG_URL);
    if (!response) {
      return;
    }
    const data = await response.json();
    if (data.unreadEndpointUrl) { unreadEndpointUrl = data.unreadEndpointUrl; }
    if (data.unreadToken) { unreadToken = data.unreadToken; }
    if (data.unreadRecipientPeerId) { unreadRecipientPeerId = data.unreadRecipientPeerId; }
    if (typeof data.lastUnreadCount === 'number') { lastUnreadCount = data.lastUnreadCount; }
    if (typeof data.lastUnreadNotificationAt === 'number') { lastUnreadNotificationAt = data.lastUnreadNotificationAt; }
  } catch {
    // Best-effort.
  }
}

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

function canRunUnreadCheck() {
  return Boolean(unreadEndpointUrl && unreadRecipientPeerId);
}

function buildUnreadCheckUrl() {
  const baseUrl = new URL(unreadEndpointUrl);
  baseUrl.searchParams.set('recipientPeerId', unreadRecipientPeerId);
  return baseUrl.toString();
}

async function fetchUnreadCheckSummary() {
  if (!canRunUnreadCheck()) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SKYPIER_UNREAD_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(buildUnreadCheckUrl(), {
      method: 'GET',
      headers: {
        ...(unreadToken ? { 'X-Skypier-Unread-Token': unreadToken } : {}),
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const unreadCount = Number(payload?.unreadCount ?? 0);
    return {
      hasUnread: Boolean(payload?.hasUnread),
      unreadCount: Number.isFinite(unreadCount) ? Math.max(0, Math.floor(unreadCount)) : 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runUnreadCheck(source) {
  // SW may have been killed and restarted (e.g. periodic background sync);
  // reload persisted config before checking.
  if (!canRunUnreadCheck()) {
    await loadUnreadConfig();
  }

  const summary = await fetchUnreadCheckSummary();
  if (!summary) {
    return;
  }

  const now = Date.now();
  const becameUnread = summary.hasUnread && summary.unreadCount > lastUnreadCount;
  lastUnreadCount = summary.unreadCount;
  await saveUnreadConfig();

  if (!becameUnread) {
    return;
  }

  if (now - lastUnreadNotificationAt < SKYPIER_UNREAD_CHECK_DEDUPE_MS) {
    return;
  }

  lastUnreadNotificationAt = now;
  await saveUnreadConfig();

  await self.registration.showNotification('🔐 New encrypted message', {
    body: 'Open Skypier to decrypt and read.',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: SKYPIER_UNREAD_NOTIFICATION_TAG,
    data: {
      source,
      unreadCount: summary.unreadCount,
    },
  });

  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'SKYPIER_RECOVER_CONNECTIVITY', source: `unread-check:${source}` });
  }
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
      // Ask open windows to re-send unread config so the SW has it for
      // background polling (SKYPIER_REQUEST_UNREAD_CONFIG is handled in App.tsx).
      client.postMessage({ type: 'SKYPIER_REQUEST_UNREAD_CONFIG' });
    }

    await runUnreadCheck('activate');
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
    event.waitUntil(runUnreadCheck('message-recovery'));
    return;
  }

  if (data.type === 'SKYPIER_UNREAD_CONFIG') {
    unreadEndpointUrl = typeof data.unreadEndpointUrl === 'string' ? data.unreadEndpointUrl.trim() : '';
    unreadToken = typeof data.unreadToken === 'string' ? data.unreadToken.trim() : '';
    unreadRecipientPeerId = typeof data.recipientPeerId === 'string' ? data.recipientPeerId.trim() : '';
    event.waitUntil((async () => {
      await saveUnreadConfig();
      await runUnreadCheck('config-update');
    })());
    return;
  }

  if (data.type === 'SKYPIER_CHECK_UNREAD') {
    event.waitUntil(runUnreadCheck('manual-check'));
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

    await runUnreadCheck('notification-click');
  })());
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    await self.registration.showNotification('🔐 New encrypted message', {
      body: 'Open Skypier to decrypt and read.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'skypier-message',
      data: {
        source: 'push',
      },
    });

    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'SKYPIER_RECOVER_CONNECTIVITY', source: 'push' });
    }

    await runUnreadCheck('push');
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'SKYPIER_PUSH_SUBSCRIPTION_CHANGED' });
    }
  })());
});

self.addEventListener('sync', (event) => {
  if (event.tag !== SKYPIER_UNREAD_SYNC_TAG) {
    return;
  }

  event.waitUntil(runUnreadCheck('background-sync'));
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag !== SKYPIER_UNREAD_PERIODIC_SYNC_TAG) {
    return;
  }

  event.waitUntil(runUnreadCheck('periodic-sync'));
});
