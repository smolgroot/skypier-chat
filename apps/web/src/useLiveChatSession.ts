import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserLiveSession, type BrowserLiveSession, type BrowserLiveSessionState, type DeliveryStatusEvent, type NetworkDebugSnapshot, type PeerReachabilityEvent } from '@skypier/network';
import type { ChatMessage } from '@skypier/protocol';

interface UseLiveChatSessionOptions {
  onInboundMessage: (payload: { fromPeerId: string; envelope: { kind: 'message' | 'receipt' | 'presence' | 'sync'; conversationId: string; senderPeerId: string; sentAt: string; payload: string } }) => Promise<void> | void;
  onPeerReachabilityChange?: (event: PeerReachabilityEvent) => void;
  onDeliveryStatus?: (event: DeliveryStatusEvent) => void;
  onDialLog?: (event: import('@skypier/network').DialLogEntry) => void;
  identityProtobuf?: string;
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

function stripRelayCircuitSuffix(value: string): string {
  return value.replace(/\/p2p-circuit$/, '');
}

const CONFIGURED_RELAY_DIRECT_MULTIADDRS = Array.from(
  new Set(RELAY_BOOTSTRAP_MULTIADDRS.map(stripRelayCircuitSuffix)),
);

const EFFECTIVE_BOOTSTRAP_MULTIADDRS = Array.from(
  new Set([
    ...CONFIGURED_RELAY_DIRECT_MULTIADDRS,
    ...DEFAULT_BOOTSTRAP_MULTIADDRS,
  ]),
);

const EFFECTIVE_LISTEN_ADDRESSES = Array.from(
  new Set([
    '/webrtc',
    '/p2p-circuit',
  ]),
);

const MAX_BROWSER_CONNECTIONS = (() => {
  const raw = Number(import.meta.env.VITE_LIBP2P_MAX_CONNECTIONS ?? '16');
  if (!Number.isFinite(raw)) return 16;
  return Math.max(4, Math.min(32, Math.floor(raw)));
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
  const peerReachabilityHandlerRef = useRef(options.onPeerReachabilityChange);
  const [state, setState] = useState<BrowserLiveSessionState>(INITIAL_STATE);

  useEffect(() => {
    inboundHandlerRef.current = options.onInboundMessage;
  }, [options.onInboundMessage]);

  useEffect(() => {
    peerReachabilityHandlerRef.current = options.onPeerReachabilityChange;
  }, [options.onPeerReachabilityChange]);

  const deliveryStatusHandlerRef = useRef(options.onDeliveryStatus);
  useEffect(() => {
    deliveryStatusHandlerRef.current = options.onDeliveryStatus;
  }, [options.onDeliveryStatus]);
  const dialLogHandlerRef = useRef(options.onDialLog);
  useEffect(() => {
    dialLogHandlerRef.current = options.onDialLog;
  }, [options.onDialLog]);

  useEffect(() => {
    const session = createBrowserLiveSession({
      nodeOptions: {
        bootstrapMultiaddrs: EFFECTIVE_BOOTSTRAP_MULTIADDRS,
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
    });
    sessionRef.current = session;

    const unsubscribeState = session.subscribe('state', (payload) => {
      setState(payload);
    });

    const unsubscribeInbound = session.subscribe('inbound', (payload) => {
      void inboundHandlerRef.current(payload);
    });

    const unsubscribePeerReachability = session.subscribe('peerReachability', (payload) => {
      peerReachabilityHandlerRef.current?.(payload);
    });

    const unsubscribeDeliveryStatus = session.subscribe('deliveryStatus', (payload) => {
      deliveryStatusHandlerRef.current?.(payload);
    });

    const unsubscribeDialLog = session.subscribe('dialLog', (payload) => {
      dialLogHandlerRef.current?.(payload);
    });

    setState(session.getState());

    return () => {
      unsubscribeState();
      unsubscribeInbound();
      unsubscribePeerReachability();
      unsubscribeDeliveryStatus();
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

  const retryMessage = useCallback(async (messageId: string) => {
    if (!sessionRef.current) {
      return false;
    }

    const success = await sessionRef.current.retryMessage(messageId);
    setState(sessionRef.current.getState());
    return success;
  }, []);

  const getDebugInfo = useCallback((): NetworkDebugSnapshot | null => {
    return sessionRef.current?.getDebugInfo() ?? null;
  }, []);

  return {
    state,
    startSession,
    stopSession,
    dialPeer,
    dialPeerById,
    broadcastChatMessage,
    sendChatMessageToPeer,
    retryMessage,
    getDebugInfo,
    connectedPeers: useMemo(() => state.connectedPeers, [state.connectedPeers]),
  };
}