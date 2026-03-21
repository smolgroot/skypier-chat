self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'SKYPIER_RECOVER_CONNECTIVITY', source: 'sw-activate' });
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
