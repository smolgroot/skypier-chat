import { multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
import * as lp from 'it-length-prefixed';
import type { ChatMessage } from '@skypier/protocol';
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
}

export interface BrowserLiveSessionEventMap {
  state: BrowserLiveSessionState;
  inbound: {
    fromPeerId: string;
    envelope: WireEnvelope;
  };
  peerReachability: PeerReachabilityEvent;
  deliveryStatus: DeliveryStatusEvent;
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
}

// ─── Retry constants ─────────────────────────────────────────────────────
const MAX_RETRIES = 50;
/** Base delay in ms for the first retry (doubles each attempt, capped) */
const BASE_RETRY_DELAY_MS = 2_000;
/** Maximum delay between retries (5 min) */
const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;
/** How often the background loop ticks (10 s) */
const RETRY_TICK_INTERVAL_MS = 10_000;

function computeNextRetryDelay(retryCount: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, retryCount), MAX_RETRY_DELAY_MS);
}

export interface CreateBrowserLiveSessionOptions {
  nodeOptions?: CreateBrowserSkypierNodeOptions;
}

// ─── Media prefix ─────────────────────────────────────────────────────────────
/** Prefix placed in WireEnvelope.payload for image messages. */
export const SKYPIER_MEDIA_PREFIX = 'skypier:img:';

