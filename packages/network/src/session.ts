import { multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
import * as lp from 'it-length-prefixed';
import type {
  AudioCallChunk,
  AudioCallSignal,
  ChatMessage,
  DevicePreKeyBundle,
  MailboxAckRequest,
  MailboxAckResponse,
  MailboxEnqueueRequest,
  MailboxEnqueueResponse,
  MailboxPullRequest,
  MailboxPullResponse,
  ProfileShareRequest,
  ProfileShareResponse,
  SharedPeerProfileMetadata,
} from '@skypier/protocol';
import {
  loadPendingQueue,
  savePendingQueue,
  type PersistedQueueEntry,
} from '@skypier/storage';
import { createBrowserSkypierNode, type CreateBrowserSkypierNodeOptions, type SkypierBrowserNode } from './browser';
import { SKYPIER_CHAT_PROTOCOLS, deserializeWireEnvelope, serializeWireEnvelope, type WireEnvelope } from './protocols';

export type SessionStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export interface PeerReachabilityEvent {
  peerId: string;
  reachability: 'direct' | 'relayed' | 'offline';
}

export interface DeliveryStatusEvent {
  messageId: string;
  status: 'sent' | 'delivered' | 'failed';
}

export interface BrowserLiveSessionState {
  status: SessionStatus;
  localPeerId?: string;
  connectedPeers: string[];
  listenAddresses: string[];
  protocols: string[];
  queuedOutgoing: number;
  lastError?: string;
  /** Peer IDs of configured relay nodes (used for mailbox pull/enqueue). */
  relayPeerIds: string[];
}

export interface BrowserLiveSessionEventMap {
  state: BrowserLiveSessionState;
  inbound: {
    fromPeerId: string;
    envelope: WireEnvelope;
  };
  audioCallSignal: {
    fromPeerId: string;
    signal: AudioCallSignal;
  };
  audioCallChunk: {
    fromPeerId: string;
    chunk: AudioCallChunk;
  };
  peerReachability: PeerReachabilityEvent;
  deliveryStatus: DeliveryStatusEvent;
  remoteProfile: {
    peerId: string;
    profile: SharedPeerProfileMetadata;
  };
  dialLog: DialLogEntry;
}

export interface DialLogEntry {
  peerId: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  timestamp: string;
}

export interface ConnectionDebugInfo {
  remotePeerId: string;
  remoteAddr: string;
  direction: string;
  status: string;
  transportType: 'webrtc' | 'relay' | 'websocket' | 'other';
}

export interface NetworkDebugSnapshot {
  peerId: string | undefined;
  connections: ConnectionDebugInfo[];
  listenAddresses: string[];
  hasRelayReservation: boolean;
  relayListenAddresses: string[];
  relayPeerIds: string[];
  configuredRelayAddresses: string[];
  hasWebRTCAddress: boolean;
  totalConnections: number;
  relayedConnections: number;
  directConnections: number;
}

export interface BrowserLiveSession {
  start(): Promise<void>;
  stop(): Promise<void>;
  recoverConnectivity(reason?: 'resume' | 'online' | 'visibility' | 'service-worker'): Promise<void>;
  requestSyncWithConnectedPeers(reason?: 'resume' | 'manual'): Promise<number>;
  respondToSyncRequest(peerId: string, messages: SyncMessageEntry[], requestedSince?: string): Promise<void>;
  dialPeer(address: string): Promise<string>;
  dialPeerById(peerId: string): Promise<string>;
  sendEnvelopeToConnected(envelope: WireEnvelope): Promise<number>;
  sendChatMessageToConnected(message: ChatMessage): Promise<number>;
  sendChatMessageToPeer(message: ChatMessage, targetPeerId: string): Promise<boolean>;
  requestPeerProfile(targetPeerId: string): Promise<SharedPeerProfileMetadata | null>;
  enqueueMailboxForPeer(message: ChatMessage, targetPeerId: string): Promise<boolean>;
  pullMailboxFromPeer(targetPeerId: string, limit?: number, afterCursor?: string): Promise<MailboxPullResponse | null>;
  ackMailboxFromPeer(targetPeerId: string, envelopeIds: string[]): Promise<MailboxAckResponse | null>;
  sendAudioCallSignal(signal: AudioCallSignal, targetPeerId: string): Promise<boolean>;
  sendAudioCallChunk(chunk: AudioCallChunk, targetPeerId: string): Promise<boolean>;
  retryMessage(messageId: string): Promise<boolean>;
  flushQueue(): Promise<number>;
  getState(): BrowserLiveSessionState;
  getDebugInfo(): NetworkDebugSnapshot | null;
  subscribe<T extends keyof BrowserLiveSessionEventMap>(event: T, handler: (payload: BrowserLiveSessionEventMap[T]) => void): () => void;
}

interface QueuedEnvelope {
  peerId: string;
  envelope: WireEnvelope;
  /** How many times we've retried sending this envelope */
  retryCount: number;
  /** ISO timestamp: when to attempt the next retry */
  nextRetryAt: string;
}

export interface SyncMessageEntry {
  /** Original ChatMessage.id (e.g. "msg-xxxx") — used for deduplication on the receiver side */
  messageId: string;
  conversationId: string;
  sentAt: string;
  /** Wire payload — plain text or SKYPIER_MEDIA_PREFIX+json for image messages */
  payload: string;
  /** libp2p peer ID of the message sender */
  senderPeerId: string;
}

interface SyncPayload {
  type: 'request' | 'state';
  generatedAt: string;
  requestedSince?: string;
  connectedPeers?: number;
  queuedOutgoing?: number;
  hasPreferredRelayReservation?: boolean;
  /** Phase 2.1: outbox messages the responder is replaying for the requester */
  messages?: SyncMessageEntry[];
  /** Phase 2.2: sender’s public prekey bundle — used to enable E2EE for first contact */
  preKeyBundle?: DevicePreKeyBundle;
}

// ─── Retry constants ─────────────────────────────────────────────────────
const MAX_RETRIES = 50;
/** Base delay in ms for the first retry (doubles each attempt, capped) */
const BASE_RETRY_DELAY_MS = 2_000;
/** Maximum delay between retries (5 min) */
const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;
/** How often the background loop ticks (10 s) */
const RETRY_TICK_INTERVAL_MS = 10_000;
const RELAY_RESERVATION_WAIT_TIMEOUT_MS = 12_000;
const RELAY_RESERVATION_POLL_INTERVAL_MS = 500;
const REQUEST_RESPONSE_TIMEOUT_MS = 10_000;
/** Max queue size to prevent memory exhaustion on prolonged offline */
const MAX_QUEUE_SIZE = 200;
/** Shorter cooldown for retries after limited connection errors */
const LIMITED_CONNECTION_RETRY_DELAY_MS = 15_000;
/** Time to wait for DCUtR upgrade attempt */
const DCUTR_UPGRADE_TIMEOUT_MS = 5_000;

function computeNextRetryDelay(retryCount: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, retryCount), MAX_RETRY_DELAY_MS);
}

export interface CreateBrowserLiveSessionOptions {
  nodeOptions?: CreateBrowserSkypierNodeOptions;
  /** Called each time a sync message is sent to include the local public prekey bundle. */
  getLocalPreKeyBundle?: () => DevicePreKeyBundle | undefined;
  /** Called when a remote peer asks for profile metadata over profile subprotocol. */
  getLocalProfileMetadata?: () => SharedPeerProfileMetadata | undefined;
}

// ─── Media prefix ─────────────────────────────────────────────────────────────
/** Prefix placed in WireEnvelope.payload for image messages. */
export const SKYPIER_MEDIA_PREFIX = 'skypier:img:';
export const SKYPIER_E2EE_PREFIX = 'skypier:e2ee:1:';
export const SKYPIER_TEXT_PREFIX = 'skypier:msg:1:';

export interface TextWirePayload {
  v: 1;
  text: string;
  replyTo?: ChatMessage['replyTo'];
}

function isValidReplyReference(value: unknown): value is NonNullable<ChatMessage['replyTo']> {
  if (value == null || typeof value !== 'object') {
    return false;
  }

  const replyReference = value as Partial<NonNullable<ChatMessage['replyTo']>>;
  return typeof replyReference.messageId === 'string'
    && typeof replyReference.excerpt === 'string'
    && typeof replyReference.authorDisplayName === 'string';
}

export function serializeTextWirePayload(text: string, replyTo?: ChatMessage['replyTo']): string {
  if (!replyTo) {
    return text;
  }

  return `${SKYPIER_TEXT_PREFIX}${JSON.stringify({
    v: 1,
    text,
    replyTo,
  } satisfies TextWirePayload)}`;
}

export function parseTextWirePayload(payload: string): TextWirePayload | null {
  if (!payload.startsWith(SKYPIER_TEXT_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload.slice(SKYPIER_TEXT_PREFIX.length)) as Partial<TextWirePayload>;
    if (parsed.v !== 1 || typeof parsed.text !== 'string') {
      return null;
    }

    if (parsed.replyTo != null && !isValidReplyReference(parsed.replyTo)) {
      return null;
    }

    return {
      v: 1,
      text: parsed.text,
      ...(parsed.replyTo ? { replyTo: parsed.replyTo } : {}),
    };
  } catch {
    return null;
  }
}

export interface E2EEWirePayload {
  v: 1;
  algorithm: 'xchacha20poly1305' | 'aes-gcm';
  ciphertext: string;
  nonce: string;
  senderDeviceId: string;
  recipientDeviceIds: string[];
  senderKeyId?: string;
  aad?: string;
  keyWraps?: NonNullable<ChatMessage['ciphertext']['keyWraps']>;
}

