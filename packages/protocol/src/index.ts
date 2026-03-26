export type DeviceTrustLevel = 'software' | 'biometric' | 'hardware-backed';
export type DeliveryState = 'sending' | 'local-only' | 'queued' | 'sent' | 'delivered' | 'read';
export type Reachability = 'unknown' | 'direct' | 'relayed' | 'offline';
export type AudioCallCodec = 'opus';
export type AudioCallSignalType = 'offer' | 'ringing' | 'accept' | 'reject' | 'hangup' | 'busy' | 'mute';
export type AudioCallEndReason = 'declined' | 'busy' | 'hangup' | 'missed' | 'error';
export type AudioCallPhase = 'idle' | 'requesting-media' | 'incoming' | 'ringing' | 'connecting' | 'connected' | 'ended' | 'error';
export type AudioCallChunkKind = 'chunk' | 'end';
export type ChatSystemEventType = 'call-attempted' | 'call-ended';
export type ReactionAction = 'add' | 'remove';

export const SKYPIER_REACTION_PREFIX = 'skypier:react:';

export interface AudioCallMediaProfile {
  codec: AudioCallCodec;
  sampleRateHz: number;
  channels: 1 | 2;
  ptimeMs: number;
}

export interface AudioCallSignal {
  type: AudioCallSignalType;
  callId: string;
  conversationId: string;
  fromPeerId: string;
  sentAt: string;
  mediaProfile?: AudioCallMediaProfile;
  muted?: boolean;
  reason?: AudioCallEndReason;
}

export interface AudioCallChunk {
  kind: AudioCallChunkKind;
  callId: string;
  conversationId: string;
  fromPeerId: string;
  sentAt: string;
  sequence: number;
  mimeType: string;
  data?: string;
}

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

export interface ChatReactionEvent {
  v: 1;
  opId: string;
  convId: string;
  msgId: string;
  emoji: string;
  actorPeerId: string;
  action: ReactionAction;
  at: string;
}

export function serializeChatReactionEvent(event: ChatReactionEvent): string {
  return `${SKYPIER_REACTION_PREFIX}${JSON.stringify(event)}`;
}

export function parseChatReactionEventPayload(payload: string): ChatReactionEvent | undefined {
  if (!payload.startsWith(SKYPIER_REACTION_PREFIX)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(payload.slice(SKYPIER_REACTION_PREFIX.length)) as Partial<ChatReactionEvent>;
    if (parsed.v !== 1) {
      return undefined;
    }

    if (
      typeof parsed.opId !== 'string'
      || typeof parsed.convId !== 'string'
      || typeof parsed.msgId !== 'string'
      || typeof parsed.emoji !== 'string'
      || typeof parsed.actorPeerId !== 'string'
      || (parsed.action !== 'add' && parsed.action !== 'remove')
      || typeof parsed.at !== 'string'
    ) {
      return undefined;
    }

    return parsed as ChatReactionEvent;
  } catch {
    return undefined;
  }
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

export interface ChatSystemEvent {
  type: ChatSystemEventType;
  callId: string;
  direction?: 'incoming' | 'outgoing';
  endedReason?: AudioCallEndReason;
  durationMs?: number;
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
  systemEvent?: ChatSystemEvent;
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
  themePreference?: 'light' | 'dark';
  biometricUnlockEnabled?: boolean;
  biometricCredentialId?: string; // Base64 credential ID for WebAuthn passkey unlock
}
