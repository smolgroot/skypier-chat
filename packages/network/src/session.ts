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
}

export interface BrowserLiveSession {
  start(): Promise<void>;
  stop(): Promise<void>;
  dialPeer(address: string): Promise<string>;
  dialPeerById(peerId: string): Promise<string>;
  sendEnvelopeToConnected(envelope: WireEnvelope): Promise<number>;
  sendChatMessageToConnected(message: ChatMessage): Promise<number>;
  sendChatMessageToPeer(message: ChatMessage, targetPeerId: string): Promise<boolean>;
  retryMessage(messageId: string): Promise<boolean>;
  flushQueue(): Promise<number>;
  getState(): BrowserLiveSessionState;
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

export function createBrowserLiveSession(options: CreateBrowserLiveSessionOptions = {}): BrowserLiveSession {
  let node: SkypierBrowserNode | undefined;
  let retryTimer: ReturnType<typeof setInterval> | undefined;

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
  };

  // ─── Helpers ───────────────────────────────────────────────────────────

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

  async function sendEnvelopeToPeer(peerId: string, envelope: WireEnvelope): Promise<boolean> {
    // Guard: never send to ourselves
    if (peerId === state.localPeerId) {
      return true; // treat as "sent" — nothing to do
    }

    if (!node) {
      console.warn('[skypier:session] sendEnvelopeToPeer: node not ready for', peerId);
      return false;
    }

    const connection = node.getConnections().find((c) => c.remotePeer.toString() === peerId);

    if (!connection) {
      console.warn('[skypier:session] sendEnvelopeToPeer: no connection to', peerId);
      return false;
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

      // Mark as sent
      if (envelope.messageId) {
        emitDeliveryStatus({ messageId: envelope.messageId, status: 'sent' });
      }

      return true;
    } catch (error) {
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

        const success = await sendEnvelopeToPeer(item.peerId, item.envelope);
        if (!success) {
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

        // ─── Register MESSAGE protocol handler ───────────────────────
        console.log('[skypier:session] registering protocol handler:', SKYPIER_CHAT_PROTOCOLS.message);
        await node.handle(SKYPIER_CHAT_PROTOCOLS.message, async (stream, connection) => {
          const fromPeerId = connection.remotePeer.toString();
          console.log('[skypier:session] ⇐ inbound stream from', fromPeerId);
          try {
            const envelope = await readEnvelopeFromStream(stream);
            console.log('[skypier:session] ⇐ received envelope from', fromPeerId, '— kind:', envelope.kind, 'msgId:', envelope.messageId, 'conv:', envelope.conversationId);
            emitInbound({ fromPeerId, envelope });

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

        // Start background retry loop & flush any queued items
        startRetryLoop();
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
        const connection = await node.dial(targetPeerId);
        const peerId = connection.remotePeer.toString();
        console.log('[skypier:session] dialPeerById: ✓ connected to', peerId);
        emitState();
        await this.flushQueue();
        return peerId;
      } catch (directErr) {
        console.warn('[skypier:session] dialPeerById: direct dial failed, trying peer routing…', directErr instanceof Error ? directErr.message : directErr);
      }

      try {
        const peerInfo = await node.peerRouting.findPeer(targetPeerId);
        const addrs = peerInfo?.multiaddrs ?? [];

        if (addrs.length === 0) {
          throw new Error('Peer was found in DHT but has no dialable addresses.');
        }

        console.log('[skypier:session] dialPeerById: found', addrs.length, 'addresses via DHT, dialing…');
        const connection = await node.dial(addrs);
        const peerId = connection.remotePeer.toString();
        console.log('[skypier:session] dialPeerById: ✓ connected to', peerId, 'via DHT');
        emitState();
        await this.flushQueue();
        return peerId;
      } catch (routingErr) {
        const msg = routingErr instanceof Error ? routingErr.message : 'Unknown error';
        console.error('[skypier:session] dialPeerById: ✗ all dial attempts failed for', peerIdString, msg);
        throw new Error(`Could not reach peer ${peerIdString.slice(0, 16)}…: ${msg}`);
      }
    },

    async sendEnvelopeToConnected(envelope: WireEnvelope) {
      const targets = (node?.getConnections().map((c) => c.remotePeer.toString()) ?? [])
        .filter((pid) => pid !== state.localPeerId); // never send to self
      console.log('[skypier:session] broadcasting envelope to', targets.length, 'connected peers:', targets);

      for (const peerId of targets) {
        const success = await sendEnvelopeToPeer(peerId, envelope);
        if (!success) {
          enqueue(peerId, envelope);
        }
      }

      emitState();
      return targets.length;
    },

    async sendChatMessageToConnected(message: ChatMessage) {
      const envelope: WireEnvelope = {
        kind: 'message',
        messageId: message.id,
        conversationId: message.conversationId,
        senderPeerId: state.localPeerId ?? 'unknown',
        sentAt: new Date().toISOString(),
        payload: message.previewText,
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
        payload: message.previewText,
      };

      console.log('[skypier:session] sending message to specific peer', targetPeerId, 'conv:', message.conversationId, 'msgId:', message.id);
      const success = await sendEnvelopeToPeer(targetPeerId, envelope);
      if (!success) {
        enqueue(targetPeerId, envelope);
      }
      return success;
    },

    async retryMessage(messageId: string) {
      const idx = queue.findIndex((q) => q.envelope.messageId === messageId);
      if (idx === -1) {
        console.warn('[skypier:session] retryMessage: no queued item for', messageId);
        return false;
      }

      const item = queue.splice(idx, 1)[0];
      const success = await sendEnvelopeToPeer(item.peerId, item.envelope);
      if (!success) {
        // Re-enqueue with reset retryCount = 0 (user-triggered manual retry)
        enqueue(item.peerId, item.envelope, 0);
      }
      persistQueue();
      emitState();
      return success;
    },

    async flushQueue() {
      if (!node || queue.length === 0) {
        emitState();
        return 0;
      }

      const pending = queue.splice(0, queue.length);
      let sentCount = 0;

      for (const item of pending) {
        const success = await sendEnvelopeToPeer(item.peerId, item.envelope);
        if (success) {
          sentCount += 1;
        } else {
          queue.push(item);
        }
      }

      persistQueue();
      emitState();
      return sentCount;
    },

    getState() {
      return state;
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