export function serializeE2EEWirePayload(payload: E2EEWirePayload): string {
  return `${SKYPIER_E2EE_PREFIX}${JSON.stringify(payload)}`;
}

export function parseE2EEWirePayload(payload: string): E2EEWirePayload | null {
  if (!payload.startsWith(SKYPIER_E2EE_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload.slice(SKYPIER_E2EE_PREFIX.length)) as Partial<E2EEWirePayload>;
    if (parsed.v !== 1) return null;
    if (parsed.algorithm !== 'xchacha20poly1305' && parsed.algorithm !== 'aes-gcm') return null;
    if (typeof parsed.ciphertext !== 'string' || typeof parsed.nonce !== 'string' || typeof parsed.senderDeviceId !== 'string') {
      return null;
    }
    if (!Array.isArray(parsed.recipientDeviceIds) || parsed.recipientDeviceIds.some((entry) => typeof entry !== 'string')) {
      return null;
    }
    if (parsed.keyWraps != null && (!Array.isArray(parsed.keyWraps) || parsed.keyWraps.some((entry) => typeof entry !== 'object' || entry == null))) {
      return null;
    }
    return parsed as E2EEWirePayload;
  } catch {
    return null;
  }
}

/** Serialise a ChatMessage into a wire payload string. */
function buildEnvelopePayload(message: ChatMessage): string {
  if (message.attachments?.length) {
    const attachment = message.attachments[0];
    const { storageKey: _storageKey, ...wireAttachment } = attachment;

    // Attachments use E2EE when ciphertext key-wraps are present. Keep a
    // plaintext fallback for legacy peers/messages that were never sealed.
    if (message.ciphertext.keyWraps?.length && message.ciphertext.ciphertext.length > 0) {
      return serializeE2EEWirePayload({
        v: 1,
        algorithm: message.ciphertext.algorithm,
        ciphertext: message.ciphertext.ciphertext,
        nonce: message.ciphertext.nonce,
        senderDeviceId: message.senderDeviceId,
        recipientDeviceIds: message.ciphertext.recipientDeviceIds,
        senderKeyId: message.ciphertext.senderKeyId,
        aad: message.ciphertext.aad,
        keyWraps: message.ciphertext.keyWraps,
      });
    }

    return SKYPIER_MEDIA_PREFIX + JSON.stringify(wireAttachment);
  }

  if (message.previewText.startsWith('skypier:react:') || message.ciphertext.ciphertext.length === 0) {
    return serializeTextWirePayload(message.previewText, message.replyTo);
  }

  return serializeE2EEWirePayload({
    v: 1,
    algorithm: message.ciphertext.algorithm,
    ciphertext: message.ciphertext.ciphertext,
    nonce: message.ciphertext.nonce,
    senderDeviceId: message.senderDeviceId,
    recipientDeviceIds: message.ciphertext.recipientDeviceIds,
    senderKeyId: message.ciphertext.senderKeyId,
    aad: message.ciphertext.aad,
    keyWraps: message.ciphertext.keyWraps,
  });
}

function tryParseSyncPayload(payload: string): SyncPayload | null {
  try {
    const parsed = JSON.parse(payload) as Partial<SyncPayload>;
    if (parsed.type !== 'request' && parsed.type !== 'state') {
      return null;
    }
    if (typeof parsed.generatedAt !== 'string') {
      return null;
    }
    return parsed as SyncPayload;
  } catch {
    return null;
  }
}

function isSharedPeerProfileMetadata(value: unknown): value is SharedPeerProfileMetadata {
  if (value == null || typeof value !== 'object') {
    return false;
  }

  const profile = value as Partial<SharedPeerProfileMetadata>;
  if (typeof profile.peerId !== 'string' || typeof profile.displayName !== 'string' || typeof profile.updatedAt !== 'string') {
    return false;
  }

  if (profile.avatarUrl != null && typeof profile.avatarUrl !== 'string') return false;
  if (profile.bio != null && typeof profile.bio !== 'string') return false;
  if (profile.ethAddress != null && typeof profile.ethAddress !== 'string') return false;
  if (profile.ensName != null && typeof profile.ensName !== 'string') return false;

  return true;
}

const MAX_SHARED_PROFILE_PAYLOAD_BYTES = 48 * 1024;
const MAX_SHARED_DISPLAY_NAME_LENGTH = 64;
const MAX_SHARED_BIO_LENGTH = 280;
const MAX_SHARED_ENS_NAME_LENGTH = 128;

function clampText(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function approximateDataUriBytes(value: string): number {
  const marker = 'base64,';
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) {
    return value.length;
  }
  const base64 = value.slice(markerIndex + marker.length);
  return Math.ceil(base64.length * 0.75);
}

function sanitizeSharedProfile(profile: SharedPeerProfileMetadata, enforcedPeerId?: string): SharedPeerProfileMetadata {
  const sanitized: SharedPeerProfileMetadata = {
    ...profile,
    peerId: enforcedPeerId ?? profile.peerId,
    displayName: clampText(profile.displayName, MAX_SHARED_DISPLAY_NAME_LENGTH) ?? profile.displayName,
    bio: clampText(profile.bio, MAX_SHARED_BIO_LENGTH),
    ensName: clampText(profile.ensName, MAX_SHARED_ENS_NAME_LENGTH),
    updatedAt: profile.updatedAt,
  };

  if (typeof sanitized.avatarUrl === 'string' && sanitized.avatarUrl.startsWith('data:')) {
    if (approximateDataUriBytes(sanitized.avatarUrl) > MAX_SHARED_PROFILE_PAYLOAD_BYTES) {
      sanitized.avatarUrl = undefined;
    }
  }

  let encoded = new TextEncoder().encode(JSON.stringify({ v: 1, profile: sanitized } satisfies ProfileShareResponse));
  if (encoded.byteLength > MAX_SHARED_PROFILE_PAYLOAD_BYTES) {
    sanitized.avatarUrl = undefined;
    encoded = new TextEncoder().encode(JSON.stringify({ v: 1, profile: sanitized } satisfies ProfileShareResponse));
  }

  if (encoded.byteLength > MAX_SHARED_PROFILE_PAYLOAD_BYTES && sanitized.bio) {
    sanitized.bio = undefined;
  }

  return sanitized;
}

