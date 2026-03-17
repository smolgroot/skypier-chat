export const SKYPIER_CHAT_PROTOCOLS = {
  message: '/skypier/chat/1.0.0/message',
  receipts: '/skypier/chat/1.0.0/receipts',
  presence: '/skypier/chat/1.0.0/presence',
  sync: '/skypier/chat/1.0.0/sync',
} as const;

export type SkypierChatProtocol = typeof SKYPIER_CHAT_PROTOCOLS[keyof typeof SKYPIER_CHAT_PROTOCOLS];

export type WireEnvelopeKind = 'message' | 'receipt' | 'presence' | 'sync';

export interface WireEnvelope {
  kind: WireEnvelopeKind;
  conversationId: string;
  senderPeerId: string;
  sentAt: string;
  payload: string;
}

export function serializeWireEnvelope(envelope: WireEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope));
}

export function deserializeWireEnvelope(bytes: Uint8Array): WireEnvelope {
  return JSON.parse(new TextDecoder().decode(bytes)) as WireEnvelope;
}
