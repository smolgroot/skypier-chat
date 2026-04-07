import { playMessage } from 'earcons';
import { useCallback, useEffect, useRef } from 'react';
import { useVibration } from './useVibration';

let sharedAudioCtx: AudioContext | undefined;
let audioUnlocked = false;

function getAudioContext(allowCreate = false): AudioContext | undefined {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return undefined;
  }

  if (!allowCreate && !audioUnlocked && !sharedAudioCtx) {
    return undefined;
  }

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContext();
  }

  return sharedAudioCtx;
}

async function playIncomingMessageSound(): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (!ctx) {
      return;
    }

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    await playMessage({
      audioContext: ctx,
      variant: 'medium',
      volume: 0.42,
    });
  } catch {
    // Audio playback can be blocked by browser policy or unsupported APIs.
  }
}

// ─── PWA Notification API ────────────────────────────────────────────────

async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  if (Notification.permission === 'granted') {
    return 'granted';
  }
  if (Notification.permission === 'denied') {
    return 'denied';
  }
  return await Notification.requestPermission();
}

function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

async function ensurePushSubscriptionIfConfigured(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }

  const vapidPublicKey = String(import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY ?? '').trim();
  if (!vapidPublicKey) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(vapidPublicKey) as BufferSource,
  });

  window.dispatchEvent(new CustomEvent('skypier:push-subscription-ready', {
    detail: {
      endpoint: subscription.endpoint,
      keys: subscription.toJSON().keys ?? {},
    },
  }));
}

function isLikelyMobileDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const navWithUaData = navigator as Navigator & {
    userAgentData?: {
      mobile?: boolean;
    };
  };

  if (typeof navWithUaData.userAgentData?.mobile === 'boolean') {
    return navWithUaData.userAgentData.mobile;
  }

  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function isAppInForeground(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  return document.visibilityState === 'visible' && document.hasFocus();
}

function normalizeVibrationPattern(pattern?: number | number[]): number[] | undefined {
  if (typeof pattern === 'number') {
    return [pattern];
  }

  if (Array.isArray(pattern) && pattern.length > 0) {
    return pattern;
  }

  return undefined;
}

function showNativeOsNotification(
  title: string,
  body: string,
  tag = 'skypier-message',
  options?: {
    vibratePattern?: number | number[];
  },
): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  // Don't show if the tab is focused — the user is already looking at the app
  if (document.hasFocus()) {
    return;
  }

  try {
    const notification = new Notification(title, {
      body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag,
      vibrate: normalizeVibrationPattern(options?.vibratePattern),
    } as NotificationOptions);

    // Auto-close after 5 seconds
    setTimeout(() => notification.close(), 5_000);

    // Focus the app when clicked
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Notification constructor can throw in some contexts (e.g. Service Worker
    // requires registration.showNotification instead)
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────

export interface NotifyMessageOptions {
  senderName: string;
  messagePreview: string;
}

export interface NotifyIncomingCallOptions {
  callerName: string;
}

function triggerMobileVibration(pattern: number | number[] = [200, 100, 200]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore errors if vibration API fails or is denied
  }
}

export function useNotifications() {
  const permissionRef = useRef<NotificationPermission>('default');
  const { patterns } = useVibration();
  const isMobileRef = useRef(isLikelyMobileDevice());

  // Request permission on mount
  useEffect(() => {
    void requestNotificationPermission().then((perm) => {
      permissionRef.current = perm;
      if (perm === 'granted') {
        void ensurePushSubscriptionIfConfigured();
      }
    });
  }, []);

  // Unlock AudioContext on first user interaction (autoplay policy)
  useEffect(() => {
    const unlock = () => {
      audioUnlocked = true;
      const ctx = getAudioContext(true);
      if (ctx?.state === 'suspended') {
        void ctx.resume();
      }
      // Remove after first interaction
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });

    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  const notifyIncomingMessage = useCallback(({ senderName, messagePreview }: NotifyMessageOptions) => {
    const isForeground = isAppInForeground();
    const isMobile = isMobileRef.current;

    // On mobile background notifications, avoid WebAudio earcons and let OS channels handle alerts.
    if (!isMobile || isForeground) {
      void playIncomingMessageSound();
    }

    if (isMobile) {
      triggerMobileVibration(patterns.messageReceived.pattern);
    }

    showNativeOsNotification(
      `💬 ${senderName}`,
      messagePreview.length > 100
        ? messagePreview.slice(0, 100) + '…'
        : messagePreview,
      'skypier-message',
      {
        vibratePattern: isMobile ? patterns.messageReceived.pattern : undefined,
      },
    );
  }, [patterns]);

  const notifyIncomingCall = useCallback(({ callerName }: NotifyIncomingCallOptions) => {
    const isForeground = isAppInForeground();
    const isMobile = isMobileRef.current;

    if (!isMobile || isForeground) {
      void playIncomingMessageSound();
    }

    if (isMobile) {
      triggerMobileVibration(patterns.retry.pattern);
    }

    showNativeOsNotification(
      '📞 Incoming Skypier call',
      `${callerName} is calling you.`,
      'skypier-audio-call',
      {
        vibratePattern: isMobile ? patterns.retry.pattern : undefined,
      },
    );
  }, [patterns]);

  return { notifyIncomingMessage, notifyIncomingCall };
}
