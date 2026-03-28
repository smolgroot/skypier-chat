import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserLiveSession, type BrowserLiveSession, type BrowserLiveSessionState, type DeliveryStatusEvent, type NetworkDebugSnapshot, type PeerReachabilityEvent, type SyncMessageEntry } from '@skypier/network';
import type { AudioCallChunk, AudioCallSignal, ChatMessage, DevicePreKeyBundle, MailboxAckResponse, MailboxPullResponse, SharedPeerProfileMetadata } from '@skypier/protocol';

interface UseLiveChatSessionOptions {
  onInboundMessage: (payload: { fromPeerId: string; envelope: { kind: 'message' | 'receipt' | 'presence' | 'sync'; conversationId: string; senderPeerId: string; sentAt: string; payload: string } }) => Promise<void> | void;
  onAudioCallSignal?: (payload: { fromPeerId: string; signal: AudioCallSignal }) => void;
  onAudioCallChunk?: (payload: { fromPeerId: string; chunk: AudioCallChunk }) => void;
  onPeerReachabilityChange?: (event: PeerReachabilityEvent) => void;
  onDeliveryStatus?: (event: DeliveryStatusEvent) => void;
  onRemoteProfile?: (payload: { peerId: string; profile: SharedPeerProfileMetadata }) => void;
  onDialLog?: (event: import('@skypier/network').DialLogEntry) => void;
  identityProtobuf?: string;
  /**
   * Called when a connected peer sends a sync/request envelope.
   * Return the messages (from your outbox) that the peer may have missed.
   * The session will automatically send them back as a sync/state response.
   */
  onSyncRequest?: (fromPeerId: string, requestedSince: string | undefined) => SyncMessageEntry[];
  /** Called to get the local public prekey bundle for inclusion in sync messages. */
  getLocalPreKeyBundle?: () => DevicePreKeyBundle | undefined;
  /** Called to get the local profile metadata for profile sharing. */
  getLocalProfileMetadata?: () => SharedPeerProfileMetadata;
}

/**
 * Default libp2p WebSocket bootstrap peers.
 * These are well-known IPFS/libp2p nodes that let browser peers join the DHT,
 * discover relay servers, and become reachable.
 */
const DEFAULT_BOOTSTRAP_MULTIADDRS = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
];

/**
 * Optional dedicated relay bootstrap(s), configured via env.
 *
 * Example:
 * VITE_RELAY_BOOTSTRAP_MULTIADDRS=/dns4/relay.skypier.chat/tcp/443/tls/ws/p2p/12D3KooW...
 *
 * Multiple values can be comma-separated. Older values that already include
 * `/p2p-circuit` are accepted and normalized automatically.
 */
const RELAY_BOOTSTRAP_MULTIADDRS = String(import.meta.env.VITE_RELAY_BOOTSTRAP_MULTIADDRS ?? '')
  .split(',')
  .map((value: string) => value.trim())
  .filter(Boolean);

const ENABLE_PEER_DISCOVERY = String(import.meta.env.VITE_ENABLE_PEER_DISCOVERY ?? '')
  .toLowerCase()
  .trim() === 'true';

const ENABLE_DHT = String(import.meta.env.VITE_ENABLE_DHT ?? '')
  .toLowerCase()
  .trim() === 'true';

function stripRelayCircuitSuffix(value: string): string {
  return value.replace(/\/p2p-circuit$/, '');
}

function appendRelayCircuitSuffix(value: string): string {
  return value.endsWith('/p2p-circuit') ? value : `${value}/p2p-circuit`;
}

function toWebTransportRelayMultiaddr(value: string): string | null {
  const match = value.match(/^(\/dns4\/[^/]+|\/dns6\/[^/]+)\/tcp\/443\/tls\/ws(\/p2p\/[^/]+)$/);
  if (!match) {
    return null;
  }
  return `${match[1]}/udp/443/quic-v1/webtransport${match[2]}`;
}

const CONFIGURED_RELAY_DIRECT_MULTIADDRS = Array.from(
  new Set(RELAY_BOOTSTRAP_MULTIADDRS.map(stripRelayCircuitSuffix)),
);

const CONFIGURED_RELAY_WEBTRANSPORT_MULTIADDRS = Array.from(
  new Set(
    CONFIGURED_RELAY_DIRECT_MULTIADDRS
      .map(toWebTransportRelayMultiaddr)
      .filter((value): value is string => Boolean(value)),
  ),
);

