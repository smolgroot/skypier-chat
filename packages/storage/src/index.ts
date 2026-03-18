import type { AccountProfile, ChatMessage, Conversation, Participant, Reaction } from '@skypier/protocol';

const participants: Participant[] = [
  {
    id: 'user-1',
    displayName: 'You',
    peerId: '12D3KooWLocalPeer',
    devices: [
      {
        id: 'device-web',
        label: 'Desktop PWA',
        peerId: '12D3KooWLocalPeer',
        platform: 'web',
        trustLevel: 'biometric',
      },
    ],
  },
  {
    id: 'user-2',
    displayName: 'Ari',
    peerId: '12D3KooWRemotePeerAri',
    devices: [
      {
        id: 'device-ari-iphone',
        label: 'Ari iPhone',
        peerId: '12D3KooWRemotePeerAri',
        platform: 'ios',
        trustLevel: 'hardware-backed',
      },
    ],
  },
  {
    id: 'user-3',
    displayName: 'Noah',
    peerId: '12D3KooWRemotePeerNoah',
    devices: [
      {
        id: 'device-noah-android',
        label: 'Noah Pixel',
        peerId: '12D3KooWRemotePeerNoah',
        platform: 'android',
        trustLevel: 'hardware-backed',
      },
    ],
  },
];

export const seededConversations: Conversation[] = [
  {
    id: 'conv-ari',
    title: 'Ari',
    participants: participants.slice(0, 2),
    lastMessagePreview: 'Pinned the recovery CID. Messages stay encrypted before backup.',
    unreadCount: 2,
    pinned: true,
    reachability: 'direct',
    updatedAt: '2026-03-16T08:42:00.000Z',
  },
  {
    id: 'conv-noah',
    title: 'Noah',
    participants: [participants[0], participants[2]],
    lastMessagePreview: 'Relay fallback is ready if AutoNAT can’t open a direct path.',
    unreadCount: 0,
    reachability: 'relayed',
    updatedAt: '2026-03-16T07:11:00.000Z',
  },
];

export const seededMessages: Record<string, ChatMessage[]> = {
  'conv-ari': [
    {
      id: 'msg-1',
      conversationId: 'conv-ari',
      senderId: 'user-2',
      senderDisplayName: 'Ari',
      senderDeviceId: 'device-ari-iphone',
      createdAt: '2026-03-16T08:20:00.000Z',
      previewText: 'I linked Pinata for encrypted backups only.',
      ciphertext: {
        algorithm: 'xchacha20poly1305',
        ciphertext: 'b64:ciphertext:1',
        nonce: 'nonce-1',
        recipientDeviceIds: ['device-web'],
      },
      delivery: 'delivered',
      reactions: [{ emoji: '🔐', authors: ['Ari'] }],
    },
    {
      id: 'msg-2',
      conversationId: 'conv-ari',
      senderId: 'user-1',
      senderDisplayName: 'You',
      senderDeviceId: 'device-web',
      createdAt: '2026-03-16T08:31:00.000Z',
      previewText: 'Great. I’m keeping the local vault biometric-gated on this device.',
      ciphertext: {
        algorithm: 'xchacha20poly1305',
        ciphertext: 'b64:ciphertext:2',
        nonce: 'nonce-2',
        recipientDeviceIds: ['device-ari-iphone'],
      },
      delivery: 'read',
      reactions: [],
    },
    {
      id: 'msg-3',
      conversationId: 'conv-ari',
      senderId: 'user-2',
      senderDisplayName: 'Ari',
      senderDeviceId: 'device-ari-iphone',
      createdAt: '2026-03-16T08:42:00.000Z',
      previewText: 'Pinned the recovery CID. Messages stay encrypted before backup.',
      ciphertext: {
        algorithm: 'xchacha20poly1305',
        ciphertext: 'b64:ciphertext:3',
        nonce: 'nonce-3',
        recipientDeviceIds: ['device-web'],
      },
      delivery: 'delivered',
      replyTo: {
        messageId: 'msg-1',
        excerpt: 'I linked Pinata for encrypted backups only.',
        authorDisplayName: 'Ari',
      },
      reactions: [{ emoji: '✅', authors: ['You'] }, { emoji: '🧠', authors: ['Ari'] }],
    },
  ],
  'conv-noah': [
    {
      id: 'msg-4',
      conversationId: 'conv-noah',
      senderId: 'user-3',
      senderDisplayName: 'Noah',
      senderDeviceId: 'device-noah-android',
      createdAt: '2026-03-16T07:11:00.000Z',
      previewText: 'Relay fallback is ready if AutoNAT can’t open a direct path.',
      ciphertext: {
        algorithm: 'xchacha20poly1305',
        ciphertext: 'b64:ciphertext:4',
        nonce: 'nonce-4',
        recipientDeviceIds: ['device-web'],
      },
      delivery: 'delivered',
      reactions: [{ emoji: '🛰️', authors: ['You', 'Noah'] }],
    },
  ],
};

