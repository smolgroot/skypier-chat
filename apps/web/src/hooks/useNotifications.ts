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
 * Plays a short 8-bit style notification jingle using the Web Audio API.
 *
 * Melody: ascending arpeggio (C5→E5→G5→C6) with square-wave timbre
 * for that classic chiptune feel.
 */
function play8BitNotificationSound(): void {
  try {
    const ctx = getAudioContext();

    // If the context is suspended (autoplay policy), try to resume
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    // C5, E5, G5, C6 — ascending major arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const noteDuration = 0.08;
    const noteGap = 0.02;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.15, now);
    masterGain.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now);

      const noteStart = now + i * (noteDuration + noteGap);
      const noteEnd = noteStart + noteDuration;

      // Envelope: quick attack, short sustain, fast release
      noteGain.gain.setValueAtTime(0, noteStart);
      noteGain.gain.linearRampToValueAtTime(1, noteStart + 0.01);
      noteGain.gain.setValueAtTime(1, noteEnd - 0.02);
      noteGain.gain.linearRampToValueAtTime(0, noteEnd);

      osc.connect(noteGain);
      noteGain.connect(masterGain);

      osc.start(noteStart);
      osc.stop(noteEnd + 0.01);
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
    // 1) Play 8-bit sound (always, even if tab is focused)
    play8BitNotificationSound();

    // 2) Show OS notification (only if tab is not focused)
    showOsNotification(
      `💬 ${senderName}`,
      messagePreview.length > 100
        ? messagePreview.slice(0, 100) + '…'
        : messagePreview,
    );
  }, []);

  return { notifyIncomingMessage };
}