const CAN_USE_WEBTRANSPORT = typeof window !== 'undefined' && 'WebTransport' in window;

const CONFIGURED_RELAY_LISTEN_MULTIADDRS = CONFIGURED_RELAY_DIRECT_MULTIADDRS.map(appendRelayCircuitSuffix);

const ENABLE_PUBLIC_BOOTSTRAP = String(import.meta.env.VITE_ENABLE_PUBLIC_BOOTSTRAP ?? '')
  .toLowerCase()
  .trim() === 'true';

const EFFECTIVE_BOOTSTRAP_MULTIADDRS = Array.from(
  new Set([
    ...CONFIGURED_RELAY_DIRECT_MULTIADDRS,
    ...(CAN_USE_WEBTRANSPORT ? CONFIGURED_RELAY_WEBTRANSPORT_MULTIADDRS : []),
    ...(ENABLE_PUBLIC_BOOTSTRAP ? DEFAULT_BOOTSTRAP_MULTIADDRS : []),
  ]),
);

/**
 * Listen addresses include explicit relay multiaddrs to trigger RESERVE requests.
 * 
 * libp2p's circuit-relay-v2 transport only sends RESERVE requests when a relay's
 * explicit multiaddr (with /p2p-circuit suffix) is in the listen addresses.
 * Without them, no reservations are requested, and peers become unreachable via relay.
 * 
 * However, this can cause startup failures if:
 * - The relay is offline
 * - The relay is refusing reservations
 * - The relay address is misconfigured
 * 
 * To handle this, we include the addresses but rely on error recovery:
 * - Startup catches reservation errors and allows partial listen (some addresses fail)
 * - The keepalive loop periodically re-dials to recover reservations if lost
 * - If all listen addresses fail, the node is still usable via other transports
 */
const EFFECTIVE_LISTEN_ADDRESSES = Array.from(
  new Set([
    '/webrtc',
    ...CONFIGURED_RELAY_LISTEN_MULTIADDRS,
    '/p2p-circuit',
  ]),
);

const MAX_BROWSER_CONNECTIONS = (() => {
  const raw = Number(import.meta.env.VITE_LIBP2P_MAX_CONNECTIONS ?? '4');
  if (!Number.isFinite(raw)) return 4;
  return Math.max(2, Math.min(8, Math.floor(raw)));
})();

const INITIAL_STATE: BrowserLiveSessionState = {
  status: 'idle',
  connectedPeers: [],
  listenAddresses: [],
  protocols: [],
  queuedOutgoing: 0,
};

