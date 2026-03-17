import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserLiveSession, type BrowserLiveSession, type BrowserLiveSessionState, type PeerReachabilityEvent } from '@skypier/network';
import type { ChatMessage } from '@skypier/protocol';

interface UseLiveChatSessionOptions {
  onInboundMessage: (payload: { fromPeerId: string; envelope: { kind: 'message' | 'receipt' | 'presence' | 'sync'; conversationId: string; senderPeerId: string; sentAt: string; payload: string } }) => Promise<void> | void;
  onPeerReachabilityChange?: (event: PeerReachabilityEvent) => void;
  identityProtobuf?: string;
}

const INITIAL_STATE: BrowserLiveSessionState = {
  status: 'idle',
  connectedPeers: [],
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

  useEffect(() => {
    const session = createBrowserLiveSession({
      nodeOptions: options.identityProtobuf ? {
        identityProtobuf: (() => {
          const binary = atob(options.identityProtobuf);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return bytes;
        })()
      } : undefined
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

    setState(session.getState());

    return () => {
      unsubscribeState();
      unsubscribeInbound();
      unsubscribePeerReachability();
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

  return {
    state,
    startSession,
    stopSession,
    dialPeer,
    dialPeerById,
    broadcastChatMessage,
    sendChatMessageToPeer,
    connectedPeers: useMemo(() => state.connectedPeers, [state.connectedPeers]),
  };
}