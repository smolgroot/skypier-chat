import { isLikelyPeerId } from '../peerIds';
import { getEnsPublicClient, normalizeEnsName, SKYPIER_PEERID_TEXT_KEY } from './ensClient';

/** Text records are attacker-controlled; a peer ID never legitimately approaches this. */
const MAX_RECORD_LENGTH = 128;

const LOOKUP_CACHE_KEY = 'skypier-chat:ens-handle-cache';
const POSITIVE_TTL_MS = 30 * 60_000;
const NEGATIVE_TTL_MS = 2 * 60_000;
const MAX_CACHE_ENTRIES = 200;

interface CachedLookup {
  peerId: string | null;
  ownerAddress: string | null;
  expiresAt: number;
}

const memoryCache = new Map<string, CachedLookup>();
const inflight = new Map<string, Promise<EnsHandleLookup>>();
let hydrated = false;

export type EnsHandleLookup =
  | { status: 'resolved'; name: string; peerId: string; ownerAddress: string | null }
  | { status: 'no-record'; name: string; ownerAddress: string | null }
  | { status: 'unregistered'; name: string }
  | { status: 'invalid'; input: string }
  | { status: 'error'; name: string; message: string };

function hydrateFromStorage(): void {
  if (hydrated) return;
  hydrated = true;

  try {
    const raw = localStorage.getItem(LOOKUP_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CachedLookup>;
    const now = Date.now();
    for (const [name, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.expiresAt === 'number' && entry.expiresAt > now) {
        memoryCache.set(name, entry);
      }
    }
  } catch {
    // Corrupt or unavailable storage is not worth surfacing; the cache is an optimization.
  }
}

function persistToStorage(): void {
  try {
    const now = Date.now();
    const live = [...memoryCache.entries()].filter(([, entry]) => entry.expiresAt > now);

    // Cap the cache, dropping nearest-expiry entries first.
    live.sort((a, b) => b[1].expiresAt - a[1].expiresAt);
    const capped = live.slice(0, MAX_CACHE_ENTRIES);

    memoryCache.clear();
    for (const [name, entry] of capped) {
      memoryCache.set(name, entry);
    }

    localStorage.setItem(LOOKUP_CACHE_KEY, JSON.stringify(Object.fromEntries(capped)));
  } catch {
    // Ignore quota/private-mode failures.
  }
}

function readCache(name: string): CachedLookup | undefined {
  hydrateFromStorage();
  const entry = memoryCache.get(name);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(name);
    return undefined;
  }
  return entry;
}

function writeCache(name: string, peerId: string | null, ownerAddress: string | null): void {
  memoryCache.set(name, {
    peerId,
    ownerAddress,
    expiresAt: Date.now() + (peerId ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  persistToStorage();
}

/** Drop a cached entry so a freshly published record is visible immediately. */
export function invalidateEnsHandle(name: string): void {
  const normalized = normalizeEnsName(name);
  if (normalized) {
    memoryCache.delete(normalized);
    persistToStorage();
  }
}

function toLookup(name: string, peerId: string | null, ownerAddress: string | null): EnsHandleLookup {
  if (peerId) {
    return { status: 'resolved', name, peerId, ownerAddress };
  }
  if (ownerAddress) {
    return { status: 'no-record', name, ownerAddress };
  }
  return { status: 'unregistered', name };
}

/**
 * Reads the Skypier peer ID published on an ENS name, or null when the name is
 * unregistered, has no resolver, or has not published one.
 *
 * Throws only on genuine RPC failure — viem's default (non-strict) `getEnsText` already
 * folds "no such name / no resolver / no record" into a null return.
 */
export async function resolveSkypierPeerId(name: string): Promise<string | null> {
  const normalized = normalizeEnsName(name);
  if (!normalized) return null;

  const record = await getEnsPublicClient().getEnsText({
    name: normalized,
    key: SKYPIER_PEERID_TEXT_KEY,
  });

  return sanitizeRecordValue(record);
}

/**
 * The record value comes from a third party who can write anything. Constrain it to the
 * same shape the app accepts from a pasted peer ID before it reaches any dial path.
 */
function sanitizeRecordValue(record: string | null): string | null {
  if (!record) return null;
  const candidate = record.trim();
  if (!candidate || candidate.length > MAX_RECORD_LENGTH) return null;
  return isLikelyPeerId(candidate) ? candidate : null;
}

/**
 * UI-facing lookup: never throws, distinguishes the failure modes users care about, and
 * shares one in-flight request across concurrent callers.
 */
export async function lookupEnsHandle(
  input: string,
  options?: { force?: boolean },
): Promise<EnsHandleLookup> {
  const normalized = normalizeEnsName(input);
  if (!normalized) {
    return { status: 'invalid', input: input.trim() };
  }

  if (options?.force) {
    memoryCache.delete(normalized);
  } else {
    const cached = readCache(normalized);
    if (cached) {
      return toLookup(normalized, cached.peerId, cached.ownerAddress);
    }
  }

  const existing = inflight.get(normalized);
  if (existing) return existing;

  const request = (async (): Promise<EnsHandleLookup> => {
    const client = getEnsPublicClient();
    try {
      const [record, ownerAddress] = await Promise.all([
        client.getEnsText({ name: normalized, key: SKYPIER_PEERID_TEXT_KEY }),
        client.getEnsAddress({ name: normalized }).catch(() => null),
      ]);

      const peerId = sanitizeRecordValue(record);
      writeCache(normalized, peerId, ownerAddress ?? null);
      return toLookup(normalized, peerId, ownerAddress ?? null);
    } catch (error) {
      // Never cache transient RPC failures — a blip would otherwise look permanent.
      return {
        status: 'error',
        name: normalized,
        message: error instanceof Error ? error.message : 'ENS lookup failed.',
      };
    } finally {
      inflight.delete(normalized);
    }
  })();

  inflight.set(normalized, request);
  return request;
}

export function describeEnsLookup(result: EnsHandleLookup): string {
  switch (result.status) {
    case 'resolved':
      return `${result.name} resolved to a Skypier peer ID.`;
    case 'no-record':
      return `${result.name} is registered but hasn't published a Skypier peer ID yet. Ask them to publish one from Settings.`;
    case 'unregistered':
      return `${result.name} isn't registered on ENS.`;
    case 'invalid':
      return `"${result.input}" isn't a valid ENS name.`;
    case 'error':
      return `Couldn't reach ENS to look up ${result.name}. Check your connection and try again.`;
  }
}

const primaryNameCache = new Map<string, { name: string | null; expiresAt: number }>();
const primaryNameInflight = new Map<string, Promise<string | null>>();

/**
 * Reverse resolution (address -> primary ENS name), cached so the passive callers that
 * mount on every layout render stop re-hitting the RPC.
 */
export async function resolveEnsPrimaryName(address: string): Promise<string | null> {
  const key = address.toLowerCase();

  const cached = primaryNameCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.name;
  }

  const existing = primaryNameInflight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const name = await getEnsPublicClient().getEnsName({ address: address as `0x${string}` });
      primaryNameCache.set(key, {
        name: name ?? null,
        expiresAt: Date.now() + (name ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
      });
      return name ?? null;
    } finally {
      primaryNameInflight.delete(key);
    }
  })();

  primaryNameInflight.set(key, request);
  return request;
}