export function createBrowserLiveSession(options: CreateBrowserLiveSessionOptions = {}): BrowserLiveSession {
  let node: SkypierBrowserNode | undefined;
  let retryTimer: ReturnType<typeof setInterval> | undefined;
  let relayKeepaliveTimer: ReturnType<typeof setInterval> | undefined;
  let relayCheckInterval: ReturnType<typeof setInterval> | undefined;
  let hadRelayReservation = false;
  let relayReservationKey = '';

  let state: BrowserLiveSessionState = {
    status: 'idle',
    connectedPeers: [],
    listenAddresses: [],
    protocols: [],
    queuedOutgoing: 0,
    relayPeerIds: [],
  };

  // Rehydrate persisted pending queue
  const queue: QueuedEnvelope[] = loadPendingQueue().map((entry) => ({
    peerId: entry.peerId,
    envelope: entry.envelope as WireEnvelope,
    retryCount: entry.retryCount,
    nextRetryAt: entry.nextRetryAt,
  }));

  const listeners = {
    state: new Set<(payload: BrowserLiveSessionState) => void>(),
    inbound: new Set<(payload: { fromPeerId: string; envelope: WireEnvelope }) => void>(),
    audioCallSignal: new Set<(payload: { fromPeerId: string; signal: AudioCallSignal }) => void>(),
    audioCallChunk: new Set<(payload: { fromPeerId: string; chunk: AudioCallChunk }) => void>(),
    peerReachability: new Set<(payload: PeerReachabilityEvent) => void>(),
    deliveryStatus: new Set<(payload: DeliveryStatusEvent) => void>(),
    remoteProfile: new Set<(payload: { peerId: string; profile: SharedPeerProfileMetadata }) => void>(),
    dialLog: new Set<(payload: DialLogEntry) => void>(),
  };

  const fetchedProfilePeers = new Set<string>();
  const profileFetchInFlight = new Set<string>();

  const redialInFlight = new Map<string, Promise<Awaited<ReturnType<SkypierBrowserNode['dial']>> | undefined>>();
  const redialCooldownUntil = new Map<string, number>();
  const ensureConnectionLogAt = new Map<string, number>();

  const REDIAL_COOLDOWN_MS = 2_500;
  const ENSURE_LOG_THROTTLE_MS = 2_000;
  /** Track peers with limited connections to trigger upgrade attempts */
  const limitedConnectionPeers = new Map<string, number>();

  const configuredRelayBootstrapCandidates = Array.from(new Set(
    (options.nodeOptions?.bootstrapMultiaddrs ?? [])
      .filter((addr) => !addr.includes('/dnsaddr/bootstrap.libp2p.io/'))
      .map((addr) => addr.replace(/\/p2p-circuit$/, ''))
      .filter((addr) => /\/p2p\/[^/]+$/.test(addr)),
  ));

  function relayAddressRank(address: string): number {
    if (address.includes('/tls/ws') || address.includes('/wss')) {
      return 0;
    }
    if (address.includes('/webtransport')) {
      return 1;
    }
    return 2;
  }

  const relayAddressByPeerId = new Map<string, string>();
  for (const address of configuredRelayBootstrapCandidates) {
    const peerId = extractPeerIdFromMultiaddr(address);
    if (!peerId) {
      continue;
    }

    const current = relayAddressByPeerId.get(peerId);
    if (!current || relayAddressRank(address) < relayAddressRank(current)) {
      relayAddressByPeerId.set(peerId, address);
    }
  }

  const configuredRelayBootstrapAddresses = Array.from(relayAddressByPeerId.values());

  const configuredRelayControlAddresses = configuredRelayBootstrapAddresses.filter(
    (address) => address.includes('/tls/ws') || address.includes('/wss') || address.includes('/ws'),
  );

  const configuredRelayDialAddresses = configuredRelayControlAddresses.length > 0
    ? configuredRelayControlAddresses
    : configuredRelayBootstrapAddresses;

  const configuredRelayAddresses = configuredRelayBootstrapAddresses.map((addr) =>
    addr.endsWith('/p2p-circuit') ? addr : `${addr}/p2p-circuit`,
  );

  const configuredRelayPeerIds = Array.from(new Set(
    configuredRelayAddresses
      .map((addr) => extractPeerIdFromMultiaddr(addr))
      .filter((peerId): peerId is string => peerId != null),
  ));

  const hardConnectionLimit = Math.max(2, options.nodeOptions?.maxConnections ?? 4);

  // ─── Helpers ───────────────────────────────────────────────────────────

  async function markAsChatPeer(peerIdString: string) {
    if (!node) return;
    try {
      const pid = peerIdFromString(peerIdString);
      await node.peerStore.merge(pid, {
        tags: {
          'chat-peer': { value: 100 }
        }
      });
    } catch (err) {
      console.warn('[skypier:session] failed to tag chat-peer', peerIdString, err);
    }
  }

  function persistQueue() {
    const entries: PersistedQueueEntry[] = queue.map((q) => ({
      peerId: q.peerId,
      messageId: q.envelope.messageId ?? '',
      envelope: q.envelope,
      retryCount: q.retryCount,
      nextRetryAt: q.nextRetryAt,
    }));
    savePendingQueue(entries);
  }

  function emitState() {
    state = {
      ...state,
      connectedPeers: node?.getConnections().map((c) => c.remotePeer.toString()) ?? [],
      listenAddresses: node?.getMultiaddrs().map((ma) => ma.toString()) ?? [],
      protocols: node?.getProtocols() ?? [],
      queuedOutgoing: queue.length,
      relayPeerIds: configuredRelayPeerIds,
    };

    listeners.state.forEach((handler) => handler(state));
  }

  function emitInbound(payload: { fromPeerId: string; envelope: WireEnvelope }) {
    listeners.inbound.forEach((handler) => handler(payload));
  }

  function emitAudioCallSignal(payload: { fromPeerId: string; signal: AudioCallSignal }) {
    listeners.audioCallSignal.forEach((handler) => handler(payload));
  }

  function emitAudioCallChunk(payload: { fromPeerId: string; chunk: AudioCallChunk }) {
    listeners.audioCallChunk.forEach((handler) => handler(payload));
  }

  function emitDeliveryStatus(payload: DeliveryStatusEvent) {
    listeners.deliveryStatus.forEach((handler) => handler(payload));
  }

  function emitDialLog(peerId: string, level: DialLogEntry['level'], message: string) {
    const entry: DialLogEntry = {
      peerId,
      level,
      message,
      timestamp: new Date().toISOString(),
    };
    listeners.dialLog.forEach((handler) => handler(entry));
  }

  function emitRemoteProfile(payload: { peerId: string; profile: SharedPeerProfileMetadata }) {
    listeners.remoteProfile.forEach((handler) => handler(payload));
  }

  function extractPeerIdFromMultiaddr(address: string): string | undefined {
    const match = address.match(/\/p2p\/([^/]+)(?:\/p2p-circuit)?$/);
    return match?.[1];
  }

  function getRelayReservationAddresses(): string[] {
    return node?.getMultiaddrs().map((ma) => ma.toString()).filter((addr) => addr.includes('/p2p-circuit')) ?? [];
  }

  function getPreferredRelayReservationAddresses(): string[] {
    const relayAddresses = getRelayReservationAddresses();
    if (configuredRelayPeerIds.length === 0) {
      return relayAddresses;
    }

    return relayAddresses.filter((addr) => configuredRelayPeerIds.some((peerId) => addr.includes(`/p2p/${peerId}/p2p-circuit`)));
  }

  function getRelayPeerIds(addresses: string[]): string[] {
    return Array.from(new Set(addresses.map((addr) => extractPeerIdFromMultiaddr(addr)).filter((peerId): peerId is string => peerId != null)));
  }

  function describeRelay(address: string): string {
    const peerId = extractPeerIdFromMultiaddr(address);
    if (peerId == null) {
      return address;
    }

    return peerId;
  }

  function getDefaultRelayLogPeerId(): string {
    return extractPeerIdFromMultiaddr(configuredRelayAddresses[0] ?? '') ?? 'relay';
  }

  function buildExplicitRelayDialAddresses(targetPeerId: string): string[] {
    if (targetPeerId.trim().length === 0) {
      return [];
    }

    return Array.from(new Set(
      configuredRelayDialAddresses.map((relayAddr) => {
        const normalizedRelayAddr = relayAddr.replace(/\/p2p-circuit$/, '');
        return `${normalizedRelayAddr}/p2p-circuit/p2p/${targetPeerId}`;
      }),
    ));
  }

  async function trimExcessConnections() {
    if (!node) return;

    const current = node.getConnections();
    if (current.length <= hardConnectionLimit) {
      return;
    }

    const relaySet = new Set(configuredRelayPeerIds);
    const candidates = current.filter((conn) => !relaySet.has(conn.remotePeer.toString()));
    const overflow = current.length - hardConnectionLimit;

    for (let i = 0; i < Math.min(overflow, candidates.length); i += 1) {
      const conn = candidates[i];
      try {
        const pid = conn.remotePeer.toString();
        await (conn as unknown as { close: () => Promise<void> }).close();
        console.log('[skypier:session] closed excess peer connection', pid, `(${i + 1}/${overflow})`);
      } catch {
        // ignore close failures
      }
    }

    emitState();
  }

  async function waitForPreferredRelayReservation(timeoutMs = RELAY_RESERVATION_WAIT_TIMEOUT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const activeRelayAddrs = syncRelayReservationState('keepalive');
      if (activeRelayAddrs.length > 0) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, RELAY_RESERVATION_POLL_INTERVAL_MS));
    }

    return false;
  }

  async function dialConfiguredRelays(reason: 'startup' | 'keepalive') {
    if (!node || configuredRelayDialAddresses.length === 0) {
      return;
    }

    for (const address of configuredRelayDialAddresses) {
      const relayPeerId = extractPeerIdFromMultiaddr(address) ?? 'relay';
      const alreadyConnected = relayPeerId !== 'relay'
        && node.getConnections().some((connection) => connection.remotePeer.toString() === relayPeerId);

      if (alreadyConnected) {
        emitDialLog(
          relayPeerId,
          'info',
          `${reason === 'startup' ? 'Relay control connection already active' : 'Relay control connection still active'} for ${describeRelay(address)}.`,
        );
        continue;
      }

      try {
        const relayAddr = multiaddr(address);
        emitDialLog(
          relayPeerId,
          'info',
          `${reason === 'startup' ? 'Dialing' : 'Re-dialing'} relay control connection ${describeRelay(address)}…`,
        );
        await node.dial(relayAddr);
        emitDialLog(relayPeerId, 'info', `Connected to ${describeRelay(address)}; waiting for reservation confirmation.`);
      } catch (error) {
        emitDialLog(
          relayPeerId,
          'warn',
          `${reason === 'startup' ? 'Could not dial' : 'Could not re-dial'} ${describeRelay(address)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }
  }

  function syncRelayReservationState(source: 'startup' | 'keepalive') {
    const relayAddresses = getRelayReservationAddresses();
    const preferredRelayAddresses = getPreferredRelayReservationAddresses();
    const activeRelayAddresses = preferredRelayAddresses.length > 0 ? preferredRelayAddresses : relayAddresses;
    const nextKey = activeRelayAddresses.slice().sort().join('|');

    if (activeRelayAddresses.length === 0) {
      if (hadRelayReservation) {
        emitDialLog(getDefaultRelayLogPeerId(), 'warn', 'Relay reservation disappeared; attempting to restore it.');
      }

      hadRelayReservation = false;
      relayReservationKey = '';
      return activeRelayAddresses;
    }

    if (configuredRelayPeerIds.length > 0 && preferredRelayAddresses.length === 0) {
      emitDialLog(
        getDefaultRelayLogPeerId(),
        'warn',
        'Preferred Skypier relay reservation is not active; using fallback relay reservation and continuing re-dial attempts.',
      );
    }

    if (!hadRelayReservation) {
      for (const address of activeRelayAddresses) {
        emitDialLog(
          extractPeerIdFromMultiaddr(address) ?? 'relay',
          'success',
          `${source === 'keepalive' ? 'Relay reservation restored' : 'Relay reservation active'} via ${describeRelay(address)}.`,
        );
      }
      emitDialLog(getDefaultRelayLogPeerId(), 'info', 'libp2p will auto-renew active relay reservations before expiry.');
    } else if (nextKey !== relayReservationKey) {
      const previous = new Set(relayReservationKey.split('|').filter(Boolean));
      for (const address of activeRelayAddresses) {
        if (!previous.has(address)) {
          emitDialLog(
            extractPeerIdFromMultiaddr(address) ?? 'relay',
            'success',
            `Additional relay reservation active via ${describeRelay(address)}.`,
          );
        }
      }
    }

    hadRelayReservation = true;
    relayReservationKey = nextKey;
    return activeRelayAddresses;
  }

  function enqueue(peerId: string, envelope: WireEnvelope, retryCount = 0, isLimited = false) {
    // Skip self-targeted messages
    if (peerId === state.localPeerId) return;

    // Deduplicate: don't queue the same messageId+peerId twice
    if (envelope.messageId && queue.some((q) => q.peerId === peerId && q.envelope.messageId === envelope.messageId)) {
      return;
    }

    // Enforce queue size limit to prevent memory exhaustion
    if (queue.length >= MAX_QUEUE_SIZE) {
      // Remove oldest non-critical messages first
      const oldestIdx = queue.findIndex((q) => q.envelope.kind === 'message');
      if (oldestIdx >= 0) {
        const removed = queue.splice(oldestIdx, 1)[0];
        console.warn('[skypier:session] ⚠ queue full — dropping oldest message:', removed.envelope.messageId);
        if (removed.envelope.messageId) {
          emitDeliveryStatus({ messageId: removed.envelope.messageId, status: 'failed' });
        }
      } else {
        // All are receipts/sync — drop oldest anyway
        const removed = queue.shift();
        if (removed) {
          console.warn('[skypier:session] ⚠ queue full — dropping oldest item:', removed.envelope.messageId);
        }
      }
    }

    // Use shorter delay for limited connection retries (upgrade may happen sooner)
    const delay = isLimited ? LIMITED_CONNECTION_RETRY_DELAY_MS : computeNextRetryDelay(retryCount);
    queue.push({
      peerId,
      envelope,
      retryCount,
      nextRetryAt: new Date(Date.now() + delay).toISOString(),
    });
    persistQueue();
    emitState();
  }

  function logEnsureConnection(
    peerId: string,
    bucket: 'dialing' | 'success' | 'failed' | 'cooldown' | 'node-not-ready',
    ...args: unknown[]
  ) {
    const key = `${bucket}:${peerId}`;
    const now = Date.now();
    const previous = ensureConnectionLogAt.get(key) ?? 0;
    if (now - previous < ENSURE_LOG_THROTTLE_MS) {
      return;
    }
    ensureConnectionLogAt.set(key, now);

    if (bucket === 'failed' || bucket === 'node-not-ready') {
      console.warn(...args);
    } else {
      console.log(...args);
    }
  }

  // ─── Send one envelope via length-prefixed stream ──────────────────────

  async function ensureConnectionToPeer(peerId: string) {
    // Guard: never send to ourselves
    if (peerId === state.localPeerId) {
      return null;
    }

    if (!node) {
      logEnsureConnection(peerId, 'node-not-ready', '[skypier:session] ensureConnectionToPeer: node not ready for', peerId);
      return undefined;
    }

    let connection = node.getConnections().find((c) => c.remotePeer.toString() === peerId);

    // No live connection — try to re-dial via the peer store / known addresses
    if (!connection) {
      const now = Date.now();
      const cooldownUntil = redialCooldownUntil.get(peerId) ?? 0;
      if (cooldownUntil > now) {
        logEnsureConnection(peerId, 'cooldown', '[skypier:session] ensureConnectionToPeer: skipping re-dial (cooldown) for', peerId);
        return undefined;
      }

      const existingDial = redialInFlight.get(peerId);
      if (existingDial) {
        connection = await existingDial;
        return connection;
      }

      const dialPromise = (async () => {
        try {
          const targetPeerId = peerIdFromString(peerId);
          logEnsureConnection(peerId, 'dialing', '[skypier:session] ensureConnectionToPeer: no connection to', peerId, '— attempting re-dial…');
          const dialed = await node!.dial(targetPeerId);
          redialCooldownUntil.delete(peerId);
          logEnsureConnection(peerId, 'success', '[skypier:session] ensureConnectionToPeer: re-dial ✓ connected to', peerId);
          emitState();
          return dialed;
        } catch (dialErr) {
          redialCooldownUntil.set(peerId, Date.now() + REDIAL_COOLDOWN_MS);
          logEnsureConnection(
            peerId,
            'failed',
            '[skypier:session] ensureConnectionToPeer: re-dial failed for',
            peerId,
            dialErr instanceof Error ? dialErr.message : dialErr,
          );
          return undefined;
        } finally {
          redialInFlight.delete(peerId);
        }
      })();

      redialInFlight.set(peerId, dialPromise);
      connection = await dialPromise;
    }

    return connection;
  }

  /**
   * Check if a connection is "limited" (relayed) which restricts stream creation.
   */
  function isConnectionLimited(connection: Awaited<ReturnType<SkypierBrowserNode['dial']>>): boolean {
    // libp2p marks relayed connections as "limited" — check the limits property
    const limits = (connection as { limits?: { bytes?: number; seconds?: number } }).limits;
    return limits != null || connection.remoteAddr?.toString().includes('/p2p-circuit');
  }

  /**
   * Attempt to upgrade a limited connection via DCUtR hole-punching.
   * Returns true if upgrade succeeded, false otherwise.
   */
  async function tryUpgradeLimitedConnection(peerId: string): Promise<boolean> {
    if (!node) return false;

    const lastAttempt = limitedConnectionPeers.get(peerId) ?? 0;
    const now = Date.now();

    // Don't retry upgrade too frequently
    if (now - lastAttempt < LIMITED_CONNECTION_RETRY_DELAY_MS) {
      return false;
    }

    limitedConnectionPeers.set(peerId, now);
    console.log('[skypier:session] 🔄 attempting DCUtR upgrade for', peerId);
    emitDialLog(peerId, 'info', 'Attempting direct connection upgrade (DCUtR hole-punching)…');

    try {
      // Force close existing limited connections to trigger fresh dial
      const connections = node.getConnections().filter((c) => c.remotePeer.toString() === peerId);
      for (const conn of connections) {
        if (isConnectionLimited(conn)) {
          await conn.close();
        }
      }

      // Wait briefly for DCUtR to upgrade, then re-dial
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Try to establish a new direct connection
      const targetPeerId = peerIdFromString(peerId);
      const newConnection = await Promise.race([
        node.dial(targetPeerId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), DCUTR_UPGRADE_TIMEOUT_MS)),
      ]);

      if (newConnection && !isConnectionLimited(newConnection)) {
        console.log('[skypier:session] ✓ DCUtR upgrade succeeded for', peerId);
        emitDialLog(peerId, 'success', 'Direct connection established via hole-punching.');
        limitedConnectionPeers.delete(peerId);
        return true;
      }
    } catch (err) {
      console.warn('[skypier:session] DCUtR upgrade failed for', peerId, err);
    }

    emitDialLog(peerId, 'warn', 'Direct connection upgrade failed; will retry via relay.');
    return false;
  }

  async function sendProtocolPayloadToPeer(peerId: string, protocol: string, payload: Uint8Array): Promise<true | false | 'unsupported' | 'limited'> {
    if (peerId === state.localPeerId) {
      return true;
    }

    const connection = await ensureConnectionToPeer(peerId);
    if (connection == null) {
      return connection === null ? true : false;
    }

    // Check if connection is limited — may need upgrade
    const connectionIsLimited = isConnectionLimited(connection);

    try {
      const stream = await connection.newStream(protocol);

      for await (const chunk of lp.encode([payload])) {
        stream.send(normalizeChunk(chunk));
      }

      await stream.close();
      void markAsChatPeer(peerId);

      // Connection worked — clear any limited status tracking
      if (!connectionIsLimited) {
        limitedConnectionPeers.delete(peerId);
      }

      return true;
    } catch (error) {
      const errName = (error as { name?: string })?.name ?? '';
      const errMsg = (error as { message?: string })?.message ?? '';

      if (errName === 'UnsupportedProtocolError') {
        return 'unsupported';
      }

      // Handle LimitedConnectionError specifically
      if (errName === 'LimitedConnectionError' || errMsg.includes('limited connection')) {
        console.warn('[skypier:session] ⚠ limited connection to', peerId, '— cannot open stream, will attempt upgrade');
        emitDialLog(peerId, 'warn', 'Connection is relay-limited; attempting direct connection upgrade.');

        // Try to upgrade in background, return 'limited' to trigger special retry
        void tryUpgradeLimitedConnection(peerId);
        return 'limited';
      }

      console.error('[skypier:session] ✗ failed to send protocol payload to', peerId, 'over', protocol, error);
      return false;
    }
  }

  async function sendEnvelopeToPeer(peerId: string, envelope: WireEnvelope): Promise<true | false | 'unsupported' | 'limited'> {
    const raw = serializeWireEnvelope(envelope);
    const result = await sendProtocolPayloadToPeer(peerId, SKYPIER_CHAT_PROTOCOLS.message, raw);

    if (result === true) {
      console.log('[skypier:session] ✓ sent envelope to', peerId, '— kind:', envelope.kind, 'msgId:', envelope.messageId, 'conv:', envelope.conversationId);

      if (envelope.messageId) {
        emitDeliveryStatus({ messageId: envelope.messageId, status: 'sent' });
      }
    } else if (result === 'limited') {
      console.log('[skypier:session] ↻ limited connection to', peerId, '— queueing for retry after upgrade attempt');
    }

    return result;
  }

  // ─── Send a delivery receipt (ACK) back to the sender ──────────────────

  async function sendReceiptToPeer(peerId: string, originalEnvelope: WireEnvelope) {
    const ackEnvelope: WireEnvelope = {
      kind: 'receipt',
      messageId: originalEnvelope.messageId,
      conversationId: originalEnvelope.conversationId,
      senderPeerId: state.localPeerId ?? 'unknown',
      sentAt: new Date().toISOString(),
      payload: 'delivered',
    };

    const result = await sendProtocolPayloadToPeer(peerId, SKYPIER_CHAT_PROTOCOLS.receipts, serializeWireEnvelope(ackEnvelope));
    if (result === true) {
      console.log('[skypier:session] ✓ sent ACK receipt for', originalEnvelope.messageId, 'to', peerId);
    } else if (result === false) {
      console.warn('[skypier:session] ✗ failed to send receipt to', peerId);
    }
  }

  async function sendSyncStateToPeer(peerId: string, requestedSince?: string, messages: SyncMessageEntry[] = []) {
    if (!node) return;

    const envelope: WireEnvelope = {
      kind: 'sync',
      messageId: `sync-state-${Date.now().toString(36)}`,
      conversationId: '__sync__',
      senderPeerId: state.localPeerId ?? 'unknown',
      sentAt: new Date().toISOString(),
      payload: JSON.stringify({
        type: 'state',
        generatedAt: new Date().toISOString(),
        requestedSince,
        connectedPeers: node.getConnections().length,
        queuedOutgoing: queue.length,
        hasPreferredRelayReservation: getPreferredRelayReservationAddresses().length > 0,
        messages: messages.length > 0 ? messages : undefined,
        preKeyBundle: options.getLocalPreKeyBundle?.(),
      } satisfies SyncPayload),
    };

    const sent = await sendEnvelopeToPeer(peerId, envelope);
    if (!sent) {
      emitDialLog(peerId, 'warn', 'Unable to send sync state response right now.');
    }
  }

  // ─── Read a full envelope from an inbound length-prefixed stream ───────

  function createTimeoutError(label: string): Error {
    const error = new Error(`${label} timed out`);
    (error as Error & { name: string }).name = 'TimeoutError';
    return error;
  }

  async function readFirstFrameFromStream(source: AsyncIterable<any>): Promise<Uint8Array> {
    for await (const chunk of lp.decode(source)) {
      return normalizeChunk(chunk);
    }
    return new Uint8Array();
  }

  async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(createTimeoutError(label));
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  async function readBytesFromStream(source: AsyncIterable<any>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];

    for await (const chunk of lp.decode(source)) {
      chunks.push(normalizeChunk(chunk));
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.byteLength;
    }
    return combined;
  }

  async function readEnvelopeFromStream(source: AsyncIterable<any>): Promise<WireEnvelope> {
    return deserializeWireEnvelope(await readFirstFrameFromStream(source));
  }

  async function readAudioCallSignalFromStream(source: AsyncIterable<any>): Promise<AudioCallSignal> {
    return JSON.parse(new TextDecoder().decode(await readFirstFrameFromStream(source))) as AudioCallSignal;
  }

  async function readAudioCallChunkFromStream(source: AsyncIterable<any>): Promise<AudioCallChunk> {
    return JSON.parse(new TextDecoder().decode(await readFirstFrameFromStream(source))) as AudioCallChunk;
  }

  async function requestMailboxProtocol<TResponse>(
    peerId: string,
    protocol: string,
    payload: unknown,
  ): Promise<TResponse | null> {
    const connection = await ensureConnectionToPeer(peerId);
    if (connection == null) {
      return null;
    }

    let stream: Awaited<ReturnType<typeof connection.newStream>> | undefined;
    try {
      stream = await connection.newStream(protocol);
      const encoded = new TextEncoder().encode(JSON.stringify(payload));
      for await (const chunk of lp.encode([encoded])) {
        stream.send(normalizeChunk(chunk));
      }
      await (stream as { closeWrite?: () => Promise<void> }).closeWrite?.();

      const responseBytes = await withTimeout(
        readFirstFrameFromStream(stream),
        REQUEST_RESPONSE_TIMEOUT_MS,
        `request ${protocol} response from ${peerId}`,
      );
      if (responseBytes.byteLength === 0) {
        return null;
      }

      return JSON.parse(new TextDecoder().decode(responseBytes)) as TResponse;
    } catch (error) {
      const errName = (error as { name?: string })?.name ?? '';
      if (errName !== 'UnsupportedProtocolError') {
        console.warn('[skypier:session] mailbox request failed for', protocol, 'peer', peerId, error);
      }
      return null;
    } finally {
      await stream?.close().catch(() => {});
    }
  }

  async function requestPeerProfileFromPeer(peerId: string): Promise<SharedPeerProfileMetadata | null> {
    const response = await requestMailboxProtocol<ProfileShareResponse>(
      peerId,
      SKYPIER_CHAT_PROTOCOLS.profile,
      { v: 1 } satisfies ProfileShareRequest,
    );

    if (!response || response.v !== 1 || !isSharedPeerProfileMetadata(response.profile)) {
      return null;
    }

    return {
      ...response.profile,
      // Always bind metadata to the actual peer we queried.
      peerId,
    };
  }

  async function maybeFetchPeerProfile(peerId: string): Promise<void> {
    if (!peerId || fetchedProfilePeers.has(peerId) || profileFetchInFlight.has(peerId)) {
      return;
    }

    profileFetchInFlight.add(peerId);
    try {
      const profile = await requestPeerProfileFromPeer(peerId);
      if (profile) {
        fetchedProfilePeers.add(peerId);
        emitRemoteProfile({ peerId, profile });
      }
    } finally {
      profileFetchInFlight.delete(peerId);
    }
  }

  // ─── Background retry loop with exponential back-off ───────────────────

  function startRetryLoop() {
    if (retryTimer != null) return;

    retryTimer = setInterval(async () => {
      if (!node || queue.length === 0) return;

      const now = Date.now();
      const due: QueuedEnvelope[] = [];
      const remaining: QueuedEnvelope[] = [];

      for (const item of queue) {
        if (new Date(item.nextRetryAt).getTime() <= now) {
          due.push(item);
        } else {
          remaining.push(item);
        }
      }

      if (due.length === 0) return;

      // Replace queue in-place
      queue.length = 0;
      queue.push(...remaining);

      for (const item of due) {
        if (item.retryCount >= MAX_RETRIES) {
          console.warn('[skypier:session] ✗ max retries reached for', item.envelope.messageId, '— giving up');
          if (item.envelope.messageId) {
            emitDeliveryStatus({ messageId: item.envelope.messageId, status: 'failed' });
          }
          continue;
        }

        const result = await sendEnvelopeToPeer(item.peerId, item.envelope);
        if (result === 'unsupported') {
          // Peer doesn't speak our protocol — drop permanently
          continue;
        }
        if (result === 'limited') {
          // Limited connection — use shorter retry delay, upgrade is being attempted
          const nextRetryCount = item.retryCount + 1;
          const delay = LIMITED_CONNECTION_RETRY_DELAY_MS;
          queue.push({
            peerId: item.peerId,
            envelope: item.envelope,
            retryCount: nextRetryCount,
            nextRetryAt: new Date(Date.now() + delay).toISOString(),
          });
          console.log('[skypier:session] ↻ limited retry', nextRetryCount, '/', MAX_RETRIES, 'for', item.envelope.messageId, '— next in', Math.round(delay / 1000), 's (upgrade pending)');
          continue;
        }
        if (!result) {
          const nextRetryCount = item.retryCount + 1;
          const delay = computeNextRetryDelay(nextRetryCount);
          queue.push({
            peerId: item.peerId,
            envelope: item.envelope,
            retryCount: nextRetryCount,
            nextRetryAt: new Date(Date.now() + delay).toISOString(),
          });
          console.log('[skypier:session] ↻ retry', nextRetryCount, '/', MAX_RETRIES, 'for', item.envelope.messageId, '— next in', Math.round(delay / 1000), 's');
        }
      }

      persistQueue();
      emitState();
    }, RETRY_TICK_INTERVAL_MS);
  }

  function stopRetryLoop() {
    if (retryTimer != null) {
      clearInterval(retryTimer);
      retryTimer = undefined;
    }
  }

  // ─── Relay reservation keepalive ───────────────────────────────────────
  // Runs every 30 s indefinitely. If no /p2p-circuit address is present the
  // reservation was lost (relay restarted, TTL expired, network blip) — re-dial
  // all bootstrap peers so the circuit-relay transport can reacquire it.

  function startRelayKeepalive() {
    if (relayKeepaliveTimer != null || configuredRelayDialAddresses.length === 0) return;

    relayKeepaliveTimer = setInterval(async () => {
      if (!node) return;

      const hasRelay = syncRelayReservationState('keepalive').length > 0;
      if (!hasRelay) {
        console.log('[skypier:session] 🔄 relay reservation gone — re-dialing bootstrap peers…');
        await dialConfiguredRelays('keepalive');
        emitState();
      }
    }, 15_000);
  }

  function stopRelayKeepalive() {
    if (relayKeepaliveTimer != null) {
      clearInterval(relayKeepaliveTimer);
      relayKeepaliveTimer = undefined;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────

  return {
    async start() {
      if (state.status === 'starting' || state.status === 'running') {
        return;
      }

      state = { ...state, status: 'starting', lastError: undefined };
      emitState();

      try {
        node = await createBrowserSkypierNode(options.nodeOptions);

        if (configuredRelayAddresses.length > 0) {
          for (const address of configuredRelayAddresses) {
            emitDialLog(
              extractPeerIdFromMultiaddr(address) ?? 'relay',
              'info',
              `Configured relay target ${describeRelay(address)}; requesting a reservation.`,
            );
          }
        }

        // ─── Register MESSAGE protocol handler ───────────────────────
        console.log('[skypier:session] registering protocol handler:', SKYPIER_CHAT_PROTOCOLS.message);
        await node.handle(SKYPIER_CHAT_PROTOCOLS.message, async (stream, connection) => {
          const fromPeerId = connection.remotePeer.toString();
          console.log('[skypier:session] ⇐ inbound stream from', fromPeerId);
          void markAsChatPeer(fromPeerId);
          void maybeFetchPeerProfile(fromPeerId);
          try {
            const envelope = await readEnvelopeFromStream(stream);
            console.log('[skypier:session] ⇐ received envelope from', fromPeerId, '— kind:', envelope.kind, 'msgId:', envelope.messageId, 'conv:', envelope.conversationId);
            emitInbound({ fromPeerId, envelope });

            if (envelope.kind === 'sync') {
              const syncPayload = tryParseSyncPayload(envelope.payload);
              if (syncPayload?.type === 'request') {
                emitDialLog(fromPeerId, 'info', 'Received sync request; responding with local network state.');
                await sendSyncStateToPeer(fromPeerId, syncPayload.requestedSince);
              } else if (syncPayload?.type === 'state') {
                emitDialLog(fromPeerId, 'info', 'Received sync state from peer.');
              }
            }

            // Send delivery receipt back
            if (envelope.kind === 'message' && envelope.messageId) {
              void sendReceiptToPeer(fromPeerId, envelope);
            }
          } catch (err) {
            console.error('[skypier:session] ✗ failed to read inbound stream from', fromPeerId, err);
          }
        });

        // ─── Register RECEIPTS protocol handler ──────────────────────
        console.log('[skypier:session] registering protocol handler:', SKYPIER_CHAT_PROTOCOLS.receipts);
        await node.handle(SKYPIER_CHAT_PROTOCOLS.receipts, async (stream, connection) => {
          const fromPeerId = connection.remotePeer.toString();
          try {
            const ackEnvelope = await readEnvelopeFromStream(stream);
            if (ackEnvelope.kind === 'receipt' && ackEnvelope.messageId) {
              console.log('[skypier:session] ⇐ ACK receipt for', ackEnvelope.messageId, 'from', fromPeerId);
              emitDeliveryStatus({ messageId: ackEnvelope.messageId, status: 'delivered' });
            }
          } catch (err) {
            console.error('[skypier:session] ✗ failed to read receipt stream from', fromPeerId, err);
          }
        });

        console.log('[skypier:session] registering protocol handler:', SKYPIER_CHAT_PROTOCOLS.callControl);
        await node.handle(SKYPIER_CHAT_PROTOCOLS.callControl, async (stream, connection) => {
          const fromPeerId = connection.remotePeer.toString();
          void markAsChatPeer(fromPeerId);
          void maybeFetchPeerProfile(fromPeerId);
          try {
            const signal = await readAudioCallSignalFromStream(stream);
            if (typeof signal?.type !== 'string' || typeof signal?.callId !== 'string') {
              throw new Error('Malformed audio call signal');
            }
            emitAudioCallSignal({ fromPeerId, signal });
          } catch (err) {
            console.error('[skypier:session] ✗ failed to read audio call signal from', fromPeerId, err);
          }
        });

        console.log('[skypier:session] registering protocol handler:', SKYPIER_CHAT_PROTOCOLS.callAudio);
        await node.handle(SKYPIER_CHAT_PROTOCOLS.callAudio, async (stream, connection) => {
          const fromPeerId = connection.remotePeer.toString();
          void markAsChatPeer(fromPeerId);
          void maybeFetchPeerProfile(fromPeerId);
          try {
            const chunk = await readAudioCallChunkFromStream(stream);
            if (typeof chunk?.callId !== 'string' || typeof chunk?.sequence !== 'number') {
              throw new Error('Malformed audio call chunk');
            }
            emitAudioCallChunk({ fromPeerId, chunk });
          } catch (err) {
            console.error('[skypier:session] ✗ failed to read audio call chunk from', fromPeerId, err);
          }
        });

        console.log('[skypier:session] registering protocol handler:', SKYPIER_CHAT_PROTOCOLS.profile);
        await node.handle(SKYPIER_CHAT_PROTOCOLS.profile, async (stream) => {
          try {
            const request = JSON.parse(new TextDecoder().decode(await readFirstFrameFromStream(stream))) as Partial<ProfileShareRequest>;
            if (request.v !== 1) {
              throw new Error('Malformed profile request');
            }

            const localProfile = options.getLocalProfileMetadata?.();
            if (!localProfile) {
              return;
            }

            const runtimePeerId = node?.peerId.toString();
            const sanitizedProfile = sanitizeSharedProfile(localProfile, runtimePeerId ?? localProfile.peerId);

            const response: ProfileShareResponse = {
              v: 1,
              profile: sanitizedProfile,
            };

            const encoded = new TextEncoder().encode(JSON.stringify(response));
            for await (const chunk of lp.encode([encoded])) {
              stream.send(normalizeChunk(chunk));
            }
          } catch (error) {
            console.warn('[skypier:session] failed to handle profile request', error);
          } finally {
            await (stream as { closeWrite?: () => Promise<void> }).closeWrite?.().catch(() => {});
            await stream.close().catch(() => {});
          }
        });

        // ─── Peer events ─────────────────────────────────────────────

        let seenPeerIds = new Set<string>();

        node.addEventListener?.('peer:connect', () => {
          const currentConns = node!.getConnections();
          for (const conn of currentConns) {
            const pid = conn.remotePeer.toString();
            if (!seenPeerIds.has(pid)) {
              seenPeerIds.add(pid);
              const reachability: 'direct' | 'relayed' = conn.remoteAddr
                .toString()
                .includes('/p2p-circuit')
                ? 'relayed'
                : 'direct';
              console.log('[skypier:session] peer:connect', pid, '→', reachability, 'addr:', conn.remoteAddr.toString());
              listeners.peerReachability.forEach((h) => h({ peerId: pid, reachability }));

              void maybeFetchPeerProfile(pid);
            }
          }
          void trimExcessConnections();
          emitState();
        });

        node.addEventListener?.('peer:disconnect', () => {
          const current = new Set(
            node!.getConnections().map((c) => c.remotePeer.toString()),
          );
          for (const pid of seenPeerIds) {
            if (!current.has(pid)) {
              console.log('[skypier:session] peer:disconnect', pid);
              listeners.peerReachability.forEach((h) =>
                h({ peerId: pid, reachability: 'offline' }),
              );
            }
          }
          seenPeerIds = current;
          emitState();
        });

        await node.start();

        state = {
          ...state,
          status: 'running',
          localPeerId: node.peerId.toString(),
          lastError: undefined,
        };

        // Purge any queued items targeting our own peerId (seeded/stale data)
        const selfId = state.localPeerId!;
        const before = queue.length;
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].peerId === selfId) queue.splice(i, 1);
        }
        if (queue.length !== before) {
          console.log('[skypier:session] purged', before - queue.length, 'self-targeted queue entries');
          persistQueue();
        }

        console.log('[skypier:session] ✓ node started — localPeerId:', node.peerId.toString());
        console.log('[skypier:session]   listen addrs:', node.getMultiaddrs().map((ma) => ma.toString()));
        emitState();

        if (configuredRelayDialAddresses.length > 0) {
          await dialConfiguredRelays('startup');
          emitState();
        }

        // Log relay discovery progress every 5 s until a reservation is acquired;
        // the relay keepalive loop then maintains it indefinitely after that.
        let relayProbeCount = 0;
        relayCheckInterval = setInterval(() => {
          if (!node) {
            clearInterval(relayCheckInterval);
            relayCheckInterval = undefined;
            return;
          }
          const addrs = node.getMultiaddrs().map((ma) => ma.toString());
          const relayAddrs = syncRelayReservationState('startup');
          const webrtcAddrs = addrs.filter((a) => a.includes('/webrtc'));
          const conns = node.getConnections().length;
          relayProbeCount += 1;
          console.log(
            `[skypier:session] 🔍 relay status: ${relayAddrs.length} relay addr(s), ${webrtcAddrs.length} webrtc addr(s), ${conns} connection(s)`,
          );
          if (relayAddrs.length === 0) {
            if (relayProbeCount === 1) {
              emitDialLog(getDefaultRelayLogPeerId(), 'info', 'Waiting for relay reservation to appear in announced listen addresses…');
            } else if (relayProbeCount % 6 === 0) {
              emitDialLog(getDefaultRelayLogPeerId(), 'warn', 'Still waiting for a relay reservation; keeping the relay control connection alive.');
            }
          }
          if (relayAddrs.length > 0) {
            console.log('[skypier:session] ✓ relay reservation acquired:', relayAddrs[0]);
            emitState(); // update UI with new listen addresses
            clearInterval(relayCheckInterval);
            relayCheckInterval = undefined;
          }
        }, 5_000);

        // Start background retry loop & flush any queued items
        startRetryLoop();
        startRelayKeepalive();
        await this.flushQueue();
      } catch (error) {
        state = {
          ...state,
          status: 'error',
          lastError: error instanceof Error ? error.message : 'Failed to start session',
        };
        emitState();
      }
    },

    async stop() {
      stopRetryLoop();
      stopRelayKeepalive();
      if (relayCheckInterval != null) {
        clearInterval(relayCheckInterval);
        relayCheckInterval = undefined;
      }

      if (!node) {
        state = { ...state, status: 'stopped' };
        emitState();
        return;
      }

      await node.stop();
      node = undefined;
      state = {
        ...state,
        status: 'stopped',
        connectedPeers: [],
      };
      persistQueue();
      emitState();
    },

    async recoverConnectivity(reason = 'resume') {
      if (state.status === 'starting') {
        return;
      }

      if (state.status === 'idle' || state.status === 'stopped' || !node) {
        emitDialLog(getDefaultRelayLogPeerId(), 'info', `Recovery (${reason}): starting live session…`);
        await this.start();
        return;
      }

      if (state.status !== 'running') {
        return;
      }

      emitDialLog(getDefaultRelayLogPeerId(), 'info', `Recovery (${reason}): re-checking relay reservation and flushing queue…`);
      await dialConfiguredRelays('keepalive');
      syncRelayReservationState('keepalive');
      await this.flushQueue();
      await this.requestSyncWithConnectedPeers('resume');
      emitState();
    },

    async requestSyncWithConnectedPeers(reason = 'manual') {
      if (!node || state.status !== 'running') {
        return 0;
      }

      const peers = Array.from(new Set(
        node.getConnections()
          .map((connection) => connection.remotePeer.toString())
          .filter((peerId) => peerId !== state.localPeerId),
      ));

      if (peers.length === 0) {
        return 0;
      }

      let sentCount = 0;
      const requestedSince = new Date(Date.now() - 10 * 60_000).toISOString();

      for (const peerId of peers) {
        const envelope: WireEnvelope = {
          kind: 'sync',
          messageId: `sync-req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          conversationId: '__sync__',
          senderPeerId: state.localPeerId ?? 'unknown',
          sentAt: new Date().toISOString(),
          payload: JSON.stringify({
            type: 'request',
            generatedAt: new Date().toISOString(),
            requestedSince,
            preKeyBundle: options.getLocalPreKeyBundle?.(),
          } satisfies SyncPayload),
        };

        const result = await sendEnvelopeToPeer(peerId, envelope);
        if (result === true) {
          sentCount += 1;
        }
      }

      emitDialLog(getDefaultRelayLogPeerId(), 'info', `Sync request (${reason}) sent to ${sentCount}/${peers.length} connected peers.`);
      return sentCount;
    },

    async respondToSyncRequest(peerId: string, messages: SyncMessageEntry[], requestedSince?: string) {
      if (messages.length === 0) return;
      emitDialLog(peerId, 'info', `Responding to sync request with ${messages.length} message(s) since ${requestedSince ?? 'all time'}.`);
      await sendSyncStateToPeer(peerId, requestedSince, messages);
    },

    async dialPeer(address: string) {
      if (!node) {
        throw new Error('Session is not running. Start the session first.');
      }

      const connection = await node.dial(multiaddr(address));
      const peerId = connection.remotePeer.toString();
      emitState();
      await this.flushQueue();
      return peerId;
    },

    async dialPeerById(peerIdString: string) {
      if (!node) {
        throw new Error('Session is not running. Start the session first.');
      }

      const normalizedPeerId = peerIdString.trim();
      const targetPeerId = peerIdFromString(normalizedPeerId);

      try {
        console.log('[skypier:session] dialPeerById: attempting direct dial to', normalizedPeerId);
        emitDialLog(normalizedPeerId, 'info', 'Attempting direct dial via known addresses...');
        const connection = await node.dial(targetPeerId);
        const peerId = connection.remotePeer.toString();
        console.log('[skypier:session] dialPeerById: ✓ connected to', peerId);
        emitDialLog(normalizedPeerId, 'success', 'Direct connection established!');
        emitState();
        await this.flushQueue();
        return peerId;
      } catch (directErr) {
        console.warn('[skypier:session] dialPeerById: direct dial failed, checking explicit relay routes…', directErr instanceof Error ? directErr.message : directErr);
        emitDialLog(normalizedPeerId, 'warn', `Direct dial failed: ${directErr instanceof Error ? directErr.message : 'Unknown'}. Trying configured relay route...`);
      }

      const explicitRelayDialAddresses = buildExplicitRelayDialAddresses(normalizedPeerId);
      if (explicitRelayDialAddresses.length > 0) {
        try {
          await dialConfiguredRelays('keepalive');

          const hasPreferredReservation = await waitForPreferredRelayReservation();
          if (!hasPreferredReservation) {
            emitDialLog(
              normalizedPeerId,
              'warn',
              'Preferred relay reservation is not active yet; attempting explicit relay route anyway.',
            );
          } else {
            emitDialLog(normalizedPeerId, 'info', 'Preferred relay reservation confirmed; dialing explicit relay route.');
          }

          let lastExplicitRelayError: unknown;
          for (const relayDialAddress of explicitRelayDialAddresses) {
            try {
              emitDialLog(
                normalizedPeerId,
                'info',
                `Trying explicit relay route: ${relayDialAddress}`,
              );
              const connection = await node.dial(multiaddr(relayDialAddress));
              const peerId = connection.remotePeer.toString();
              console.log('[skypier:session] dialPeerById: ✓ connected via explicit relay route to', peerId, 'route:', relayDialAddress);
              emitDialLog(normalizedPeerId, 'success', 'Connected via configured relay reservation route!');
              emitState();
              await this.flushQueue();
              return peerId;
            } catch (relayDialErr) {
              lastExplicitRelayError = relayDialErr;
              emitDialLog(
                normalizedPeerId,
                'warn',
                `Explicit relay route failed: ${relayDialErr instanceof Error ? relayDialErr.message : 'Unknown error'}`,
              );
            }
          }

          if (lastExplicitRelayError != null) {
            console.warn(
              '[skypier:session] dialPeerById: explicit relay route failed for',
              normalizedPeerId,
              lastExplicitRelayError instanceof Error ? lastExplicitRelayError.message : lastExplicitRelayError,
            );
          }
        } catch (explicitRelayErr) {
          emitDialLog(
            normalizedPeerId,
            'warn',
            `Configured relay preparation failed: ${explicitRelayErr instanceof Error ? explicitRelayErr.message : 'Unknown error'}`,
          );
        }
      }

      try {
        const peerInfo = await node.peerRouting.findPeer(targetPeerId);
        const addrs = peerInfo?.multiaddrs ?? [];

        if (addrs.length === 0) {
          emitDialLog(normalizedPeerId, 'error', 'Peer found in DHT but returned no dialable addresses.');
          throw new Error('Peer was found in DHT but has no dialable addresses.');
        }

        console.log('[skypier:session] dialPeerById: found', addrs.length, 'addresses via DHT, dialing…');
        emitDialLog(normalizedPeerId, 'info', `Found ${addrs.length} addresses in DHT. Testing candidates...`);

        // Dial each address individually — relay circuit addresses embed
        // different relay peer IDs, so passing them all to a single dial()
        // triggers "Multiaddrs must all have the same peer id".
        let lastErr: unknown;
        for (const addr of addrs) {
          try {
            const addrStr = addr.toString();
            console.log('[skypier:session] dialPeerById: trying', addrStr);
            emitDialLog(normalizedPeerId, 'info', `Trying: ${addrStr}`);
            const connection = await node.dial(addr);
            const peerId = connection.remotePeer.toString();
            console.log('[skypier:session] dialPeerById: ✓ connected to', peerId, 'via DHT');
            emitDialLog(normalizedPeerId, 'success', `Connected via ${addrStr.includes('p2p-circuit') ? 'Relay' : 'Direct path'}!`);
            emitState();
            await this.flushQueue();
            return peerId;
          } catch (addrErr) {
            console.warn('[skypier:session] dialPeerById: addr failed:', addr.toString(), addrErr instanceof Error ? addrErr.message : addrErr);
            emitDialLog(normalizedPeerId, 'warn', `Route failed: ${addrErr instanceof Error ? addrErr.message : 'Unknown'}`);
            lastErr = addrErr;
          }
        }

        throw lastErr ?? new Error('All DHT addresses failed');
      } catch (routingErr) {
        const msg = routingErr instanceof Error ? routingErr.message : 'Unknown error';
        console.error('[skypier:session] dialPeerById: ✗ all dial attempts failed for', normalizedPeerId, msg);
        throw new Error(`Could not reach peer ${normalizedPeerId.slice(0, 16)}…: ${msg}`);
      }
    },

    async sendEnvelopeToConnected(envelope: WireEnvelope) {
      if (!node) return 0;

      const connections = node.getConnections();
      const skypierPeers: string[] = [];

      // Filter connections to only those that (likely) support our protocol
      for (const conn of connections) {
        const pid = conn.remotePeer.toString();
        if (pid === state.localPeerId) continue;
        
        try {
          const peerData = await node.peerStore.get(conn.remotePeer);
          if (peerData.protocols.includes(SKYPIER_CHAT_PROTOCOLS.message)) {
            skypierPeers.push(pid);
          }
        } catch {
          // If protocol info isn't available yet, we could opt to skip or try anyway.
          // For broadcast, we'll be conservative to avoid spamming infrastructure.
        }
      }

      if (skypierPeers.length === 0) {
        console.log('[skypier:session] broadcast: no skypier-compatible peers found among', connections.length, 'connections');
        return 0;
      }

      console.log('[skypier:session] broadcasting envelope to', skypierPeers.length, 'skypier peers');

      let sentCount = 0;
      for (const peerId of skypierPeers) {
        const result = await sendEnvelopeToPeer(peerId, envelope);
        if (result === true) {
          sentCount++;
        } else if (result === 'limited') {
          // Limited connection — queue with shorter retry timing
          enqueue(peerId, envelope, 0, true);
        } else if (result !== 'unsupported') {
          // Transient failure — queue for retry
          enqueue(peerId, envelope);
        }
      }

      emitState();
      return sentCount;
    },

    async sendChatMessageToConnected(message: ChatMessage) {
      const envelope: WireEnvelope = {
        kind: 'message',
        messageId: message.id,
        conversationId: message.conversationId,
        senderPeerId: state.localPeerId ?? 'unknown',
        sentAt: new Date().toISOString(),
        payload: buildEnvelopePayload(message),
      };

      return await this.sendEnvelopeToConnected(envelope);
    },

    async sendChatMessageToPeer(message: ChatMessage, targetPeerId: string) {
      const envelope: WireEnvelope = {
        kind: 'message',
        messageId: message.id,
        conversationId: message.conversationId,
        senderPeerId: state.localPeerId ?? 'unknown',
        sentAt: new Date().toISOString(),
        payload: buildEnvelopePayload(message),
      };

      console.log('[skypier:session] sending message to specific peer', targetPeerId, 'conv:', message.conversationId, 'msgId:', message.id);
      const result = await sendEnvelopeToPeer(targetPeerId, envelope);
      if (result === false) {
        enqueue(targetPeerId, envelope);
      } else if (result === 'limited') {
        // Queue with limited flag for shorter retry timing
        enqueue(targetPeerId, envelope, 0, true);
      }
      return result === true;
    },

    async requestPeerProfile(targetPeerId: string) {
      const profile = await requestPeerProfileFromPeer(targetPeerId);
      if (profile) {
        emitRemoteProfile({ peerId: targetPeerId, profile });
      }
      return profile;
    },

    async enqueueMailboxForPeer(message: ChatMessage, targetPeerId: string) {
      if (!message.ciphertext.keyWraps || message.ciphertext.keyWraps.length === 0) {
        return false;
      }

      if (configuredRelayPeerIds.length === 0) {
        console.warn('[skypier:session] enqueueMailboxForPeer: no relay peer configured — cannot store message for', targetPeerId);
        return false;
      }

      const now = Date.now();
      const sentAt = new Date(now).toISOString();
      const expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
      const request: MailboxEnqueueRequest = {
        envelope: {
          envelopeId: `mbx-${message.id}`,
          messageId: message.id,
          conversationId: message.conversationId,
          senderPeerId: state.localPeerId ?? 'unknown',
          recipientPeerId: targetPeerId,
          sentAt,
          expiresAt,
          contentType: 'chat-envelope',
          encryptedEnvelope: {
            v: 1,
            algorithm: message.ciphertext.algorithm,
            ciphertext: message.ciphertext.ciphertext,
            nonce: message.ciphertext.nonce,
            senderKeyId: message.ciphertext.senderKeyId ?? message.senderDeviceId,
            aad: message.ciphertext.aad,
            keyWraps: message.ciphertext.keyWraps,
          },
        },
      };

      // Connect to each configured relay (NOT the offline recipient) and ask it
      // to store the message. The relay validates sender == connecting peer and
      // indexes the envelope under recipientPeerId.
      for (const relayPeerId of configuredRelayPeerIds) {
        const response = await requestMailboxProtocol<MailboxEnqueueResponse>(
          relayPeerId,
          SKYPIER_CHAT_PROTOCOLS.mailboxEnqueue,
          request,
        );
        if (response?.accepted === true) {
          console.log('[skypier:session] ✓ mailbox enqueue accepted by relay', relayPeerId, 'for recipient', targetPeerId);
          return true;
        }
      }

      console.warn('[skypier:session] mailbox enqueue rejected by all configured relays for recipient', targetPeerId);
      return false;
    },

    async pullMailboxFromPeer(targetPeerId: string, limit = 50, afterCursor?: string) {
      const request: MailboxPullRequest = {
        recipientPeerId: state.localPeerId ?? '',
        limit,
        ...(afterCursor ? { afterCursor } : {}),
      };
      return await requestMailboxProtocol<MailboxPullResponse>(
        targetPeerId,
        SKYPIER_CHAT_PROTOCOLS.mailboxPull,
        request,
      );
    },

    async ackMailboxFromPeer(targetPeerId: string, envelopeIds: string[]) {
      if (envelopeIds.length === 0) {
        return { acked: [], missing: [] } satisfies MailboxAckResponse;
      }

      const request: MailboxAckRequest = {
        recipientPeerId: state.localPeerId ?? '',
        envelopeIds,
      };
      return await requestMailboxProtocol<MailboxAckResponse>(
        targetPeerId,
        SKYPIER_CHAT_PROTOCOLS.mailboxAck,
        request,
      );
    },

    async sendAudioCallSignal(signal: AudioCallSignal, targetPeerId: string) {
      const normalizedSignal: AudioCallSignal = {
        ...signal,
        fromPeerId: signal.fromPeerId || state.localPeerId || 'unknown',
        sentAt: signal.sentAt || new Date().toISOString(),
      };

      const payload = new TextEncoder().encode(JSON.stringify(normalizedSignal));
      const result = await sendProtocolPayloadToPeer(targetPeerId, SKYPIER_CHAT_PROTOCOLS.callControl, payload);
      if (result === false) {
        emitDialLog(targetPeerId, 'warn', `Audio call signal ${normalizedSignal.type} could not be delivered.`);
      }
      return result === true;
    },

    async sendAudioCallChunk(chunk: AudioCallChunk, targetPeerId: string) {
      const normalizedChunk: AudioCallChunk = {
        ...chunk,
        fromPeerId: chunk.fromPeerId || state.localPeerId || 'unknown',
        sentAt: chunk.sentAt || new Date().toISOString(),
      };

      const payload = new TextEncoder().encode(JSON.stringify(normalizedChunk));
      const result = await sendProtocolPayloadToPeer(targetPeerId, SKYPIER_CHAT_PROTOCOLS.callAudio, payload);
      if (result === false) {
        emitDialLog(targetPeerId, 'warn', `Audio chunk ${normalizedChunk.sequence} for call ${normalizedChunk.callId} could not be delivered.`);
      }
      return result === true;
    },

    async retryMessage(messageId: string) {
      const idx = queue.findIndex((q) => q.envelope.messageId === messageId);
      if (idx === -1) {
        console.warn('[skypier:session] retryMessage: no queued item for', messageId);
        return false;
      }

      const item = queue.splice(idx, 1)[0];
      const result = await sendEnvelopeToPeer(item.peerId, item.envelope);
      if (result === false) {
        // Re-enqueue with reset retryCount = 0 (user-triggered manual retry)
        enqueue(item.peerId, item.envelope, 0);
      } else if (result === 'limited') {
        // Limited connection — queue with shorter retry timing
        enqueue(item.peerId, item.envelope, 0, true);
      }
      persistQueue();
      emitState();
      return result === true;
    },

    async flushQueue() {
      if (!node || queue.length === 0) {
        emitState();
        return 0;
      }

      const pending = queue.splice(0, queue.length);
      let sentCount = 0;

      for (const item of pending) {
        const result = await sendEnvelopeToPeer(item.peerId, item.envelope);
        if (result === true) {
          sentCount += 1;
        } else if (result === 'limited') {
          // Limited connection — re-queue with shorter retry, don't count retry
          queue.push({
            ...item,
            nextRetryAt: new Date(Date.now() + LIMITED_CONNECTION_RETRY_DELAY_MS).toISOString(),
          });
        } else if (result === false) {
          queue.push(item);
        }
        // 'unsupported' → silently drop
      }

      persistQueue();
      emitState();
      return sentCount;
    },

    getState() {
      return state;
    },

    getDebugInfo(): NetworkDebugSnapshot | null {
      if (!node) return null;

      const classifyTransport = (addr: string): ConnectionDebugInfo['transportType'] => {
        if (addr.includes('/webrtc/')) return 'webrtc';
        if (addr.includes('/p2p-circuit')) return 'relay';
        if (addr.includes('/ws/') || addr.includes('/wss/') || addr.endsWith('/ws') || addr.endsWith('/wss')) return 'websocket';
        return 'other';
      };

      const connections: ConnectionDebugInfo[] = node.getConnections().map((c) => {
        const addrStr = c.remoteAddr.toString();
        return {
          remotePeerId: c.remotePeer.toString(),
          remoteAddr: addrStr,
          direction: c.direction,
          status: c.status,
          transportType: classifyTransport(addrStr),
        };
      });

      const listenAddrs = node.getMultiaddrs().map((ma) => ma.toString());
      const relayListenAddresses = listenAddrs.filter((a) => a.includes('/p2p-circuit'));

      return {
        peerId: node.peerId.toString(),
        connections,
        listenAddresses: listenAddrs,
        hasRelayReservation: relayListenAddresses.length > 0,
        relayListenAddresses,
        relayPeerIds: getRelayPeerIds(relayListenAddresses),
        configuredRelayAddresses,
        hasWebRTCAddress: listenAddrs.some((a) => a.includes('/webrtc')),
        totalConnections: connections.length,
        relayedConnections: connections.filter((c) => c.transportType === 'relay').length,
        directConnections: connections.filter((c) => c.transportType !== 'relay').length,
      };
    },

    subscribe(event, handler) {
      const targetListeners = listeners[event as keyof typeof listeners] as Set<(payload: unknown) => void>;
      targetListeners.add(handler as unknown as (payload: unknown) => void);
      return () => {
        targetListeners.delete(handler as unknown as (payload: unknown) => void);
      };
    },
  };
}

function normalizeChunk(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }

  if (chunk != null && typeof chunk === 'object' && 'subarray' in chunk) {
    return (chunk as { subarray: () => Uint8Array }).subarray();
  }

  throw new Error('Unsupported inbound stream chunk type');
}