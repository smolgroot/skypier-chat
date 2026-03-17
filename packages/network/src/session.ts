import { multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
import type { ChatMessage } from '@skypier/protocol';
import { createBrowserSkypierNode, type CreateBrowserSkypierNodeOptions, type SkypierBrowserNode } from './browser';
import { SKYPIER_CHAT_PROTOCOLS, deserializeWireEnvelope, serializeWireEnvelope, type WireEnvelope } from './protocols';

export type SessionStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export interface PeerReachabilityEvent {
  peerId: string;
  reachability: 'direct' | 'relayed' | 'offline';
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
}

export interface BrowserLiveSession {
  start(): Promise<void>;
  stop(): Promise<void>;
  dialPeer(address: string): Promise<string>;
  dialPeerById(peerId: string): Promise<string>;
  sendEnvelopeToConnected(envelope: WireEnvelope): Promise<number>;
  sendChatMessageToConnected(message: ChatMessage): Promise<number>;
  sendChatMessageToPeer(message: ChatMessage, targetPeerId: string): Promise<boolean>;
  flushQueue(): Promise<number>;
  getState(): BrowserLiveSessionState;
  subscribe<T extends keyof BrowserLiveSessionEventMap>(event: T, handler: (payload: BrowserLiveSessionEventMap[T]) => void): () => void;
}

interface QueuedEnvelope {
  peerId: string;
  envelope: WireEnvelope;
}

export interface CreateBrowserLiveSessionOptions {
  nodeOptions?: CreateBrowserSkypierNodeOptions;
}

export function createBrowserLiveSession(options: CreateBrowserLiveSessionOptions = {}): BrowserLiveSession {
  let node: SkypierBrowserNode | undefined;
  let state: BrowserLiveSessionState = {
    status: 'idle',
    connectedPeers: [],
    listenAddresses: [],
    protocols: [],
    queuedOutgoing: 0,
  };

  const queue: QueuedEnvelope[] = [];

  const listeners = {
    state: new Set<(payload: BrowserLiveSessionState) => void>(),
    inbound: new Set<(payload: { fromPeerId: string; envelope: WireEnvelope }) => void>(),
    peerReachability: new Set<(payload: PeerReachabilityEvent) => void>(),
  };

  function emitState() {
    state = {
      ...state,
      connectedPeers: node?.getConnections().map((connection) => connection.remotePeer.toString()) ?? [],
      listenAddresses: node?.getMultiaddrs().map((ma) => ma.toString()) ?? [],
      protocols: node?.getProtocols() ?? [],
      queuedOutgoing: queue.length,
    };

    listeners.state.forEach((handler) => handler(state));
  }

  function emitInbound(payload: { fromPeerId: string; envelope: WireEnvelope }) {
    listeners.inbound.forEach((handler) => handler(payload));
  }

  async function sendEnvelopeToPeer(peerId: string, envelope: WireEnvelope) {
    if (!node) {
      console.warn('[skypier:session] sendEnvelopeToPeer: node not ready, queueing for', peerId);
      queue.push({ peerId, envelope });
      emitState();
      return;
    }

    const connection = node.getConnections().find((candidate) => candidate.remotePeer.toString() === peerId);

    if (!connection) {
      console.warn('[skypier:session] sendEnvelopeToPeer: no connection to', peerId, '— queueing. Connected peers:', node.getConnections().map(c => c.remotePeer.toString()));
      queue.push({ peerId, envelope });
      emitState();
      return;
    }

    try {
      const stream = await connection.newStream(SKYPIER_CHAT_PROTOCOLS.message);
      stream.send(serializeWireEnvelope(envelope));
      await stream.close();
      console.log('[skypier:session] ✓ sent envelope to', peerId, '— kind:', envelope.kind, 'conv:', envelope.conversationId);
    } catch (error) {
      console.error('[skypier:session] ✗ failed to send to', peerId, error);
      queue.push({ peerId, envelope });
      state = {
        ...state,
        lastError: error instanceof Error ? error.message : 'Failed to send envelope',
      };
      emitState();
    }
  }

  return {
    async start() {
      if (state.status === 'starting' || state.status === 'running') {
        return;
      }

      state = { ...state, status: 'starting', lastError: undefined };
      emitState();

      try {
        node = await createBrowserSkypierNode(options.nodeOptions);

        console.log('[skypier:session] registering protocol handler:', SKYPIER_CHAT_PROTOCOLS.message);
        await node.handle(SKYPIER_CHAT_PROTOCOLS.message, async (stream, connection) => {
          const fromPeerId = connection.remotePeer.toString();
          console.log('[skypier:session] ⇐ inbound stream from', fromPeerId);
          try {
            // Collect all chunks — a message may arrive fragmented
            const chunks: Uint8Array[] = [];
            for await (const chunk of stream) {
              chunks.push(normalizeChunk(chunk));
            }
            const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const c of chunks) {
              combined.set(c, offset);
              offset += c.byteLength;
            }
            const envelope = deserializeWireEnvelope(combined);
            console.log('[skypier:session] ⇐ received envelope from', fromPeerId, '— kind:', envelope.kind, 'conv:', envelope.conversationId, 'payload length:', envelope.payload.length);
            emitInbound({ fromPeerId, envelope });
          } catch (err) {
            console.error('[skypier:session] ✗ failed to read inbound stream from', fromPeerId, err);
          }
        });

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

        console.log('[skypier:session] ✓ node started — localPeerId:', node.peerId.toString());
        console.log('[skypier:session]   listen addrs:', node.getMultiaddrs().map(ma => ma.toString()));
        emitState();
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

      // First try: dial by PeerId directly (works if peer is already in the address book
      // or discovered via mDNS / bootstrap / previous connection)
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

      // Second try: use peer routing (KadDHT) to find the peer's addresses
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
      const targets = node?.getConnections().map((connection) => connection.remotePeer.toString()) ?? [];
      console.log('[skypier:session] broadcasting envelope to', targets.length, 'connected peers:', targets);

      for (const peerId of targets) {
        await sendEnvelopeToPeer(peerId, envelope);
      }

      emitState();
      return targets.length;
    },

    async sendChatMessageToConnected(message: ChatMessage) {
      const envelope: WireEnvelope = {
        kind: 'message',
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
        conversationId: message.conversationId,
        senderPeerId: state.localPeerId ?? 'unknown',
        sentAt: new Date().toISOString(),
        payload: message.previewText,
      };

      console.log('[skypier:session] sending message to specific peer', targetPeerId, 'conv:', message.conversationId);
      const before = queue.length;
      await sendEnvelopeToPeer(targetPeerId, envelope);
      // If nothing was queued, the send succeeded
      return queue.length === before;
    },

    async flushQueue() {
      if (!node || queue.length === 0) {
        emitState();
        return 0;
      }

      const pending = queue.splice(0, queue.length);
      let sentCount = 0;

      for (const item of pending) {
        const before = queue.length;
        await sendEnvelopeToPeer(item.peerId, item.envelope);
        if (queue.length === before) {
          sentCount += 1;
        }
      }

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