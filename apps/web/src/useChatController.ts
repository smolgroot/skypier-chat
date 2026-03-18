import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEncryptedBackupBundle, createPinataUploadRequest } from '@skypier/backup';
import { SKYPIER_MEDIA_PREFIX } from '@skypier/network';
import type { WireEnvelope } from '@skypier/network';
import type { ChatMessage, LinkedEthAddress, MediaAttachment } from '@skypier/protocol';
import {
  createChatRepository,
  createLocalMessage,
  createInitialChatState,
  getCurrentDevice,
  updateMessageDelivery,
  type PersistedChatState,
  toggleMessageReaction,
} from '@skypier/storage';

const CURRENT_USER_ID = 'user-1';

// ─── Image compression ────────────────────────────────────────────────────────
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB hard cap post-compression

async function compressImage(file: File): Promise<{
  dataUri: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_EDGE = 1280;
      let { naturalWidth: width, naturalHeight: height } = img;
      if (width > MAX_EDGE || height > MAX_EDGE) {
        const ratio = Math.min(MAX_EDGE / width, MAX_EDGE / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      const dataUri = canvas.toDataURL('image/jpeg', 0.75);
      const base64 = dataUri.split(',')[1] ?? '';
      const approxBytes = Math.ceil(base64.length * 0.75);
      if (approxBytes > MAX_IMAGE_BYTES) {
        reject(new Error(
          `Image is ${(approxBytes / 1024 / 1024).toFixed(1)} MB after compression. Maximum allowed is 2 MB.`
        ));
        return;
      }
      resolve({ dataUri, width, height, size: approxBytes, mimeType: 'image/jpeg' });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image file.'));
    };
    img.src = url;
  });
}

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
          id: normalizedPeerId,
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

  const sendImageMessage = useCallback(async (file: File): Promise<ChatMessage | undefined> => {
    if (!selectedConversation) return undefined;

    const { dataUri, width, height, size, mimeType } = await compressImage(file);
    const attachmentId = `att-${Math.random().toString(36).slice(2, 10)}`;

    const currentDevice = getCurrentDevice();
    const recipientDeviceIds = selectedConversation.participants
      .flatMap((p) => p.devices)
      .filter((d) => d.id !== currentDevice.id)
      .map((d) => d.id);

    const baseMessage = createLocalMessage({
      conversationId: selectedConversation.id,
      senderId: CURRENT_USER_ID,
      senderDisplayName: stateRef.current.account.displayName,
      senderDeviceId: currentDevice.id,
      previewText: '📷 Photo',
      recipientDeviceIds,
    });

    const messageWithAttachment: ChatMessage = {
      ...baseMessage,
      attachments: [{ id: attachmentId, mimeType, dataUri, width, height, size }],
    };

    const snap = stateRef.current;
    const nextMessages = [
      ...(snap.messagesByConversation[selectedConversation.id] ?? []),
      messageWithAttachment,
    ];
    const nextState: PersistedChatState = {
      ...snap,
      conversations: snap.conversations.map((c) =>
        c.id === selectedConversation.id
          ? { ...c, lastMessagePreview: '📷 Photo', updatedAt: messageWithAttachment.createdAt }
          : c
      ),
      messagesByConversation: {
        ...snap.messagesByConversation,
        [selectedConversation.id]: nextMessages,
      },
    };

    await persistState(nextState);
    return messageWithAttachment;
  }, [persistState, selectedConversation]);

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
      console.log('[skypier:controller] ignoring non-message envelope kind:', envelope.kind);
      return;
    }

    // Detect media attachment via wire prefix
    const isImagePayload = envelope.payload.startsWith(SKYPIER_MEDIA_PREFIX);
    const payloadPreviewText = isImagePayload ? '📷 Photo' : envelope.payload;
    let incomingAttachments: MediaAttachment[] | undefined;
    if (isImagePayload) {
      try {
        const att = JSON.parse(envelope.payload.slice(SKYPIER_MEDIA_PREFIX.length)) as MediaAttachment;
        incomingAttachments = [att];
      } catch {
        // malformed payload — fall back to text display
      }
    }

    const snap = stateRef.current;
    const currentSelectedId = selectedConversationIdRef.current;
    let existingConversation = snap.conversations.find((conversation) => conversation.id === envelope.conversationId);
    
    // If not found by exact ID, see if we already have a 1-on-1 chat with this peer to prevent duplicate channels
    if (!existingConversation) {
      existingConversation = snap.conversations.find((conversation) =>
        conversation.participants.some((p) => p.peerId === fromPeerId)
      );
    }

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
          id: fromPeerId,
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
      lastMessagePreview: payloadPreviewText,
      unreadCount: currentSelectedId === envelope.conversationId ? 0 : 1,
      reachability: 'direct' as const,
      updatedAt: envelope.sentAt,
    };

    const incomingMessage: ChatMessage = {
      id: `net-${Math.random().toString(36).slice(2, 10)}`,
      conversationId: conversation.id,
      senderId: fromPeerId,
      senderDisplayName: conversation.title,
      senderDeviceId: `device-${fromPeerId}`,
      createdAt: envelope.sentAt,
      previewText: payloadPreviewText,
      ciphertext: {
        algorithm: 'xchacha20poly1305',
        // transport encryption is handled by libp2p Noise; store a safe placeholder
        ciphertext: isImagePayload ? '' : (() => { try { return btoa(envelope.payload); } catch { return ''; } })(),
        nonce: 'network-stream',
        recipientDeviceIds: [getCurrentDevice().id],
      },
      delivery: 'delivered',
      reactions: [],
      ...(incomingAttachments ? { attachments: incomingAttachments } : {}),
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

    console.log('[skypier:controller] ingested message from', fromPeerId,
      existingConversation ? '(existing conv)' : '(NEW conv auto-created)',
      'conv:', conversation.id,
      'total msgs now:', nextMessages.length,
    );
    await persistState(nextState);
  }, [persistState]);

  const updateMessageDeliveryStatus = useCallback(async (
    messageId: string,
    delivery: ChatMessage['delivery'],
  ) => {
    const snap = stateRef.current;
    const nextState = updateMessageDelivery(snap, messageId, delivery);
    if (nextState !== snap) {
      await persistState(nextState);
    }
  }, [persistState]);

  const deleteConversation = useCallback(async (conversationId: string) => {
    const snap = stateRef.current;
    const nextConversations = snap.conversations.filter((c) => c.id !== conversationId);
    const { [conversationId]: _removed, ...nextMessagesByConversation } = snap.messagesByConversation;

    const nextState: PersistedChatState = {
      ...snap,
      conversations: nextConversations,
      messagesByConversation: nextMessagesByConversation,
    };

    await persistState(nextState);

    // If the deleted conversation was selected, deselect it
    if (selectedConversationIdRef.current === conversationId) {
      setSelectedConversationId('');
    }
  }, [persistState]);

  const saveContact = useCallback(async (contactId: string, peerId: string, displayName: string, avatarUrl?: string) => {
    const snap = stateRef.current;
    const existing = (snap.contacts || []).filter(c => c.id !== contactId);
    
    const nextState: PersistedChatState = {
      ...snap,
      contacts: [...existing, {
        id: contactId,
        peerId,
        displayName,
        avatarUrl,
        addedAt: new Date().toISOString()
      }]
    };
    await persistState(nextState);
  }, [persistState]);

  const deleteContact = useCallback(async (contactId: string) => {
    const snap = stateRef.current;
    const nextState: PersistedChatState = {
      ...snap,
      contacts: (snap.contacts || []).filter(c => c.id !== contactId)
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
    sendImageMessage,
    replyTarget,
    selectReplyTarget,
    clearReplyTarget: () => setReplyTargetId(undefined),
    toggleReaction,
    deleteConversation,
    saveContact,
    deleteContact,
    contacts: state.contacts ?? [],
    ingestIncomingEnvelope,
    updateMessageDeliveryStatus,
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