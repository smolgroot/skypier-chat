export type DeviceTrustLevel = 'software' | 'biometric' | 'hardware-backed';
export type DeliveryState = 'sending' | 'local-only' | 'queued' | 'sent' | 'delivered' | 'read';
export type Reachability = 'unknown' | 'direct' | 'relayed' | 'offline';

export interface DeviceIdentity {
  id: string;
  label: string;
  peerId: string;
  platform: 'web' | 'ios' | 'android' | 'desktop';
  trustLevel: DeviceTrustLevel;
}

export interface Participant {
  id: string;
  displayName: string;
  peerId: string;
  devices: DeviceIdentity[];
}

export interface ReplyReference {
  messageId: string;
  excerpt: string;
  authorDisplayName: string;
}

export interface Reaction {
  emoji: string;
  authors: string[];
}

export interface MessageCiphertext {
  algorithm: 'xchacha20poly1305' | 'aes-gcm';
  ciphertext: string;
  nonce: string;
  recipientDeviceIds: string[];
}

export interface MediaAttachment {
  id: string;
  mimeType: string;
  /** data:<mimeType>;base64,<data> — already base64-encoded */
  dataUri: string;
  width?: number;
  height?: number;
  /** Approximate decoded byte size after compression */
  size: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderDisplayName: string;
  senderDeviceId: string;
  createdAt: string;
  previewText: string;
  ciphertext: MessageCiphertext;
  delivery: DeliveryState;
  replyTo?: ReplyReference;
  reactions: Reaction[];
  attachments?: MediaAttachment[];
}

export interface Conversation {
  id: string;
  title: string;
  participants: Participant[];
  lastMessagePreview: string;
  unreadCount: number;
  muted?: boolean;
  pinned?: boolean;
  reachability: Reachability;
  updatedAt: string;
}

export interface PresenceSnapshot {
  peerId: string;
  isOnline: boolean;
  reachability: Reachability;
  lastSeenAt?: string;
}

export interface BackupManifest {
  conversationIds: string[];
  exportedAt: string;
  cid?: string;
  pinningProvider?: 'pinata' | 'other';
  ciphertextBundleChecksum: string;
}

export interface SessionSecuritySummary {
  transport: 'noise';
  transportStatus: 'planned' | 'active' | 'fallback-required';
  contentEncryption: 'recipient-envelope';
  localStorageEncryption: 'wrapped-device-key';
}

export interface LinkedEthAddress {
  type: 'evm';
  address: string;
  chainId: number;
  linkedAt: string;
  signature: string;
  proofMessage: string;
}

export interface AccountProfile {
  userId: string;
  displayName: string;
  localPeerId?: string;
  identityProtobuf?: string; // Base64 encoded PeerID protobuf (includes private key)
  linkedEthAddresses: LinkedEthAddress[];
  biometricUnlockEnabled?: boolean;
  biometricCredentialId?: string; // Base64 credential ID for WebAuthn passkey unlock
}
