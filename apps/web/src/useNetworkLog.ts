import { useEffect, useRef, useState } from 'react';

export interface NetworkLogEntry {
  id: number;
  timestamp: string;
  level: 'log' | 'warn' | 'error';
  message: string;
  repeatCount?: number;
}

const MAX_ENTRIES = 120;
const SKYPIER_PREFIX = /^\[skypier:/;
const NOISY_INFO_PATTERNS = [
  /ensureConnectionToPeer: no connection/i,
  /ensureConnectionToPeer: re-dial ✓ connected/i,
  /ensureConnectionToPeer: skipping re-dial \(cooldown\)/i,
];

/**
 * Intercepts console.log / warn / error calls that start with `[skypier:`
 * and captures them into React state so they can be rendered in the UI.
 */
export function useNetworkLog() {
  const [entries, setEntries] = useState<NetworkLogEntry[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    function capture(level: NetworkLogEntry['level'], args: unknown[]) {
      const first = args[0];
      if (typeof first !== 'string' || !SKYPIER_PREFIX.test(first)) {
        return;
      }

      const message = args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 0)))
        .join(' ');

      if (level === 'log' && NOISY_INFO_PATTERNS.some((pattern) => pattern.test(message))) {
        return;
      }

      const entry: NetworkLogEntry = {
        id: ++idRef.current,
        timestamp: new Date().toISOString(),
        level,
        message,
        repeatCount: 1,
      };

      setEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.level === entry.level && last.message === entry.message) {
          const next = [...prev];
          next[next.length - 1] = {
            ...last,
            timestamp: entry.timestamp,
            repeatCount: (last.repeatCount ?? 1) + 1,
          };
          return next;
        }

        const next = [...prev, entry];
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
      });
    }

    console.log = (...args: unknown[]) => {
      capture('log', args);
      origLog.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      capture('warn', args);
      origWarn.apply(console, args);
    };

    console.error = (...args: unknown[]) => {
      capture('error', args);
      origError.apply(console, args);
    };

    return () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    };
  }, []);

  return entries;
}