export function getConversationById(conversationId: string): Conversation | undefined {
  return seededConversations.find((conversation) => conversation.id === conversationId);
}

export function getMessagesForConversation(conversationId: string): ChatMessage[] {
  return seededMessages[conversationId] ?? [];
}

export function getCurrentDevice() {
  return participants[0].devices[0];
}

export interface Contact {
  id: string; // usually the peerId
  peerId: string;
  displayName: string;
  avatarUrl?: string;
  addedAt: string;
}

export interface PersistedChatState {
  account: AccountProfile;
  conversations: Conversation[];
  messagesByConversation: Record<string, ChatMessage[]>;
  contacts?: Contact[];
}

export interface ChatRepository {
  load(): Promise<PersistedChatState>;
  save(state: PersistedChatState): Promise<void>;
  getStorageMode(): 'indexeddb' | 'localstorage' | 'memory';
}

const DATABASE_NAME = 'skypier-chat';
const OBJECT_STORE_NAME = 'vaults';
const PRIMARY_KEY = 'primary';
const LOCAL_STORAGE_KEY = 'skypier-chat:vault';
const LOCAL_STORAGE_AES_KEY = 'skypier-chat:vault-key';

let memoryFallbackPayload: string | null = null;
let cachedVaultKey: CryptoKey | null = null;

export function createInitialChatState(): PersistedChatState {
  return {
    account: {
      userId: 'user-1',
      displayName: '',
      linkedEthAddresses: [],
      biometricUnlockEnabled: false,
    },
    conversations: [],
    messagesByConversation: {},
    contacts: [],
  };
}

export function createLocalMessage(params: {
  conversationId: string;
  senderId: string;
  senderDisplayName: string;
  senderDeviceId: string;
  previewText: string;
  recipientDeviceIds: string[];
  replyTo?: ChatMessage['replyTo'];
}): ChatMessage {
  return {
    id: createId('msg'),
    conversationId: params.conversationId,
    senderId: params.senderId,
    senderDisplayName: params.senderDisplayName,
    senderDeviceId: params.senderDeviceId,
    createdAt: new Date().toISOString(),
    previewText: params.previewText,
    ciphertext: {
      algorithm: 'xchacha20poly1305',
      ciphertext: encodeBase64(params.previewText),
      nonce: createNonce(),
      recipientDeviceIds: params.recipientDeviceIds,
    },
    delivery: 'local-only',
    replyTo: params.replyTo,
    reactions: [],
  };
}

export function toggleMessageReaction(message: ChatMessage, emoji: string, author: string): ChatMessage {
  const existingReaction = message.reactions.find((reaction) => reaction.emoji === emoji);

  if (!existingReaction) {
    return {
      ...message,
      reactions: [...message.reactions, { emoji, authors: [author] }],
    };
  }

  const hasAuthor = existingReaction.authors.includes(author);
  const nextAuthors = hasAuthor
    ? existingReaction.authors.filter((candidate) => candidate !== author)
    : [...existingReaction.authors, author];

  const nextReactions: Reaction[] = nextAuthors.length > 0
    ? message.reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, authors: nextAuthors } : reaction)
    : message.reactions.filter((reaction) => reaction.emoji !== emoji);

  return {
    ...message,
    reactions: nextReactions,
  };
}

export async function createChatRepository(): Promise<ChatRepository> {
  const storageMode = resolveStorageMode();
  const saveState = async (state: PersistedChatState) => {
    const encryptedPayload = await encryptPayload(state);
    await writePersistedPayload(storageMode, encryptedPayload);
  };

  return {
    async load() {
      const payload = await readPersistedPayload(storageMode);

      if (!payload) {
        const initialState = createInitialChatState();
        await saveState(initialState);
        return initialState;
      }

      try {
        return normalizePersistedState(await decryptPayload(payload));
      } catch {
        const initialState = createInitialChatState();
        await saveState(initialState);
        return initialState;
      }
    },
    async save(state) {
      await saveState(state);
    },
    getStorageMode() {
      return storageMode;
    },
  };
}

function resolveStorageMode(): 'indexeddb' | 'localstorage' | 'memory' {
  if (typeof indexedDB !== 'undefined') {
    return 'indexeddb';
  }

  if (typeof localStorage !== 'undefined') {
    return 'localstorage';
  }

  return 'memory';
}

async function readPersistedPayload(mode: 'indexeddb' | 'localstorage' | 'memory'): Promise<string | null> {
  if (mode === 'indexeddb') {
    try {
      const database = await openDatabase();
      return await new Promise<string | null>((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE_NAME, 'readonly');
        const request = transaction.objectStore(OBJECT_STORE_NAME).get(PRIMARY_KEY);

        request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_STORAGE_KEY) : memoryFallbackPayload;
    }
  }

  if (mode === 'localstorage') {
    return localStorage.getItem(LOCAL_STORAGE_KEY);
  }

  return memoryFallbackPayload;
}

