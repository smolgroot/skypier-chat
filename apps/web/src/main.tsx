import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

let skypierServiceWorkerRegistration: ServiceWorkerRegistration | null = null;
const SKYPIER_UNREAD_SYNC_TAG = 'skypier-unread-sync';
const SKYPIER_UNREAD_PERIODIC_SYNC_TAG = 'skypier-unread-periodic';

async function registerUnreadBackgroundTasks(registration: ServiceWorkerRegistration) {
  // One-off background sync wakes the SW after connectivity returns.
  try {
    const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync;
    if (syncManager) {
      await syncManager.register(SKYPIER_UNREAD_SYNC_TAG);
    }
  } catch {
    // Not supported or denied on this browser/profile.
  }

  // Periodic background sync is best-effort and currently strongest on Chrome PWAs.
  try {
    const periodicSyncManager = (registration as ServiceWorkerRegistration & {
      periodicSync?: { register(tag: string, options: { minInterval: number }): Promise<void> };
    }).periodicSync;

    if (!periodicSyncManager) {
      return;
    }

    let permissionState: 'granted' | 'denied' | 'prompt' = 'prompt';
    try {
      const permissionsApi = (navigator as Navigator & {
        permissions?: { query(descriptor: { name: string }): Promise<{ state: 'granted' | 'denied' | 'prompt' }> };
      }).permissions;
      if (permissionsApi) {
        const permissionStatus = await permissionsApi.query({ name: 'periodic-background-sync' });
        permissionState = permissionStatus.state;
      }
    } catch {
      // Keep default prompt state and continue best-effort registration.
    }

    if (permissionState === 'granted' || permissionState === 'prompt') {
      await periodicSyncManager.register(SKYPIER_UNREAD_PERIODIC_SYNC_TAG, {
        minInterval: 15 * 60 * 1000,
      });
    }
  } catch {
    // Not supported or denied on this browser/profile.
  }
}

function emitConnectivityRecoveryRequest(source: string) {
  window.dispatchEvent(new CustomEvent('skypier:recover-connectivity', { detail: { source } }));
}

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data ?? {};
      if (data.type === 'SKYPIER_RECOVER_CONNECTIVITY') {
        emitConnectivityRecoveryRequest(data.source ?? 'service-worker');
      } else if (data.type === 'SKYPIER_PUSH_SUBSCRIPTION_CHANGED') {
        window.dispatchEvent(new CustomEvent('skypier:push-subscription-changed'));
      } else if (data.type === 'SKYPIER_REQUEST_UNREAD_CONFIG') {
        // SW woke up without config (e.g. after being killed); re-broadcast it.
        window.dispatchEvent(new CustomEvent('skypier:sw-unread-config-requested'));
      }
    });

    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      skypierServiceWorkerRegistration = registration;
      registration.active?.postMessage({ type: 'SKYPIER_REQUEST_RECOVERY' });
      void registerUnreadBackgroundTasks(registration);
    });

    // Fallback for browsers that don't support Periodic Background Sync
    // (or when Chrome withholds it due to low site-engagement score).
    // While the page is hidden (app backgrounded), ping the SW every 3 min.
    const BACKGROUND_POLL_INTERVAL_MS = 3 * 60 * 1000;
    let backgroundPollTimer: ReturnType<typeof setInterval> | null = null;

    function startBackgroundPoll() {
      if (backgroundPollTimer !== null) return;
      backgroundPollTimer = setInterval(() => {
        navigator.serviceWorker.controller?.postMessage({ type: 'SKYPIER_CHECK_UNREAD' });
      }, BACKGROUND_POLL_INTERVAL_MS);
    }

    function stopBackgroundPoll() {
      if (backgroundPollTimer !== null) {
        clearInterval(backgroundPollTimer);
        backgroundPollTimer = null;
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        startBackgroundPoll();
      } else {
        stopBackgroundPoll();
        // Trigger an immediate check when user returns to the app.
        navigator.serviceWorker.controller?.postMessage({ type: 'SKYPIER_CHECK_UNREAD' });
      }
    });

    window.addEventListener('skypier:sw-unread-config', (event) => {
      const customEvent = event as CustomEvent<{
        unreadEndpointUrl?: string;
        unreadToken?: string;
        recipientPeerId?: string;
      }>;
      const detail = customEvent.detail ?? {};

      const payload = {
        type: 'SKYPIER_UNREAD_CONFIG',
        unreadEndpointUrl: typeof detail.unreadEndpointUrl === 'string' ? detail.unreadEndpointUrl : '',
        unreadToken: typeof detail.unreadToken === 'string' ? detail.unreadToken : '',
        recipientPeerId: typeof detail.recipientPeerId === 'string' ? detail.recipientPeerId : '',
      };

      skypierServiceWorkerRegistration?.active?.postMessage(payload);
      skypierServiceWorkerRegistration?.waiting?.postMessage(payload);
      skypierServiceWorkerRegistration?.installing?.postMessage(payload);
      navigator.serviceWorker.controller?.postMessage(payload);
    });
  } else {
    // Avoid stale SW controlling localhost during Vite development.
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        void registration.unregister();
      }
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