/** Serialise a ChatMessage into a wire payload string. */
function buildEnvelopePayload(message: ChatMessage): string {
  if (message.attachments?.length) {
    return SKYPIER_MEDIA_PREFIX + JSON.stringify(message.attachments[0]);
  }
  return message.previewText;
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

export function createBrowserLiveSession(options: CreateBrowserLiveSessionOptions = {}): BrowserLiveSession {
  let node: SkypierBrowserNode | undefined;
  let retryTimer: ReturnType<typeof setInterval> | undefined;
  let relayKeepaliveTimer: ReturnType<typeof setInterval> | undefined;
  let hadRelayReservation = false;
  let relayReservationKey = '';

  let state: BrowserLiveSessionState = {
    status: 'idle',
    connectedPeers: [],
    listenAddresses: [],
    protocols: [],
    queuedOutgoing: 0,
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
    peerReachability: new Set<(payload: PeerReachabilityEvent) => void>(),
    deliveryStatus: new Set<(payload: DeliveryStatusEvent) => void>(),
    dialLog: new Set<(payload: DialLogEntry) => void>(),
  };

  const configuredRelayAddresses = Array.from(new Set(
    (options.nodeOptions?.bootstrapMultiaddrs ?? [])
      .filter((addr) => !addr.includes('/dnsaddr/bootstrap.libp2p.io/'))
      .map((addr) => addr.endsWith('/p2p-circuit') ? addr : `${addr}/p2p-circuit`),
  ));

  const configuredRelayBootstrapAddresses = Array.from(new Set(
    (options.nodeOptions?.bootstrapMultiaddrs ?? [])
      .filter((addr) => !addr.includes('/dnsaddr/bootstrap.libp2p.io/'))
      .map((addr) => addr.replace(/\/p2p-circuit$/, '')),
  ));

  const configuredRelayPeerIds = Array.from(new Set(
    configuredRelayAddresses
      .map((addr) => extractPeerIdFromMultiaddr(addr))
      .filter((peerId): peerId is string => peerId != null),
  ));

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
    };

    listeners.state.forEach((handler) => handler(state));
  }

  function emitInbound(payload: { fromPeerId: string; envelope: WireEnvelope }) {
    listeners.inbound.forEach((handler) => handler(payload));
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

    return `${peerId.slice(0, 12)}…`;
  }

  function getDefaultRelayLogPeerId(): string {
    return extractPeerIdFromMultiaddr(configuredRelayAddresses[0] ?? '') ?? 'relay';
  }

  async function dialConfiguredRelays(reason: 'startup' | 'keepalive') {
    if (!node || configuredRelayBootstrapAddresses.length === 0) {
      return;
    }

    for (const address of configuredRelayBootstrapAddresses) {
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
        emitDialLog(
          relayPeerId,
          'info',
          `${reason === 'startup' ? 'Dialing' : 'Re-dialing'} relay control connection ${describeRelay(address)}…`,
        );
        await node.dial(multiaddr(address));
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
        'A relay reservation exists, but not on the preferred Skypier relay; restoring preferred reservation.',
      );
      hadRelayReservation = false;
      relayReservationKey = '';
      return [];
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

  function enqueue(peerId: string, envelope: WireEnvelope, retryCount = 0) {
    // Skip self-targeted messages
    if (peerId === state.localPeerId) return;

    // Deduplicate: don't queue the same messageId+peerId twice
    if (envelope.messageId && queue.some((q) => q.peerId === peerId && q.envelope.messageId === envelope.messageId)) {
      return;
    }

    const delay = computeNextRetryDelay(retryCount);
    queue.push({
      peerId,
      envelope,
      retryCount,
      nextRetryAt: new Date(Date.now() + delay).toISOString(),
    });
    persistQueue();
    emitState();
  }

  // ─── Send one envelope via length-prefixed stream ──────────────────────

  async function sendEnvelopeToPeer(peerId: string, envelope: WireEnvelope): Promise<true | false | 'unsupported'> {
    // Guard: never send to ourselves
    if (peerId === state.localPeerId) {
      return true; // treat as "sent" — nothing to do
    }

    if (!node) {
      console.warn('[skypier:session] sendEnvelopeToPeer: node not ready for', peerId);
      return false;
    }

    let connection = node.getConnections().find((c) => c.remotePeer.toString() === peerId);

    // No live connection — try to re-dial via the peer store / known addresses
    if (!connection) {
      try {
        const targetPeerId = peerIdFromString(peerId);
        console.log('[skypier:session] sendEnvelopeToPeer: no connection to', peerId, '— attempting re-dial…');
        connection = await node.dial(targetPeerId);
        console.log('[skypier:session] sendEnvelopeToPeer: re-dial ✓ connected to', peerId);
        emitState();
      } catch (dialErr) {
        console.warn('[skypier:session] sendEnvelopeToPeer: re-dial failed for', peerId, dialErr instanceof Error ? dialErr.message : dialErr);
        return false;
      }
    }

    try {
      // 1) Open a fresh stream on the message protocol
      const stream = await connection.newStream(SKYPIER_CHAT_PROTOCOLS.message);

      // 2) Length-prefix encode the serialized envelope
      const raw = serializeWireEnvelope(envelope);
      for await (const chunk of lp.encode([raw])) {
        stream.send(normalizeChunk(chunk));
      }

      // 3) Close the stream gracefully
      await stream.close();

      console.log('[skypier:session] ✓ sent envelope to', peerId, '— kind:', envelope.kind, 'msgId:', envelope.messageId, 'conv:', envelope.conversationId);
      
      void markAsChatPeer(peerId);

      // Mark as sent
      if (envelope.messageId) {
        emitDeliveryStatus({ messageId: envelope.messageId, status: 'sent' });
      }

      return true;
    } catch (error) {
      // UnsupportedProtocolError means the remote peer doesn't speak our
      // protocol — it's a DHT/relay/bootstrap node, not a Skypier peer.
      // Don't spam the log and mark it so callers don't retry.
      const errName = (error as { name?: string })?.name ?? '';
      if (errName === 'UnsupportedProtocolError') {
        return 'unsupported';
      }
      console.error('[skypier:session] ✗ failed to send to', peerId, error);
      return false;
    }
  }

  // ─── Send a delivery receipt (ACK) back to the sender ──────────────────

  async function sendReceiptToPeer(peerId: string, originalEnvelope: WireEnvelope) {
    if (!node) return;

    const connection = node.getConnections().find((c) => c.remotePeer.toString() === peerId);
    if (!connection) return;

    const ackEnvelope: WireEnvelope = {
      kind: 'receipt',
      messageId: originalEnvelope.messageId,
      conversationId: originalEnvelope.conversationId,
      senderPeerId: state.localPeerId ?? 'unknown',
      sentAt: new Date().toISOString(),
      payload: 'delivered',
    };

    try {
      const stream = await connection.newStream(SKYPIER_CHAT_PROTOCOLS.receipts);
      const raw = serializeWireEnvelope(ackEnvelope);
      for await (const chunk of lp.encode([raw])) {
        stream.send(normalizeChunk(chunk));
      }
      await stream.close();
      console.log('[skypier:session] ✓ sent ACK receipt for', originalEnvelope.messageId, 'to', peerId);
    } catch (err) {
      console.warn('[skypier:session] ✗ failed to send receipt to', peerId, err);
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
      } satisfies SyncPayload),
    };

    const sent = await sendEnvelopeToPeer(peerId, envelope);
    if (!sent) {
      emitDialLog(peerId, 'warn', 'Unable to send sync state response right now.');
    }
  }

  // ─── Read a full envelope from an inbound length-prefixed stream ───────

  async function readEnvelopeFromStream(source: AsyncIterable<any>): Promise<WireEnvelope> {
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
    return deserializeWireEnvelope(combined);
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
    if (relayKeepaliveTimer != null || configuredRelayBootstrapAddresses.length === 0) return;

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
            }
          }
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

        if (configuredRelayBootstrapAddresses.length > 0) {
          await dialConfiguredRelays('startup');
          emitState();
        }

        // Log relay discovery progress every 5 s until a reservation is acquired;
        // the relay keepalive loop then maintains it indefinitely after that.
        let relayProbeCount = 0;
        const relayCheckInterval = setInterval(() => {
          if (!node) {
            clearInterval(relayCheckInterval);
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

      const targetPeerId = peerIdFromString(peerIdString.trim());

      try {
        console.log('[skypier:session] dialPeerById: attempting direct dial to', peerIdString);
        emitDialLog(peerIdString, 'info', 'Attempting direct dial via known addresses...');
        const connection = await node.dial(targetPeerId);
        const peerId = connection.remotePeer.toString();
        console.log('[skypier:session] dialPeerById: ✓ connected to', peerId);
        emitDialLog(peerIdString, 'success', 'Direct connection established!');
        emitState();
        await this.flushQueue();
        return peerId;
      } catch (directErr) {
        console.warn('[skypier:session] dialPeerById: direct dial failed, trying peer routing…', directErr instanceof Error ? directErr.message : directErr);
        emitDialLog(peerIdString, 'warn', `Direct dial failed: ${directErr instanceof Error ? directErr.message : 'Unknown'}. Trying DHT peer routing...`);
      }

      try {
        const peerInfo = await node.peerRouting.findPeer(targetPeerId);
        const addrs = peerInfo?.multiaddrs ?? [];

        if (addrs.length === 0) {
          emitDialLog(peerIdString, 'error', 'Peer found in DHT but returned no dialable addresses.');
          throw new Error('Peer was found in DHT but has no dialable addresses.');
        }

        console.log('[skypier:session] dialPeerById: found', addrs.length, 'addresses via DHT, dialing…');
        emitDialLog(peerIdString, 'info', `Found ${addrs.length} addresses in DHT. Testing candidates...`);

        // Dial each address individually — relay circuit addresses embed
        // different relay peer IDs, so passing them all to a single dial()
        // triggers "Multiaddrs must all have the same peer id".
        let lastErr: unknown;
        for (const addr of addrs) {
          try {
            const addrStr = addr.toString();
            console.log('[skypier:session] dialPeerById: trying', addrStr);
            emitDialLog(peerIdString, 'info', `Trying: ${addrStr.length > 40 ? '...' + addrStr.slice(-37) : addrStr}`);
            const connection = await node.dial(addr);
            const peerId = connection.remotePeer.toString();
            console.log('[skypier:session] dialPeerById: ✓ connected to', peerId, 'via DHT');
            emitDialLog(peerIdString, 'success', `Connected via ${addrStr.includes('p2p-circuit') ? 'Relay' : 'Direct path'}!`);
            emitState();
            await this.flushQueue();
            return peerId;
          } catch (addrErr) {
            console.warn('[skypier:session] dialPeerById: addr failed:', addr.toString(), addrErr instanceof Error ? addrErr.message : addrErr);
            emitDialLog(peerIdString, 'warn', `Route failed: ${addrErr instanceof Error ? addrErr.message : 'Unknown'}`);
            lastErr = addrErr;
          }
        }

        throw lastErr ?? new Error('All DHT addresses failed');
      } catch (routingErr) {
        const msg = routingErr instanceof Error ? routingErr.message : 'Unknown error';
        console.error('[skypier:session] dialPeerById: ✗ all dial attempts failed for', peerIdString, msg);
        throw new Error(`Could not reach peer ${peerIdString.slice(0, 16)}…: ${msg}`);
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
      listeners[event].add(handler as any);
      return () => {
        listeners[event].delete(handler as any);
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