async function writePersistedPayload(mode: 'indexeddb' | 'localstorage' | 'memory', payload: string): Promise<void> {
  if (mode === 'indexeddb') {
    try {
      const database = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
        transaction.objectStore(OBJECT_STORE_NAME).put(payload, PRIMARY_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      return;
    } catch {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LOCAL_STORAGE_KEY, payload);
        return;
      }
    }
  }

  if (mode === 'localstorage') {
    localStorage.setItem(LOCAL_STORAGE_KEY, payload);
    return;
  }

  memoryFallbackPayload = payload;
}

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        database.createObjectStore(OBJECT_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function encryptPayload(state: PersistedChatState): Promise<string> {
  const cryptoKey = await getVaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const serializedState = new TextEncoder().encode(JSON.stringify(state));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, serializedState);

  return JSON.stringify({
    version: 1,
    iv: bytesToBase64(iv),
    payload: bytesToBase64(new Uint8Array(encrypted)),
  });
}

async function decryptPayload(payload: string): Promise<PersistedChatState> {
  const parsed = JSON.parse(payload) as { iv: string; payload: string };
  const cryptoKey = await getVaultKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(parsed.iv)) },
    cryptoKey,
    toArrayBuffer(base64ToBytes(parsed.payload)),
  );

  return normalizePersistedState(JSON.parse(new TextDecoder().decode(decrypted)) as PersistedChatState);
}

function normalizePersistedState(raw: PersistedChatState): PersistedChatState {
  const account = raw.account ?? {
    userId: 'user-1',
    displayName: 'You',
    linkedEthAddresses: [],
  };

  return {
    account: {
      userId: account.userId ?? 'user-1',
      displayName: account.displayName ?? 'You',
      linkedEthAddresses: account.linkedEthAddresses ?? [],
      biometricUnlockEnabled: account.biometricUnlockEnabled ?? false,
      biometricCredentialId: account.biometricCredentialId,
      localPeerId: account.localPeerId,
      identityProtobuf: account.identityProtobuf,
    },
    conversations: raw.conversations ?? [],
    messagesByConversation: raw.messagesByConversation ?? {},
  };
}

async function getVaultKey(): Promise<CryptoKey> {
  if (cachedVaultKey) {
    return cachedVaultKey;
  }

  const storedKey = readPersistedVaultKey();
  const keyBytes = storedKey ?? crypto.getRandomValues(new Uint8Array(32));

  if (!storedKey) {
    persistVaultKey(keyBytes);
  }

  cachedVaultKey = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return cachedVaultKey;
}

function readPersistedVaultKey(): Uint8Array | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem(LOCAL_STORAGE_AES_KEY);
  return raw ? base64ToBytes(raw) : null;
}

function persistVaultKey(keyBytes: Uint8Array) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCAL_STORAGE_AES_KEY, bytesToBase64(keyBytes));
  }
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createNonce(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(12)));
}

function encodeBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// ─── Pending-Queue Persistence (survives page reload) ────────────────────

const PENDING_QUEUE_KEY = 'skypier-chat:pending-queue';

export interface PersistedQueueEntry {
  peerId: string;
  messageId: string;
  envelope: {
    kind: string;
    messageId?: string;
    conversationId: string;
    senderPeerId: string;
    sentAt: string;
    payload: string;
  };
  retryCount: number;
  /** ISO timestamp of the next scheduled retry */
  nextRetryAt: string;
}

export function loadPendingQueue(): PersistedQueueEntry[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PENDING_QUEUE_KEY) : null;
    return raw ? (JSON.parse(raw) as PersistedQueueEntry[]) : [];
  } catch {
    return [];
  }
}

export function savePendingQueue(entries: PersistedQueueEntry[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(entries));
    }
  } catch {
    // quota exceeded or unavailable — silently ignore
  }
}

// ─── Message Delivery-Status Helpers ─────────────────────────────────────

/**
 * Update a message's `delivery` field inside a persisted state snapshot.
 * Returns a new state object (immutable).
 */
export function updateMessageDelivery(
  state: PersistedChatState,
  messageId: string,
  delivery: ChatMessage['delivery'],
): PersistedChatState {
  let changed = false;
  const nextMessages = { ...state.messagesByConversation };

  for (const convId of Object.keys(nextMessages)) {
    const msgs = nextMessages[convId];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx !== -1 && msgs[idx].delivery !== delivery) {
      const copy = [...msgs];
      copy[idx] = { ...copy[idx], delivery };
      nextMessages[convId] = copy;
      changed = true;
      break;
    }
  }

  return changed ? { ...state, messagesByConversation: nextMessages } : state;
}