export function useLiveChatSession(options: UseLiveChatSessionOptions) {
  const sessionRef = useRef<BrowserLiveSession | null>(null);
  const inboundHandlerRef = useRef(options.onInboundMessage);
  const audioCallSignalHandlerRef = useRef(options.onAudioCallSignal);
  const audioCallChunkHandlerRef = useRef(options.onAudioCallChunk);
  const peerReachabilityHandlerRef = useRef(options.onPeerReachabilityChange);
  const remoteProfileHandlerRef = useRef(options.onRemoteProfile);
  const [state, setState] = useState<BrowserLiveSessionState>(INITIAL_STATE);

  useEffect(() => {
    inboundHandlerRef.current = options.onInboundMessage;
  }, [options.onInboundMessage]);

  useEffect(() => {
    audioCallSignalHandlerRef.current = options.onAudioCallSignal;
  }, [options.onAudioCallSignal]);

  useEffect(() => {
    audioCallChunkHandlerRef.current = options.onAudioCallChunk;
  }, [options.onAudioCallChunk]);

  useEffect(() => {
    peerReachabilityHandlerRef.current = options.onPeerReachabilityChange;
  }, [options.onPeerReachabilityChange]);

  useEffect(() => {
    remoteProfileHandlerRef.current = options.onRemoteProfile;
  }, [options.onRemoteProfile]);

  const deliveryStatusHandlerRef = useRef(options.onDeliveryStatus);
  useEffect(() => {
    deliveryStatusHandlerRef.current = options.onDeliveryStatus;
  }, [options.onDeliveryStatus]);
  const dialLogHandlerRef = useRef(options.onDialLog);
  useEffect(() => {
    dialLogHandlerRef.current = options.onDialLog;
  }, [options.onDialLog]);

  const localPreKeyBundleRef = useRef(options.getLocalPreKeyBundle);
  useEffect(() => {
    localPreKeyBundleRef.current = options.getLocalPreKeyBundle;
  }, [options.getLocalPreKeyBundle]);

  const localProfileMetadataRef = useRef(options.getLocalProfileMetadata);
  useEffect(() => {
    localProfileMetadataRef.current = options.getLocalProfileMetadata;
  }, [options.getLocalProfileMetadata]);

  const syncRequestHandlerRef = useRef(options.onSyncRequest);
  useEffect(() => {
    syncRequestHandlerRef.current = options.onSyncRequest;
  }, [options.onSyncRequest]);

  useEffect(() => {
    const session = createBrowserLiveSession({
      nodeOptions: {
        bootstrapMultiaddrs: EFFECTIVE_BOOTSTRAP_MULTIADDRS,
        enablePeerDiscovery: ENABLE_PEER_DISCOVERY,
        enableDHT: ENABLE_DHT,
        listenAddresses: EFFECTIVE_LISTEN_ADDRESSES,
        maxConnections: MAX_BROWSER_CONNECTIONS,
        ...(options.identityProtobuf ? {
          identityProtobuf: (() => {
            const binary = atob(options.identityProtobuf);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
          })()
        } : {}),
      },
      getLocalPreKeyBundle: () => localPreKeyBundleRef.current?.(),
      getLocalProfileMetadata: () => localProfileMetadataRef.current?.(),
    });
    sessionRef.current = session;

    const unsubscribeState = session.subscribe('state', (payload) => {
      setState(payload);
    });

    const unsubscribeInbound = session.subscribe('inbound', (payload) => {
      void inboundHandlerRef.current(payload);

      // Phase 2.1: when peer sends a sync/request, respond with our outbox history
      if (payload.envelope.kind === 'sync') {
        try {
          const syncData = JSON.parse(payload.envelope.payload) as { type?: string; requestedSince?: string };
          if (syncData.type === 'request' && syncRequestHandlerRef.current) {
            const messages = syncRequestHandlerRef.current(payload.fromPeerId, syncData.requestedSince);
            if (messages.length > 0) {
              void session.respondToSyncRequest(payload.fromPeerId, messages, syncData.requestedSince);
            }
          }
        } catch {
          // malformed sync payload — ignore
        }
      }
    });

    const unsubscribePeerReachability = session.subscribe('peerReachability', (payload) => {
      peerReachabilityHandlerRef.current?.(payload);
    });

    const unsubscribeAudioCallSignal = session.subscribe('audioCallSignal', (payload) => {
      audioCallSignalHandlerRef.current?.(payload);
    });

    const unsubscribeAudioCallChunk = session.subscribe('audioCallChunk', (payload) => {
      audioCallChunkHandlerRef.current?.(payload);
    });

    const unsubscribeDeliveryStatus = session.subscribe('deliveryStatus', (payload) => {
      deliveryStatusHandlerRef.current?.(payload);
    });

    const unsubscribeRemoteProfile = session.subscribe('remoteProfile', (payload) => {
      remoteProfileHandlerRef.current?.(payload);
    });

    const unsubscribeDialLog = session.subscribe('dialLog', (payload) => {
      dialLogHandlerRef.current?.(payload);
    });

    setState(session.getState());

    return () => {
      unsubscribeState();
      unsubscribeInbound();
      unsubscribePeerReachability();
      unsubscribeAudioCallSignal();
      unsubscribeAudioCallChunk();
      unsubscribeDeliveryStatus();
      unsubscribeRemoteProfile();
      unsubscribeDialLog();
      void session.stop();
      sessionRef.current = null;
    };
  }, [options.identityProtobuf]);

  const startSession = useCallback(async () => {
    if (!sessionRef.current) {
      return;
    }

    await sessionRef.current.start();
    setState(sessionRef.current.getState());
  }, []);

  const stopSession = useCallback(async () => {
    if (!sessionRef.current) {
      return;
    }

    await sessionRef.current.stop();
    setState(sessionRef.current.getState());
  }, []);

  const recoverConnectivity = useCallback(async (reason: 'resume' | 'online' | 'visibility' | 'service-worker' = 'resume') => {
    if (!sessionRef.current) {
      return;
    }

    await sessionRef.current.recoverConnectivity(reason);
    setState(sessionRef.current.getState());
  }, []);

  const dialPeer = useCallback(async (address: string) => {
    if (!sessionRef.current) {
      throw new Error('Session is not initialized');
    }

    const peerId = await sessionRef.current.dialPeer(address);
    setState(sessionRef.current.getState());
    return peerId;
  }, []);

  const dialPeerById = useCallback(async (peerId: string) => {
    if (!sessionRef.current) {
      throw new Error('Session is not initialized');
    }

    const connectedPeerId = await sessionRef.current.dialPeerById(peerId);
    setState(sessionRef.current.getState());
    return connectedPeerId;
  }, []);

  const broadcastChatMessage = useCallback(async (message: ChatMessage) => {
    if (!sessionRef.current) {
      return 0;
    }

    const sentCount = await sessionRef.current.sendChatMessageToConnected(message);
    setState(sessionRef.current.getState());
    return sentCount;
  }, []);

  const sendChatMessageToPeer = useCallback(async (message: ChatMessage, targetPeerId: string) => {
    if (!sessionRef.current) {
      return false;
    }

    const success = await sessionRef.current.sendChatMessageToPeer(message, targetPeerId);
    setState(sessionRef.current.getState());
    return success;
  }, []);

  const requestPeerProfile = useCallback(async (targetPeerId: string): Promise<SharedPeerProfileMetadata | null> => {
    if (!sessionRef.current) {
      return null;
    }

    const profile = await sessionRef.current.requestPeerProfile(targetPeerId);
    setState(sessionRef.current.getState());
    return profile;
  }, []);

  const retryMessage = useCallback(async (messageId: string) => {
    if (!sessionRef.current) {
      return false;
    }

    const success = await sessionRef.current.retryMessage(messageId);
    setState(sessionRef.current.getState());
    return success;
  }, []);

  const sendAudioCallSignal = useCallback(async (signal: AudioCallSignal, targetPeerId: string) => {
    if (!sessionRef.current) {
      return false;
    }

    const success = await sessionRef.current.sendAudioCallSignal(signal, targetPeerId);
    setState(sessionRef.current.getState());
    return success;
  }, []);

  const sendAudioCallChunk = useCallback(async (chunk: AudioCallChunk, targetPeerId: string) => {
    if (!sessionRef.current) {
      return false;
    }

    const success = await sessionRef.current.sendAudioCallChunk(chunk, targetPeerId);
    setState(sessionRef.current.getState());
    return success;
  }, []);

  const requestSyncWithConnectedPeers = useCallback(async (reason: 'resume' | 'manual' = 'manual') => {
    if (!sessionRef.current) {
      return 0;
    }

    const requested = await sessionRef.current.requestSyncWithConnectedPeers(reason);
    setState(sessionRef.current.getState());
    return requested;
  }, []);

  const enqueueMailboxForPeer = useCallback(async (message: ChatMessage, targetPeerId: string) => {
    if (!sessionRef.current) {
      return false;
    }

    const accepted = await sessionRef.current.enqueueMailboxForPeer(message, targetPeerId);
    setState(sessionRef.current.getState());
    return accepted;
  }, []);

  const pullMailboxFromPeer = useCallback(async (targetPeerId: string, limit?: number): Promise<MailboxPullResponse | null> => {
    if (!sessionRef.current) {
      return null;
    }

    const response = await sessionRef.current.pullMailboxFromPeer(targetPeerId, limit);
    setState(sessionRef.current.getState());
    return response;
  }, []);

  const ackMailboxFromPeer = useCallback(async (targetPeerId: string, envelopeIds: string[]): Promise<MailboxAckResponse | null> => {
    if (!sessionRef.current) {
      return null;
    }

    const response = await sessionRef.current.ackMailboxFromPeer(targetPeerId, envelopeIds);
    setState(sessionRef.current.getState());
    return response;
  }, []);

  const getDebugInfo = useCallback((): NetworkDebugSnapshot | null => {
    return sessionRef.current?.getDebugInfo() ?? null;
  }, []);

  return {
    state,
    startSession,
    stopSession,
    recoverConnectivity,
    dialPeer,
    dialPeerById,
    broadcastChatMessage,
    sendChatMessageToPeer,
    requestPeerProfile,
    sendAudioCallSignal,
    sendAudioCallChunk,
    retryMessage,
    requestSyncWithConnectedPeers,
    enqueueMailboxForPeer,
    pullMailboxFromPeer,
    ackMailboxFromPeer,
    getDebugInfo,
    connectedPeers: useMemo(() => state.connectedPeers, [state.connectedPeers]),
  };
}