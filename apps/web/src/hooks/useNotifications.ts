import { useCallback, useEffect, useRef } from 'react';

// ─── 8-bit notification sound via Web Audio API ──────────────────────────

let sharedAudioCtx: AudioContext | undefined;

function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContext();
  }
  return sharedAudioCtx;
}

/**
 * Plays a soft, modern notification chime using the Web Audio API.
 * Uses smooth sine waves with exponential decay for a clean UI sound.
 */
function playModernNotificationSound(): void {
  try {
    const ctx = getAudioContext();

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    // Modern soft chime: G5 -> D6
    const notes = [
      { freq: 783.99, time: 0 },
      { freq: 1174.66, time: 0.12 }
    ];

    notes.forEach(({ freq, time }) => {
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();

      osc.type = 'sine'; // Soft rounded tone
      osc.frequency.setValueAtTime(freq, now + time);

      // Envelope: 20ms attack, smooth exponential decay over 400ms
      noteGain.gain.setValueAtTime(0, now + time);
      noteGain.gain.linearRampToValueAtTime(0.3, now + time + 0.02);
      noteGain.gain.exponentialRampToValueAtTime(0.001, now + time + 0.4);

      osc.connect(noteGain);
      noteGain.connect(ctx.destination);

      osc.start(now + time);
      osc.stop(now + time + 0.45);
    });
  } catch {
    // Web Audio not available — silently skip
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

function showOsNotification(title: string, body: string): void {
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
      tag: 'skypier-message', // collapses multiple into one
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

function triggerMobileVibration(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([200, 100, 200]);
    }
  } catch {
    // Ignore errors if vibration API fails or is denied
  }
}

export function useNotifications() {
  const permissionRef = useRef<NotificationPermission>('default');

  // Request permission on mount
  useEffect(() => {
    void requestNotificationPermission().then((perm) => {
      permissionRef.current = perm;
    });
  }, []);

  // Unlock AudioContext on first user interaction (autoplay policy)
  useEffect(() => {
    const unlock = () => {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
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
    // 1) Play modern UI sound (always, even if tab is focused)
    playModernNotificationSound();

    // 2) Trigger mobile vibration if available
    triggerMobileVibration();

    // 3) Show OS notification (only if tab is not focused)
    showOsNotification(
      `💬 ${senderName}`,
      messagePreview.length > 100
        ? messagePreview.slice(0, 100) + '…'
        : messagePreview,
    );
  }, []);

  return { notifyIncomingMessage };
}
