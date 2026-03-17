import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserLiveSession, type BrowserLiveSession, type BrowserLiveSessionState, type DeliveryStatusEvent, type PeerReachabilityEvent } from '@skypier/network';
import type { ChatMessage } from '@skypier/protocol';

interface UseLiveChatSessionOptions {
  onInboundMessage: (payload: { fromPeerId: string; envelope: { kind: 'message' | 'receipt' | 'presence' | 'sync'; conversationId: string; senderPeerId: string; sentAt: string; payload: string } }) => Promise<void> | void;
  onPeerReachabilityChange?: (event: PeerReachabilityEvent) => void;
  onDeliveryStatus?: (event: DeliveryStatusEvent) => void;
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

  useEffect(() => {
    const session = createBrowserLiveSession({
      nodeOptions: {
        bootstrapMultiaddrs: DEFAULT_BOOTSTRAP_MULTIADDRS,
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

    setState(session.getState());

    return () => {
      unsubscribeState();
      unsubscribeInbound();
      unsubscribePeerReachability();
      unsubscribeDeliveryStatus();
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

  return {
    state,
    startSession,
    stopSession,
    dialPeer,
    dialPeerById,
    broadcastChatMessage,
    sendChatMessageToPeer,
    retryMessage,
    connectedPeers: useMemo(() => state.connectedPeers, [state.connectedPeers]),
  };
}