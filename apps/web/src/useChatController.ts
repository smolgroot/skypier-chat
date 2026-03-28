import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEncryptedBackupBundle, createPinataUploadRequest } from '@skypier/backup';
import { decryptMessageEnvelope, exportDevicePreKeyBundle } from '@skypier/crypto';
import { parseE2EEWirePayload, serializeE2EEWirePayload, SKYPIER_MEDIA_PREFIX, type SyncMessageEntry } from '@skypier/network';
import type { WireEnvelope } from '@skypier/network';
import {
  parseChatReactionEventPayload,
  serializeChatReactionEvent,
  type AudioCallEndReason,
  type ChatMessage,
  type ChatReactionEvent,
  type ChatSystemEvent,
  type DevicePreKeyBundle,
  type LinkedEthAddress,
  type MediaAttachment,
} from '@skypier/protocol';
import {
  createChatRepository,
  createLocalMessage,
  createInitialChatState,
  getCurrentDevice,
  saveAttachmentBlob,
  updateMessageDelivery,
  type PersistedChatState,
} from '@skypier/storage';

const CURRENT_USER_ID = 'user-1';
const PLACEHOLDER_LOCAL_PEER_ID = '12D3KooWLocalPeer';

function decodeBase64Utf8(value: string): string | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function isPlaceholderLocalPeerId(peerId: string | undefined): boolean {
  if (!peerId) return true;
  return peerId === PLACEHOLDER_LOCAL_PEER_ID || peerId.includes('LocalPeer');
}

function resolveLocalPeerId(snap: PersistedChatState): string {
  const accountPeerId = snap.account.localPeerId?.trim();
  if (accountPeerId && !isPlaceholderLocalPeerId(accountPeerId)) {
    return accountPeerId;
  }

  for (const conversation of snap.conversations) {
    const selfParticipant = conversation.participants.find((participant) => participant.id === CURRENT_USER_ID);
    const peerId = selfParticipant?.peerId?.trim();
    if (peerId && !isPlaceholderLocalPeerId(peerId)) {
      return peerId;
    }
  }

  const devicePeerId = getCurrentDevice().peerId?.trim();
  if (devicePeerId && !isPlaceholderLocalPeerId(devicePeerId)) {
    return devicePeerId;
  }

  return accountPeerId ?? devicePeerId ?? PLACEHOLDER_LOCAL_PEER_ID;
}

function buildCurrentDeviceIdentity(snap: PersistedChatState) {
  const currentDevice = getCurrentDevice();
  const localPeerId = resolveLocalPeerId(snap);

  return {
    ...currentDevice,
    peerId: localPeerId,
    ...(snap.account.deviceCryptoState ? {
      preKeyBundle: exportDevicePreKeyBundle(snap.account.deviceCryptoState),
    } : {}),
  };
}

async function decryptIncomingPayload(
  payload: ReturnType<typeof parseE2EEWirePayload>,
  snap: PersistedChatState,
): Promise<string | null> {
  if (!payload?.keyWraps || !snap.account.deviceCryptoState) {
    return null;
  }

  try {
    return await decryptMessageEnvelope({
      deviceCryptoState: snap.account.deviceCryptoState,
      envelope: {
        v: 1,
        algorithm: payload.algorithm,
        ciphertext: payload.ciphertext,
        nonce: payload.nonce,
        senderKeyId: payload.senderKeyId ?? payload.senderDeviceId,
        aad: payload.aad,
        keyWraps: payload.keyWraps,
      },
    });
  } catch {
    return null;
  }
}

function normalizeNetworkMessageId(messageId: string): string {
  return messageId.startsWith('net-') ? messageId.slice(4) : messageId;
}

function messageIdsMatch(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  return normalizeNetworkMessageId(left) === normalizeNetworkMessageId(right);
}

