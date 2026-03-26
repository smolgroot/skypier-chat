import { playSuccess, playError, playWarning, playNotification, playClick, playInfo, setAudioContext } from 'earcons';
import { useCallback, useEffect, useRef } from 'react';

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
    setAudioContext(sharedAudioCtx);
  }

  return sharedAudioCtx;
}

type CallEarconType =
  | 'dial' // Initiating a call (info/notification tone)
  | 'ring' // Incoming call ringing (notification repeated)
  | 'ringing-outbound' // Outbound call waiting for response (click repeated)
  | 'connect' // Call connected (success tone)
  | 'accept' // User accepted call (click)
  | 'reject' // User rejected call (warning)
  | 'hangup' // Call ended (info)
  | 'error' // Error or failed call (error tone)
  | 'mute-on' // Mute enabled (click short)
  | 'mute-off' // Mute disabled (success short)
  | 'busy'; // Remote peer busy (error repeated)

interface PlayEarconOptions {
  volume?: number;
  loop?: boolean;
}

export function useCallEarcons() {
  const ringIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const ringingOutboundIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const busyIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Resume AudioContext on first user interaction (autoplay policy)
  useEffect(() => {
    const unlock = () => {
      audioUnlocked = true;
      const ctx = getAudioContext(true);
      if (ctx?.state === 'suspended') {
        void ctx.resume();
      }
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

  // Stop all looping earcons on unmount
  useEffect(() => {
    return () => {
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
      }
      if (ringingOutboundIntervalRef.current) {
        clearInterval(ringingOutboundIntervalRef.current);
      }
      if (busyIntervalRef.current) {
        clearInterval(busyIntervalRef.current);
      }
    };
  }, []);

  /**
   * Play a single earcon sound or start a looping one
   */
  const playEarcon = useCallback(
    async (type: CallEarconType, options: PlayEarconOptions = {}) => {
      const { volume = 0.5, loop = false } = options;

      try {
        const ctx = getAudioContext();
        if (!ctx) {
          return;
        }

        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        // Stop any active looping earcons before starting a new one
        if (ringIntervalRef.current) {
          clearInterval(ringIntervalRef.current);
          ringIntervalRef.current = null;
        }
        if (ringingOutboundIntervalRef.current) {
          clearInterval(ringingOutboundIntervalRef.current);
          ringingOutboundIntervalRef.current = null;
        }
        if (busyIntervalRef.current) {
          clearInterval(busyIntervalRef.current);
          busyIntervalRef.current = null;
        }

        switch (type) {
          case 'dial': {
            // Dialtone-like sound using info (soft, informational)
            await playInfo({
              audioContext: ctx,
              variant: 'medium',
              volume: Math.min(volume, 0.5),
            });
            break;
          }

          case 'ring': {
            // Ring sound repeated for incoming call
            if (loop) {
              const playRingLoop = async () => {
                try {
                  await playNotification({
                    audioContext: ctx,
                    variant: 'long',
                    volume: Math.min(volume, 0.6),
                  });
                } catch {
                  // Ignore playback errors in loop
                }
              };

              void playRingLoop();
              ringIntervalRef.current = setInterval(() => {
                void playRingLoop();
              }, 1_500);
            } else {
              await playNotification({
                audioContext: ctx,
                variant: 'long',
                volume: Math.min(volume, 0.6),
              });
            }
            break;
          }

          case 'ringing-outbound': {
            // Shorter click sound for outbound call waiting
            if (loop) {
              const playOutboundRing = async () => {
                try {
                  await playClick({
                    audioContext: ctx,
                    variant: 'medium',
                    volume: Math.min(volume, 0.5),
                  });
                } catch {
                  // Ignore playback errors in loop
                }
              };

              void playOutboundRing();
              ringingOutboundIntervalRef.current = setInterval(() => {
                void playOutboundRing();
              }, 1_800);
            } else {
              await playClick({
                audioContext: ctx,
                variant: 'medium',
                volume: Math.min(volume, 0.5),
              });
            }
            break;
          }

          case 'connect': {
            // Success sound when call connects
            await playSuccess({
              audioContext: ctx,
              variant: 'medium',
              volume: Math.min(volume, 0.55),
            });
            break;
          }

          case 'accept': {
            // Click sound when accepting call
            await playClick({
              audioContext: ctx,
              variant: 'short',
              volume: Math.min(volume, 0.5),
            });
            break;
          }

          case 'reject': {
            // Warning sound when declining
            await playWarning({
              audioContext: ctx,
              variant: 'short',
              volume: Math.min(volume, 0.55),
            });
            break;
          }

          case 'hangup': {
            // Info sound for call ended
            await playInfo({
              audioContext: ctx,
              variant: 'short',
              volume: Math.min(volume, 0.45),
            });
            break;
          }

          case 'error': {
            // Error sound for call errors
            await playError({
              audioContext: ctx,
              variant: 'long',
              volume: Math.min(volume, 0.65),
            });
            break;
          }

          case 'mute-on': {
            // Short click for muting
            await playClick({
              audioContext: ctx,
              variant: 'short',
              volume: Math.min(volume * 0.6, 0.3),
            });
            break;
          }

          case 'mute-off': {
            // Short success sound for unmuting
            await playSuccess({
              audioContext: ctx,
              variant: 'short',
              volume: Math.min(volume * 0.7, 0.35),
            });
            break;
          }

          case 'busy': {
            // Busy signal: repeated error sounds
            const playBusySignal = async () => {
              try {
                await playError({
                  audioContext: ctx,
                  variant: 'short',
                  volume: Math.min(volume, 0.65),
                });
              } catch {
                // Ignore playback errors
              }
            };

            if (loop) {
              void playBusySignal();
              busyIntervalRef.current = setInterval(() => {
                void playBusySignal();
              }, 600);
            } else {
              await playBusySignal();
            }
            break;
          }

          default: {
            const _exhaustive: never = type;
            return _exhaustive;
          }
        }
      } catch {
        // Audio playback can be blocked by browser policy or unsupported APIs.
        // Silently fail — don't break the UX.
      }
    },
    []
  );

  /**
   * Stop looping earcons (ring, ringing-outbound, busy)
   */
  const stopLooping = useCallback(() => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    if (ringingOutboundIntervalRef.current) {
      clearInterval(ringingOutboundIntervalRef.current);
      ringingOutboundIntervalRef.current = null;
    }
    if (busyIntervalRef.current) {
      clearInterval(busyIntervalRef.current);
      busyIntervalRef.current = null;
    }
  }, []);

  return {
    playEarcon,
    stopLooping,
  };
}
