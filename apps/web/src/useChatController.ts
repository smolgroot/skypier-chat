import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEncryptedBackupBundle, createPinataUploadRequest } from '@skypier/backup';
import type { WireEnvelope } from '@skypier/network';
import type { ChatMessage, LinkedEthAddress } from '@skypier/protocol';
import {
  createChatRepository,
  createLocalMessage,
  createInitialChatState,
  getCurrentDevice,
  type PersistedChatState,
  toggleMessageReaction,
} from '@skypier/storage';

const CURRENT_USER_ID = 'user-1';

export function useChatController() {
  const [state, setState] = useState<PersistedChatState>(createInitialChatState);
  // stateRef always holds the latest persisted snapshot so async callbacks
  // never read a stale closure even when two calls run before a re-render.
  const stateRef = useRef<PersistedChatState>(state);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const selectedConversationIdRef = useRef('');
  const [composerValue, setComposerValue] = useState('');
  const [replyTargetId, setReplyTargetId] = useState<string | undefined>();
  const [storageMode, setStorageMode] = useState<'indexeddb' | 'localstorage' | 'memory'>('memory');
  const [isLoaded, setIsLoaded] = useState(false);
  const [lastBackupChecksum, setLastBackupChecksum] = useState<string | undefined>();

  useEffect(() => {
    let disposed = false;

    async function load() {
      const repository = await createChatRepository();
      const persistedState = await repository.load();

      if (disposed) {
        return;
      }

      stateRef.current = persistedState;
      setState(persistedState);
      setSelectedConversationId((current) => current || ''); // Don't auto-select on load
      setStorageMode(repository.getStorageMode());
      setIsLoaded(true);
    }

    void load();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const selectedConversation = useMemo(
    () => state.conversations.find((conversation) => conversation.id === selectedConversationId),
    [selectedConversationId, state.conversations],
  );

  const messages = selectedConversation ? state.messagesByConversation[selectedConversation.id] ?? [] : [];
  const replyTarget = messages.find((message) => message.id === replyTargetId);

  const persistState = useCallback(async (nextState: PersistedChatState) => {
    stateRef.current = nextState; // sync — always before setState so any callback called after this sees the new snapshot
    setState(nextState);
    const repository = await createChatRepository();
    await repository.save(nextState);
  }, []);

  const createConversationWithPeer = useCallback(async (peerId: string, displayName?: string): Promise<string> => {
    const normalizedPeerId = peerId.trim();
    if (!normalizedPeerId) {
      throw new Error('Peer ID is required to create a chat.');
    }

    const existing = stateRef.current.conversations.find((conversation) =>
      conversation.participants.some((participant) => participant.peerId === normalizedPeerId),
    );

    if (existing) {
      setSelectedConversationId(existing.id);
      selectedConversationIdRef.current = existing.id;
      return existing.id;
    }

    const currentDevice = getCurrentDevice();
    const conversationId = `conv-${normalizedPeerId.slice(-8)}-${Math.random().toString(36).slice(2, 6)}`;
    const title = (displayName?.trim() || `Peer ${normalizedPeerId.slice(0, 10)}…`);

    const newConversation = {
      id: conversationId,
      title,
      participants: [
        {
          id: CURRENT_USER_ID,
          displayName: stateRef.current.account.displayName,
          peerId: stateRef.current.account.localPeerId ?? currentDevice.peerId,
          devices: [currentDevice],
        },
        {
          id: `peer-${normalizedPeerId}`,
          displayName: title,
          peerId: normalizedPeerId,
          devices: [
            {
              id: `device-${normalizedPeerId}`,
              label: 'Remote device',
              peerId: normalizedPeerId,
              platform: 'web' as const,
              trustLevel: 'software' as const,
            },
          ],
        },
      ],
      lastMessagePreview: 'Connecting securely…',
      unreadCount: 0,
      reachability: 'unknown' as const,
      updatedAt: new Date().toISOString(),
    };

    const snap = stateRef.current;
    const nextState: PersistedChatState = {
      ...snap,
      conversations: [newConversation, ...snap.conversations],
      messagesByConversation: {
        ...snap.messagesByConversation,
        [conversationId]: [],
      },
    };

    await persistState(nextState);
    setSelectedConversationId(conversationId);
    selectedConversationIdRef.current = conversationId;
    return conversationId;
  }, [persistState]);

  const updateConversationConnection = useCallback(async (
    peerId: string,
    options: {
      reachability: 'unknown' | 'direct' | 'relayed' | 'offline';
      lastMessagePreview?: string;
    },
  ) => {
    const normalizedPeerId = peerId.trim();
    if (!normalizedPeerId) {
      return;
    }

    const snap = stateRef.current;
    const now = new Date().toISOString();
    const nextConversations = snap.conversations.map((conversation) => {
      const hasPeer = conversation.participants.some((participant) => participant.peerId === normalizedPeerId);
      if (!hasPeer) {
        return conversation;
      }

      return {
        ...conversation,
        reachability: options.reachability,
        lastMessagePreview: options.lastMessagePreview ?? conversation.lastMessagePreview,
        updatedAt: now,
      };
    });

    await persistState({
      ...snap,
      conversations: nextConversations,
    });
  }, [persistState]);

  const sendMessage = useCallback(async (): Promise<ChatMessage | undefined> => {
    if (!selectedConversation || !composerValue.trim()) {
      return undefined;
    }

    const currentDevice = getCurrentDevice();
    const recipientDeviceIds = selectedConversation.participants
      .flatMap((participant) => participant.devices)
      .filter((device) => device.id !== currentDevice.id)
      .map((device) => device.id);

    const nextMessage = createLocalMessage({
      conversationId: selectedConversation.id,
      senderId: CURRENT_USER_ID,
      senderDisplayName: state.account.displayName,
      senderDeviceId: currentDevice.id,
      previewText: composerValue.trim(),
      recipientDeviceIds,
      replyTo: replyTarget ? {
        messageId: replyTarget.id,
        excerpt: replyTarget.previewText,
        authorDisplayName: replyTarget.senderDisplayName,
      } : undefined,
    });

    const nextMessages = [...messages, nextMessage];
    const snap = stateRef.current;
    const nextState: PersistedChatState = {
      account: snap.account,
      conversations: snap.conversations.map((conversation) => conversation.id === selectedConversation.id ? {
        ...conversation,
        lastMessagePreview: nextMessage.previewText,
        updatedAt: nextMessage.createdAt,
      } : conversation),
      messagesByConversation: {
        ...snap.messagesByConversation,
        [selectedConversation.id]: nextMessages,
      },
    };

    await persistState(nextState);
    setComposerValue('');
    setReplyTargetId(undefined);
    return nextMessage;
  }, [composerValue, messages, persistState, replyTarget, selectedConversation]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!selectedConversation || !messageId) {
      return;
    }

    const snap = stateRef.current;
    const nextMessages = (snap.messagesByConversation[selectedConversation.id] ?? []).map((message) => (
      message.id === messageId ? toggleMessageReaction(message, emoji, snap.account.displayName) : message
    ));

    const nextState: PersistedChatState = {
      ...snap,
      messagesByConversation: {
        ...snap.messagesByConversation,
        [selectedConversation.id]: nextMessages,
      },
    };

    await persistState(nextState);
  }, [persistState, selectedConversation]);

  const selectReplyTarget = useCallback((message: ChatMessage) => {
    setReplyTargetId(message.id);
  }, []);

  const exportBackup = useCallback(async () => {
    const bundle = await createEncryptedBackupBundle(stateRef.current);
    const payload = {
      manifest: bundle.manifest,
      encryptedPayload: bundle.encryptedPayload,
      recoveryKey: bundle.recoveryKey,
      pinataRequestPreview: createPinataUploadRequest(bundle, { provider: 'pinata', jwt: 'PINATA_JWT_HERE' }),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `skypier-chat-backup-${bundle.manifest.exportedAt}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setLastBackupChecksum(bundle.manifest.ciphertextBundleChecksum);
  }, []);

  const linkEthAddress = useCallback(async (wallet: LinkedEthAddress) => {
    const snap = stateRef.current;
    const deduped = snap.account.linkedEthAddresses.filter((entry) => entry.address !== wallet.address);

    const nextState: PersistedChatState = {
      ...snap,
      account: {
        ...snap.account,
        linkedEthAddresses: [wallet, ...deduped],
      },
    };

    await persistState(nextState);
  }, [persistState]);

  const unlinkEthAddress = useCallback(async (address: string) => {
    const snap = stateRef.current;
    const nextState: PersistedChatState = {
      ...snap,
      account: {
        ...snap.account,
        linkedEthAddresses: snap.account.linkedEthAddresses.filter((entry) => entry.address !== address.toLowerCase()),
      },
    };

    await persistState(nextState);
  }, [persistState]);

  const updateAccount = useCallback(async (updates: {
    displayName?: string;
    identityProtobuf?: string;
    localPeerId?: string;
    biometricUnlockEnabled?: boolean;
    biometricCredentialId?: string;
  }) => {
    const snap = stateRef.current;
    const nextState: PersistedChatState = {
      ...snap,
      account: {
        ...snap.account,
        displayName: updates.displayName ?? snap.account.displayName,
        identityProtobuf: updates.identityProtobuf ?? snap.account.identityProtobuf,
        localPeerId: updates.localPeerId ?? snap.account.localPeerId,
        biometricUnlockEnabled: updates.biometricUnlockEnabled ?? snap.account.biometricUnlockEnabled,
        biometricCredentialId: updates.biometricCredentialId ?? snap.account.biometricCredentialId,
      },
    };
    await persistState(nextState);
  }, [persistState]);

  const ingestIncomingEnvelope = useCallback(async (envelope: WireEnvelope, fromPeerId: string) => {
    if (envelope.kind !== 'message') {
      return;
    }

    const snap = stateRef.current;
    const currentSelectedId = selectedConversationIdRef.current;
    const existingConversation = snap.conversations.find((conversation) => conversation.id === envelope.conversationId);
    const conversation = existingConversation ?? {
      id: envelope.conversationId,
      title: `Peer ${fromPeerId.slice(0, 10)}…`,
      participants: [
        {
          id: CURRENT_USER_ID,
          displayName: snap.account.displayName,
          peerId: getCurrentDevice().peerId,
          devices: [getCurrentDevice()],
        },
        {
          id: `peer-${fromPeerId}`,
          displayName: `Peer ${fromPeerId.slice(0, 10)}…`,
          peerId: fromPeerId,
          devices: [
            {
              id: `device-${fromPeerId}`,
              label: 'Remote device',
              peerId: fromPeerId,
              platform: 'web' as const,
              trustLevel: 'software' as const,
            },
          ],
        },
      ],
      lastMessagePreview: envelope.payload,
      unreadCount: currentSelectedId === envelope.conversationId ? 0 : 1,
      reachability: 'direct' as const,
      updatedAt: envelope.sentAt,
    };

    const incomingMessage: ChatMessage = {
      id: `net-${Math.random().toString(36).slice(2, 10)}`,
      conversationId: envelope.conversationId,
      senderId: `peer-${fromPeerId}`,
      senderDisplayName: conversation.title,
      senderDeviceId: `device-${fromPeerId}`,
      createdAt: envelope.sentAt,
      previewText: envelope.payload,
      ciphertext: {
        algorithm: 'xchacha20poly1305',
        ciphertext: btoa(envelope.payload),
        nonce: 'network-stream',
        recipientDeviceIds: [getCurrentDevice().id],
      },
      delivery: 'delivered',
      reactions: [],
    };

    const currentMessages = snap.messagesByConversation[conversation.id] ?? [];
    const nextMessages = [...currentMessages, incomingMessage];

    const nextConversations = existingConversation
      ? snap.conversations.map((candidate) => candidate.id === conversation.id ? {
        ...candidate,
        lastMessagePreview: incomingMessage.previewText,
        updatedAt: incomingMessage.createdAt,
        unreadCount: currentSelectedId === conversation.id ? candidate.unreadCount : candidate.unreadCount + 1,
      } : candidate)
      : [conversation, ...snap.conversations];

    const nextState: PersistedChatState = {
      account: snap.account,
      conversations: nextConversations,
      messagesByConversation: {
        ...snap.messagesByConversation,
        [conversation.id]: nextMessages,
      },
    };

    await persistState(nextState);
  }, [persistState]);

  return {
    account: state.account,
    conversations: state.conversations,
    selectedConversation,
    selectedConversationId,
    setSelectedConversationId,
    messages,
    composerValue,
    setComposerValue,
    createConversationWithPeer,
    updateConversationConnection,
    sendMessage,
    replyTarget,
    selectReplyTarget,
    clearReplyTarget: () => setReplyTargetId(undefined),
    toggleReaction,
    ingestIncomingEnvelope,
    linkEthAddress,
    unlinkEthAddress,
    exportBackup,
    lastBackupChecksum,
    storageMode,
    isLoaded,
    updateAccount,
    identityProtobuf: state.account.identityProtobuf,
    localPeerId: state.account.localPeerId,
  };
}