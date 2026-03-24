/**
 * Custom hook for PWA Vibration API
 * Provides standardized vibration patterns for user feedback
 */

export interface VibrationPattern {
  name: string;
  pattern: number | number[];
}

export const VIBRATION_PATTERNS = {
  tap: { name: 'tap', pattern: [50] as number[] },
  doubleTap: { name: 'doubleTap', pattern: [100, 50, 100] as number[] },
  success: { name: 'success', pattern: [50, 100, 50] as number[] },
  error: { name: 'error', pattern: [200, 100, 200, 100, 200] as number[] },
  notification: { name: 'notification', pattern: [100, 50, 100, 50, 100] as number[] },
  messageSent: { name: 'messageSent', pattern: [30, 50, 30] as number[] },
  messageReceived: { name: 'messageReceived', pattern: [100, 30, 100] as number[] },
  retry: { name: 'retry', pattern: [60, 40, 60] as number[] },
};

export function useVibration() {
  const isSupported = 'vibrate' in navigator;

  const vibrate = (pattern: number | number[] | VibrationPattern) => {
    if (!isSupported) return;

    try {
      const patternToUse =
        typeof pattern === 'object' && 'pattern' in pattern
          ? pattern.pattern
          : pattern;

      navigator.vibrate(patternToUse);
    } catch (error) {
      console.debug('Vibration API error:', error);
    }
  };

  const stop = () => {
    if (!isSupported) return;
    navigator.vibrate(0);
  };

  return {
    isSupported,
    vibrate,
    stop,
    patterns: VIBRATION_PATTERNS,
  };
}