function upsertReactionAuthors(
  message: ChatMessage,
  emoji: string,
  authorPeerId: string,
  action: 'add' | 'remove',
): ChatMessage {
  const existingReaction = message.reactions.find((reaction) => reaction.emoji === emoji);

  if (action === 'add') {
    if (!existingReaction) {
      return {
        ...message,
        reactions: [...message.reactions, { emoji, authors: [authorPeerId] }],
      };
    }

    if (existingReaction.authors.includes(authorPeerId)) {
      return message;
    }

    return {
      ...message,
      reactions: message.reactions.map((reaction) => reaction.emoji === emoji
        ? { ...reaction, authors: [...reaction.authors, authorPeerId] }
        : reaction),
    };
  }

  if (!existingReaction || !existingReaction.authors.includes(authorPeerId)) {
    return message;
  }

  const nextAuthors = existingReaction.authors.filter((candidate) => candidate !== authorPeerId);
  return {
    ...message,
    reactions: nextAuthors.length > 0
      ? message.reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, authors: nextAuthors } : reaction)
      : message.reactions.filter((reaction) => reaction.emoji !== emoji),
  };
}

function isReactionControlMessage(message: ChatMessage): boolean {
  return parseChatReactionEventPayload(message.previewText) != null;
}

function applyReactionEventToConversationMessages(
  conversationMessages: ChatMessage[],
  reactionEvent: ChatReactionEvent,
): { nextMessages: ChatMessage[]; applied: boolean } {
  let applied = false;
  const nextMessages = conversationMessages.map((message) => {
    if (!messageIdsMatch(message.id, reactionEvent.msgId)) {
      return message;
    }

    const updated = upsertReactionAuthors(message, reactionEvent.emoji, reactionEvent.actorPeerId, reactionEvent.action);
    if (updated !== message) {
      applied = true;
    }

    return updated;
  });

  return { nextMessages, applied };
}

function isDevicePreKeyBundle(value: unknown): value is DevicePreKeyBundle {
  if (value == null || typeof value !== 'object') {
    return false;
  }

  const bundle = value as Partial<DevicePreKeyBundle>;
  return bundle.version === 1
    && bundle.algorithm === 'x25519'
    && typeof bundle.deviceId === 'string'
    && typeof bundle.peerId === 'string'
    && typeof bundle.identityPublicKey === 'string'
    && typeof bundle.preKeyId === 'string'
    && typeof bundle.preKeyPublicKey === 'string'
    && typeof bundle.createdAt === 'string';
}

/** Stores a received remote prekey bundle on matching participant devices. */
function applyReceivedPreKeyBundle(
  snap: PersistedChatState,
  fromPeerId: string,
  bundle: DevicePreKeyBundle,
): PersistedChatState {
  let changed = false;

  const nextConversations = snap.conversations.map((conversation) => {
    const hasSender = conversation.participants.some((participant) => participant.peerId === fromPeerId);
    if (!hasSender) {
      return conversation;
    }

    const nextParticipants = conversation.participants.map((participant) => {
      if (participant.peerId !== fromPeerId) {
        return participant;
      }

      const deviceIndex = participant.devices.findIndex((device) => device.peerId === fromPeerId);
      if (deviceIndex < 0) {
        changed = true;
        return {
          ...participant,
          devices: [
            ...participant.devices,
            {
              id: bundle.deviceId,
              label: 'Remote device',
              peerId: fromPeerId,
              platform: 'web' as const,
              trustLevel: 'software' as const,
              preKeyBundle: bundle,
            },
          ],
        };
      }

      const existing = participant.devices[deviceIndex];
      if (
        existing.preKeyBundle?.deviceId === bundle.deviceId
        && existing.preKeyBundle?.preKeyId === bundle.preKeyId
      ) {
        return participant;
      }

      changed = true;
      return {
        ...participant,
        devices: participant.devices.map((device, idx) =>
          idx === deviceIndex
            ? {
                ...device,
                id: bundle.deviceId,
                preKeyBundle: bundle,
              }
            : device,
        ),
      };
    });

    return {
      ...conversation,
      participants: nextParticipants,
    };
  });

  return changed
    ? {
        ...snap,
        conversations: nextConversations,
      }
    : snap;
}

// ─── Image compression ────────────────────────────────────────────────────────
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB hard cap post-compression
const MAX_MESSAGES_PER_CONVERSATION = (() => {
  const raw = Number(import.meta.env.VITE_MAX_MESSAGES_PER_CONVERSATION ?? '300');
  if (!Number.isFinite(raw)) return 300;
  return Math.max(100, Math.min(1000, Math.floor(raw)));
})();

function capConversationMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_MESSAGES_PER_CONVERSATION) {
    return messages;
  }
  return messages.slice(messages.length - MAX_MESSAGES_PER_CONVERSATION);
}

async function compressImage(file: File): Promise<{
  dataUri: string;
  blob: Blob;
  previewDataUri: string;
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
      const MAX_EDGE = 960;
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
      const dataUri = canvas.toDataURL('image/jpeg', 0.65);
      const previewScale = Math.min(1, 320 / Math.max(width, height));
      const previewWidth = Math.max(1, Math.round(width * previewScale));
      const previewHeight = Math.max(1, Math.round(height * previewScale));
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = previewWidth;
      previewCanvas.height = previewHeight;
      previewCanvas.getContext('2d')!.drawImage(img, 0, 0, previewWidth, previewHeight);
      const previewDataUri = previewCanvas.toDataURL('image/jpeg', 0.5);
      previewCanvas.width = 0;
      previewCanvas.height = 0;
      // Release GPU/canvas backing store memory as soon as we're done encoding.
      canvas.width = 0;
      canvas.height = 0;
      const base64 = dataUri.split(',')[1] ?? '';
      const approxBytes = Math.ceil(base64.length * 0.75);
      if (approxBytes > MAX_IMAGE_BYTES) {
        reject(new Error(
          `Image is ${(approxBytes / 1024 / 1024).toFixed(1)} MB after compression. Maximum allowed is 2 MB.`
        ));
        return;
      }
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      resolve({ dataUri, blob, previewDataUri, width, height, size: approxBytes, mimeType: 'image/jpeg' });
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

  const messages = useMemo(() => {
    if (!selectedConversation) {
      return [] as ChatMessage[];
    }

    const rawMessages = state.messagesByConversation[selectedConversation.id] ?? [];
    const seen = new Set<string>();
    const deduped: ChatMessage[] = [];

    for (const message of rawMessages) {
      if (isReactionControlMessage(message)) {
        continue;
      }
      if (seen.has(message.id)) {
        continue;
      }
      seen.add(message.id);
      deduped.push(message);
    }

    return deduped;
  }, [selectedConversation, state.messagesByConversation]);
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

    const currentDevice = buildCurrentDeviceIdentity(stateRef.current);
    const localPeerId = resolveLocalPeerId(stateRef.current);
    const conversationId = `conv-${normalizedPeerId.slice(-8)}-${Math.random().toString(36).slice(2, 6)}`;
    const title = (displayName?.trim() || `Peer ${normalizedPeerId.slice(0, 10)}…`);

    const newConversation = {
      id: conversationId,
      title,
      participants: [
        {
          id: CURRENT_USER_ID,
          displayName: stateRef.current.account.displayName,
          peerId: localPeerId,
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

  const markConversationRead = useCallback(async (conversationId: string) => {
    if (!conversationId) {
      return;
    }

    const snap = stateRef.current;
    let changed = false;
    const nextConversations = snap.conversations.map((conversation) => {
      if (conversation.id !== conversationId || conversation.unreadCount === 0) {
        return conversation;
      }

      changed = true;
      return {
        ...conversation,
        unreadCount: 0,
      };
    });

    if (!changed) {
      return;
    }

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

    const snap = stateRef.current;
    const currentMessages = snap.messagesByConversation[selectedConversation.id] ?? [];
    const nextMessages = capConversationMessages([...currentMessages, nextMessage]);
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
  }, [composerValue, persistState, replyTarget, selectedConversation]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string): Promise<ChatReactionEvent | undefined> => {
    if (!selectedConversation || !messageId) {
      return undefined;
    }

    const snap = stateRef.current;
    const localPeerId = resolveLocalPeerId(snap);
    const currentMessages = snap.messagesByConversation[selectedConversation.id] ?? [];
    const targetMessage = currentMessages.find((message) => message.id === messageId);

    if (!targetMessage) {
      return undefined;
    }

    const existingReaction = targetMessage.reactions.find((reaction) => reaction.emoji === emoji);
    const hasLocalReaction = existingReaction?.authors.includes(localPeerId) ?? false;
    const reactionEvent: ChatReactionEvent = {
      v: 1,
      opId: `react-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`,
      convId: selectedConversation.id,
      msgId: targetMessage.id,
      emoji,
      actorPeerId: localPeerId,
      action: hasLocalReaction ? 'remove' : 'add',
      at: new Date().toISOString(),
    };

    const { nextMessages: updatedMessages } = applyReactionEventToConversationMessages(currentMessages, reactionEvent);
    const nextMessages = [
      ...updatedMessages,
      {
        id: `react-op-${reactionEvent.opId}`,
        conversationId: selectedConversation.id,
        senderId: CURRENT_USER_ID,
        senderDisplayName: snap.account.displayName,
        senderDeviceId: getCurrentDevice().id,
        createdAt: reactionEvent.at,
        previewText: serializeChatReactionEvent(reactionEvent),
        ciphertext: {
          algorithm: 'xchacha20poly1305' as const,
          ciphertext: '',
          nonce: 'reaction-event',
          recipientDeviceIds: [getCurrentDevice().id],
        },
        delivery: 'sent' as const,
        reactions: [],
      },
    ];

    const nextState: PersistedChatState = {
      ...snap,
      messagesByConversation: {
        ...snap.messagesByConversation,
        [selectedConversation.id]: nextMessages,
      },
    };

    await persistState(nextState);
    return reactionEvent;
  }, [persistState, selectedConversation]);

  const selectReplyTarget = useCallback((message: ChatMessage) => {
    setReplyTargetId(message.id);
  }, []);

  const sendImageMessage = useCallback(async (file: File): Promise<ChatMessage | undefined> => {
    if (!selectedConversation) return undefined;

    const { blob, previewDataUri, width, height, size, mimeType } = await compressImage(file);
    const attachmentId = `att-${Math.random().toString(36).slice(2, 10)}`;
    const attachmentStorageKey = `blob-${attachmentId}`;

    await saveAttachmentBlob(attachmentStorageKey, blob).catch(() => {});

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
      attachments: [{ id: attachmentId, mimeType, dataUri: previewDataUri, storageKey: attachmentStorageKey, width, height, size }],
    };

    const snap = stateRef.current;
    const nextMessages = capConversationMessages([
      ...(snap.messagesByConversation[selectedConversation.id] ?? []),
      messageWithAttachment,
    ]);
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
    deviceCryptoState?: PersistedChatState['account']['deviceCryptoState'];
    themePreference?: 'light' | 'dark';
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
        deviceCryptoState: updates.deviceCryptoState ?? snap.account.deviceCryptoState,
        themePreference: updates.themePreference ?? snap.account.themePreference,
        biometricUnlockEnabled: updates.biometricUnlockEnabled ?? snap.account.biometricUnlockEnabled,
        biometricCredentialId: updates.biometricCredentialId ?? snap.account.biometricCredentialId,
      },
    };
    await persistState(nextState);
  }, [persistState]);

  const appendCallHistoryEntry = useCallback(async (params: {
    conversationId: string;
    callId: string;
    eventType: ChatSystemEvent['type'];
    direction: 'incoming' | 'outgoing';
    createdAt?: string;
    endedReason?: AudioCallEndReason;
    durationMs?: number;
  }) => {
    const snap = stateRef.current;
    const conversation = snap.conversations.find((entry) => entry.id === params.conversationId);
    if (!conversation) {
      return;
    }

    const eventId = `sys-call-${params.callId}-${params.eventType}`;
    const currentMessages = snap.messagesByConversation[params.conversationId] ?? [];
    if (currentMessages.some((message) => message.id === eventId)) {
      return;
    }

    const createdAt = params.createdAt ?? new Date().toISOString();
    const previewText = params.eventType === 'call-attempted'
      ? `${params.direction === 'incoming' ? 'Incoming' : 'Outgoing'} audio call`
      : params.endedReason === 'busy'
        ? 'Call ended · busy'
        : params.endedReason === 'declined'
          ? 'Call ended · declined'
          : params.endedReason === 'missed'
            ? 'Call ended · missed'
            : params.endedReason === 'error'
              ? 'Call ended · failed'
              : 'Call ended';

    const systemMessage: ChatMessage = {
      id: eventId,
      conversationId: params.conversationId,
      senderId: 'system',
      senderDisplayName: 'System',
      senderDeviceId: 'system',
      createdAt,
      previewText,
      ciphertext: {
        algorithm: 'xchacha20poly1305',
        ciphertext: '',
        nonce: 'system-event',
        recipientDeviceIds: [getCurrentDevice().id],
      },
      delivery: 'delivered',
      reactions: [],
      systemEvent: {
        type: params.eventType,
        callId: params.callId,
        direction: params.direction,
        endedReason: params.endedReason,
        durationMs: params.durationMs,
      },
    };

    const nextMessages = capConversationMessages([...currentMessages, systemMessage].sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    ));

    const nextState: PersistedChatState = {
      ...snap,
      conversations: snap.conversations.map((entry) =>
        entry.id === params.conversationId
          ? {
              ...entry,
              lastMessagePreview: previewText,
              updatedAt: createdAt,
            }
          : entry,
      ),
      messagesByConversation: {
        ...snap.messagesByConversation,
        [params.conversationId]: nextMessages,
      },
    };

    await persistState(nextState);
  }, [persistState]);

  const ingestIncomingEnvelope = useCallback(async (envelope: WireEnvelope, fromPeerId: string) => {
    if (envelope.kind === 'sync') {
      console.log('[skypier:controller] sync envelope received from', fromPeerId);
      try {
        const syncData = JSON.parse(envelope.payload) as {
          type?: string;
          messages?: SyncMessageEntry[];
          preKeyBundle?: unknown;
        };
        if (syncData.type === 'state') {
          // Build a dedup set of all known message IDs across all conversations
          let snap = stateRef.current;
          if (isDevicePreKeyBundle(syncData.preKeyBundle) && syncData.preKeyBundle.peerId === fromPeerId) {
            snap = applyReceivedPreKeyBundle(snap, fromPeerId, syncData.preKeyBundle);
          }

          if (!Array.isArray(syncData.messages) || syncData.messages.length === 0) {
            if (snap !== stateRef.current) {
              await persistState(snap);
            }
            return;
          }

          const knownIds = new Set<string>(
            Object.values(snap.messagesByConversation).flatMap((msgs) => msgs.map((m) => m.id)),
          );
          let changed = false;

          for (const entry of syncData.messages) {
            const stableId = `net-${entry.messageId}`;
            if (knownIds.has(stableId)) continue; // already ingested
            knownIds.add(stableId); // prevent double-ingest within this batch

            const reactionEvent = parseChatReactionEventPayload(entry.payload);
            if (reactionEvent) {
              const conversationForReaction = snap.conversations.find((c) => c.id === entry.conversationId)
                ?? snap.conversations.find((c) => c.participants.some((p) => p.peerId === entry.senderPeerId));

              if (!conversationForReaction) {
                continue;
              }

              const normalizedReactionEvent: ChatReactionEvent = {
                ...reactionEvent,
                convId: conversationForReaction.id,
                actorPeerId: entry.senderPeerId,
              };

              const currentMessagesForConversation = snap.messagesByConversation[conversationForReaction.id] ?? [];
              const { nextMessages: reactedMessages, applied } = applyReactionEventToConversationMessages(
                currentMessagesForConversation,
                normalizedReactionEvent,
              );

              if (!applied) {
                continue;
              }

              snap = {
                ...snap,
                messagesByConversation: {
                  ...snap.messagesByConversation,
                  [conversationForReaction.id]: reactedMessages,
                },
              };
              changed = true;
              continue;
            }

            const isImagePayload = entry.payload.startsWith(SKYPIER_MEDIA_PREFIX);
            const parsedE2EEPayload = isImagePayload ? null : parseE2EEWirePayload(entry.payload);
            const decryptedPayload = parsedE2EEPayload ? await decryptIncomingPayload(parsedE2EEPayload, snap) : null;
            const payloadPreviewText = isImagePayload
              ? '📷 Photo'
              : parsedE2EEPayload
                ? decryptedPayload ?? '🔐 Encrypted message'
                : entry.payload;
            let incomingAttachments: MediaAttachment[] | undefined;
            if (isImagePayload) {
              try {
                const att = JSON.parse(entry.payload.slice(SKYPIER_MEDIA_PREFIX.length)) as MediaAttachment;
                incomingAttachments = [att];
              } catch { /* ignore malformed */ }
            }

            const currentSelectedId = selectedConversationIdRef.current;
            const existingConversation =
              snap.conversations.find((c) => c.id === entry.conversationId) ??
              snap.conversations.find((c) => c.participants.some((p) => p.peerId === entry.senderPeerId));

            const conversation = existingConversation ?? {
              id: entry.conversationId,
              title: `Peer ${entry.senderPeerId.slice(0, 10)}…`,
              participants: [
                { id: CURRENT_USER_ID, displayName: snap.account.displayName, peerId: resolveLocalPeerId(snap), devices: [buildCurrentDeviceIdentity(snap)] },
                {
                  id: entry.senderPeerId,
                  displayName: `Peer ${entry.senderPeerId.slice(0, 10)}…`,
                  peerId: entry.senderPeerId,
                  devices: [{ id: `device-${entry.senderPeerId}`, label: 'Remote device', peerId: entry.senderPeerId, platform: 'web' as const, trustLevel: 'software' as const }],
                },
              ],
              lastMessagePreview: payloadPreviewText,
              unreadCount: currentSelectedId === entry.conversationId ? 0 : 1,
              reachability: 'direct' as const,
              updatedAt: entry.sentAt,
            };

            const incomingMessage: ChatMessage = {
              id: stableId,
              conversationId: conversation.id,
              senderId: entry.senderPeerId,
              senderDisplayName: existingConversation?.title ?? conversation.title,
              senderDeviceId: `device-${entry.senderPeerId}`,
              createdAt: entry.sentAt,
              previewText: payloadPreviewText,
              ciphertext: {
                algorithm: parsedE2EEPayload?.algorithm ?? 'xchacha20poly1305',
                ciphertext: isImagePayload
                  ? ''
                  : parsedE2EEPayload?.ciphertext
                    ?? (() => { try { return btoa(payloadPreviewText); } catch { return ''; } })(),
                nonce: parsedE2EEPayload?.nonce ?? 'sync-replay',
                recipientDeviceIds: parsedE2EEPayload?.recipientDeviceIds ?? [getCurrentDevice().id],
                senderKeyId: parsedE2EEPayload?.senderKeyId,
                aad: parsedE2EEPayload?.aad,
                keyWraps: parsedE2EEPayload?.keyWraps,
              },
              delivery: 'delivered',
              reactions: [],
              ...(incomingAttachments ? { attachments: incomingAttachments } : {}),
            };

            const currentMessages = snap.messagesByConversation[conversation.id] ?? [];
            const nextMessages = capConversationMessages([...currentMessages, incomingMessage]);
            const nextConversations = existingConversation
              ? snap.conversations.map((c) =>
                  c.id === conversation.id
                    ? {
                        ...c,
                        lastMessagePreview: incomingMessage.previewText,
                        updatedAt: incomingMessage.createdAt,
                        unreadCount: currentSelectedId === conversation.id ? c.unreadCount : c.unreadCount + 1,
                      }
                    : c,
                )
              : [conversation, ...snap.conversations];

            snap = {
              ...snap,
              conversations: nextConversations,
              messagesByConversation: { ...snap.messagesByConversation, [conversation.id]: nextMessages },
            };
            changed = true;
            console.log('[skypier:controller] sync replay: ingested missed message', entry.messageId, 'from', entry.senderPeerId, 'in conv', entry.conversationId);
          }

          if (changed) {
            console.log('[skypier:controller] sync replay complete from', fromPeerId, '(persisting state)');
            await persistState(snap);
          }
        }
      } catch (err) {
        console.warn('[skypier:controller] failed to process sync payload:', err instanceof Error ? err.message : err);
      }
      return;
    }

    if (envelope.kind !== 'message') {
      console.log('[skypier:controller] ignoring non-message envelope kind:', envelope.kind);
      return;
    }

    const reactionEvent = parseChatReactionEventPayload(envelope.payload);
    if (reactionEvent) {
      const snap = stateRef.current;
      const existingConversation = snap.conversations.find((conversation) => conversation.id === envelope.conversationId)
        ?? snap.conversations.find((conversation) => conversation.participants.some((p) => p.peerId === fromPeerId));

      if (!existingConversation) {
        return;
      }

      const normalizedReactionEvent: ChatReactionEvent = {
        ...reactionEvent,
        convId: existingConversation.id,
        actorPeerId: fromPeerId,
      };

      const currentMessages = snap.messagesByConversation[existingConversation.id] ?? [];
      const { nextMessages, applied } = applyReactionEventToConversationMessages(currentMessages, normalizedReactionEvent);

      if (!applied) {
        return;
      }

      await persistState({
        ...snap,
        messagesByConversation: {
          ...snap.messagesByConversation,
          [existingConversation.id]: nextMessages,
        },
      });
      return;
    }

    const snap = stateRef.current;
    // Detect media attachment via wire prefix
    const isImagePayload = envelope.payload.startsWith(SKYPIER_MEDIA_PREFIX);
    const parsedE2EEPayload = isImagePayload ? null : parseE2EEWirePayload(envelope.payload);
    const decryptedPayload = parsedE2EEPayload ? await decryptIncomingPayload(parsedE2EEPayload, snap) : null;
    const payloadPreviewText = isImagePayload
      ? '📷 Photo'
      : parsedE2EEPayload
        ? decryptedPayload ?? '🔐 Encrypted message'
        : envelope.payload;
    let incomingAttachments: MediaAttachment[] | undefined;
    if (isImagePayload) {
      try {
        const att = JSON.parse(envelope.payload.slice(SKYPIER_MEDIA_PREFIX.length)) as MediaAttachment;
        incomingAttachments = [att];
      } catch {
        // malformed payload — fall back to text display
      }
    }

    const localPeerId = resolveLocalPeerId(snap);
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
          peerId: localPeerId,
          devices: [buildCurrentDeviceIdentity(snap)],
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
      id: envelope.messageId ? `net-${envelope.messageId}` : `net-${Math.random().toString(36).slice(2, 10)}`,
      conversationId: conversation.id,
      senderId: fromPeerId,
      senderDisplayName: conversation.title,
      senderDeviceId: `device-${fromPeerId}`,
      createdAt: envelope.sentAt,
      previewText: payloadPreviewText,
      ciphertext: {
        algorithm: parsedE2EEPayload?.algorithm ?? 'xchacha20poly1305',
        ciphertext: isImagePayload
          ? ''
          : parsedE2EEPayload?.ciphertext
            ?? (() => { try { return btoa(payloadPreviewText); } catch { return ''; } })(),
        nonce: parsedE2EEPayload?.nonce ?? 'network-stream',
        recipientDeviceIds: parsedE2EEPayload?.recipientDeviceIds ?? [getCurrentDevice().id],
        senderKeyId: parsedE2EEPayload?.senderKeyId,
        aad: parsedE2EEPayload?.aad,
        keyWraps: parsedE2EEPayload?.keyWraps,
      },
      delivery: 'delivered',
      reactions: [],
      ...(incomingAttachments ? { attachments: incomingAttachments } : {}),
    };

    const currentMessages = snap.messagesByConversation[conversation.id] ?? [];

    // Deduplicate network replays/retries: the same envelope.messageId can be
    // delivered more than once (e.g. retry loops, reconnect races, sync replay).
    // If we append duplicates, React list keys collide and spam warnings.
    if (currentMessages.some((message) => message.id === incomingMessage.id)) {
      console.log('[skypier:controller] duplicate inbound message ignored:', incomingMessage.id, 'conv:', conversation.id);
      return;
    }

    const nextMessages = capConversationMessages([...currentMessages, incomingMessage]);

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

  const updateMessageCiphertext = useCallback(async (
    messageId: string,
    ciphertext: ChatMessage['ciphertext'],
  ) => {
    const snap = stateRef.current;
    const nextMessagesByConversation = { ...snap.messagesByConversation };
    let changed = false;

    for (const conversationId of Object.keys(nextMessagesByConversation)) {
      const currentMessages = nextMessagesByConversation[conversationId] ?? [];
      const targetIndex = currentMessages.findIndex((message) => message.id === messageId);
      if (targetIndex === -1) {
        continue;
      }

      const nextMessages = [...currentMessages];
      nextMessages[targetIndex] = {
        ...nextMessages[targetIndex],
        ciphertext,
      };
      nextMessagesByConversation[conversationId] = nextMessages;
      changed = true;
      break;
    }

    if (!changed) {
      return;
    }

    await persistState({
      ...snap,
      messagesByConversation: nextMessagesByConversation,
    });
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

  const deleteMessage = useCallback(async (messageId: string) => {
    const snap = stateRef.current;
    const nextMessages = { ...snap.messagesByConversation };
    for (const convId of Object.keys(nextMessages)) {
      const msgs = nextMessages[convId];
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx !== -1) {
        nextMessages[convId] = msgs.filter((m) => m.id !== messageId);
        break;
      }
    }
    await persistState({ ...snap, messagesByConversation: nextMessages });
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

  /**
   * Returns the local user's recently-sent messages for a given peer's conversation,
   * filtered to those sent at or after `since` (ISO timestamp).
   *
   * Called by useLiveChatSession when a peer sends a sync/request — we respond
   * with these messages so the peer can ingest anything they missed.
   */
  const getRecentMessagesForPeer = useCallback((targetPeerId: string, since: string | undefined): SyncMessageEntry[] => {
    const snap = stateRef.current;
    const localPeerId = resolveLocalPeerId(snap);
    // Default to the last 10 minutes if no window is specified
    const effectiveSince = since ?? new Date(Date.now() - 10 * 60_000).toISOString();
    const sinceTime = new Date(effectiveSince).getTime();
    const results: SyncMessageEntry[] = [];

    for (const conv of snap.conversations) {
      // Only conversations involving the requesting peer
      if (!conv.participants.some((p) => p.peerId === targetPeerId)) continue;
      const msgs = snap.messagesByConversation[conv.id] ?? [];
      for (const msg of msgs) {
        // Only messages sent by us
        if (msg.senderId !== CURRENT_USER_ID) continue;
        // Only messages after the requested window
        if (new Date(msg.createdAt).getTime() < sinceTime) continue;
        const payload = msg.attachments?.length
          ? `${SKYPIER_MEDIA_PREFIX}${JSON.stringify(msg.attachments[0])}`
          : parseChatReactionEventPayload(msg.previewText)
            ? msg.previewText
            : msg.ciphertext.ciphertext.length > 0
              ? serializeE2EEWirePayload({
                  v: 1,
                  algorithm: msg.ciphertext.algorithm,
                  ciphertext: msg.ciphertext.ciphertext,
                  nonce: msg.ciphertext.nonce,
                  senderDeviceId: msg.senderDeviceId,
                  recipientDeviceIds: msg.ciphertext.recipientDeviceIds,
                  senderKeyId: msg.ciphertext.senderKeyId,
                  aad: msg.ciphertext.aad,
                  keyWraps: msg.ciphertext.keyWraps,
                })
              : msg.previewText;
        results.push({
          messageId: msg.id,
          conversationId: msg.conversationId,
          sentAt: msg.createdAt,
          payload,
          senderPeerId: localPeerId,
        });
      }
    }

    // Return at most 50, oldest first so the peer ingests them in order
    results.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
    return results.slice(0, 50);
  }, []); // stateRef is a stable ref — no reactive deps needed

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
    markConversationRead,
    sendMessage,
    sendImageMessage,
    replyTarget,
    selectReplyTarget,
    clearReplyTarget: () => setReplyTargetId(undefined),
    toggleReaction,
    deleteConversation,
    deleteMessage,
    saveContact,
    deleteContact,
    contacts: state.contacts ?? [],
    appendCallHistoryEntry,
    ingestIncomingEnvelope,
    updateMessageCiphertext,
    updateMessageDeliveryStatus,
    getRecentMessagesForPeer,
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