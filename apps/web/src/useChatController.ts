import { useCallback, useEffect, useMemo, useState } from 'react';
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
const CURRENT_USER_NAME = 'You';

export function useChatController() {
  const [state, setState] = useState<PersistedChatState>(createInitialChatState);
  const [selectedConversationId, setSelectedConversationId] = useState('');
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

  const selectedConversation = useMemo(
    () => state.conversations.find((conversation) => conversation.id === selectedConversationId),
    [selectedConversationId, state.conversations],
  );

  const messages = selectedConversation ? state.messagesByConversation[selectedConversation.id] ?? [] : [];
  const replyTarget = messages.find((message) => message.id === replyTargetId);

  const persistState = useCallback(async (nextState: PersistedChatState) => {
    setState(nextState);
    const repository = await createChatRepository();
    await repository.save(nextState);
  }, []);

  const createConversationWithPeer = useCallback(async (peerId: string, displayName?: string): Promise<string> => {
    const normalizedPeerId = peerId.trim();
    if (!normalizedPeerId) {
      throw new Error('Peer ID is required to create a chat.');
    }

    const existing = state.conversations.find((conversation) =>
      conversation.participants.some((participant) => participant.peerId === normalizedPeerId),
    );

    if (existing) {
      setSelectedConversationId(existing.id);
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
          displayName: CURRENT_USER_NAME,
          peerId: currentDevice.peerId,
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

    const nextState: PersistedChatState = {
      ...state,
      conversations: [newConversation, ...state.conversations],
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: [],
      },
    };

    await persistState(nextState);
    setSelectedConversationId(conversationId);
    return conversationId;
  }, [persistState, state]);

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

    const now = new Date().toISOString();
    const nextConversations = state.conversations.map((conversation) => {
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
      ...state,
      conversations: nextConversations,
    });
  }, [persistState, state]);

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
      senderDisplayName: CURRENT_USER_NAME,
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
    const nextState: PersistedChatState = {
      account: state.account,
      conversations: state.conversations.map((conversation) => conversation.id === selectedConversation.id ? {
        ...conversation,
        lastMessagePreview: nextMessage.previewText,
        updatedAt: nextMessage.createdAt,
      } : conversation),
      messagesByConversation: {
        ...state.messagesByConversation,
        [selectedConversation.id]: nextMessages,
      },
    };

    await persistState(nextState);
    setComposerValue('');
    setReplyTargetId(undefined);
    return nextMessage;
  }, [composerValue, messages, persistState, replyTarget, selectedConversation, state.conversations, state.messagesByConversation]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!selectedConversation || !messageId) {
      return;
    }

    const nextMessages = (state.messagesByConversation[selectedConversation.id] ?? []).map((message) => (
      message.id === messageId ? toggleMessageReaction(message, emoji, CURRENT_USER_NAME) : message
    ));

    const nextState: PersistedChatState = {
      ...state,
      messagesByConversation: {
        ...state.messagesByConversation,
        [selectedConversation.id]: nextMessages,
      },
    };

    await persistState(nextState);
  }, [persistState, selectedConversation, state]);

  const selectReplyTarget = useCallback((message: ChatMessage) => {
    setReplyTargetId(message.id);
  }, []);

  const exportBackup = useCallback(async () => {
    const bundle = await createEncryptedBackupBundle(state);
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
  }, [state]);

  const linkEthAddress = useCallback(async (wallet: LinkedEthAddress) => {
    const deduped = state.account.linkedEthAddresses.filter((entry) => entry.address !== wallet.address);

    const nextState: PersistedChatState = {
      ...state,
      account: {
        ...state.account,
        linkedEthAddresses: [wallet, ...deduped],
      },
    };

    await persistState(nextState);
  }, [persistState, state]);

  const unlinkEthAddress = useCallback(async (address: string) => {
    const nextState: PersistedChatState = {
      ...state,
      account: {
        ...state.account,
        linkedEthAddresses: state.account.linkedEthAddresses.filter((entry) => entry.address !== address.toLowerCase()),
      },
    };

    await persistState(nextState);
  }, [persistState, state]);

  const ingestIncomingEnvelope = useCallback(async (envelope: WireEnvelope, fromPeerId: string) => {
    if (envelope.kind !== 'message') {
      return;
    }

    const existingConversation = state.conversations.find((conversation) => conversation.id === envelope.conversationId);
    const conversation = existingConversation ?? {
      id: envelope.conversationId,
      title: `Peer ${fromPeerId.slice(0, 10)}…`,
      participants: [
        {
          id: CURRENT_USER_ID,
          displayName: CURRENT_USER_NAME,
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
      unreadCount: selectedConversationId === envelope.conversationId ? 0 : 1,
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

    const currentMessages = state.messagesByConversation[conversation.id] ?? [];
    const nextMessages = [...currentMessages, incomingMessage];

    const nextConversations = existingConversation
      ? state.conversations.map((candidate) => candidate.id === conversation.id ? {
        ...candidate,
        lastMessagePreview: incomingMessage.previewText,
        updatedAt: incomingMessage.createdAt,
        unreadCount: selectedConversationId === conversation.id ? candidate.unreadCount : candidate.unreadCount + 1,
      } : candidate)
      : [conversation, ...state.conversations];

    const nextState: PersistedChatState = {
      account: state.account,
      conversations: nextConversations,
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversation.id]: nextMessages,
      },
    };

    await persistState(nextState);
  }, [persistState, selectedConversationId, state.conversations, state.messagesByConversation]);

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
  };
}