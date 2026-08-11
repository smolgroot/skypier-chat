import { peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import * as lp from 'it-length-prefixed';
import {
  SKYPIER_CHAT_PROTOCOLS,
  deserializeWireEnvelope,
  serializeWireEnvelope,
  type WireEnvelope,
} from '@skypier/network/protocols';
import { createNativeSkypierNode, type SkypierNativeNode } from '@skypier/network/node';
import type { ProfileShareResponse, SharedPeerProfileMetadata } from '@skypier/protocol';

const SKYPIER_TEXT_PREFIX = 'skypier:msg:1:';

function parseInboundTextPayload(payload: string): string {
  if (!payload.startsWith(SKYPIER_TEXT_PREFIX)) {
    return payload;
  }

  try {
    const parsed = JSON.parse(payload.slice(SKYPIER_TEXT_PREFIX.length)) as { text?: unknown };
    return typeof parsed.text === 'string' ? parsed.text : payload;
  } catch {
    return payload;
  }
}

interface ProtocolStream {
  send: (chunk: Uint8Array) => void;
  close: () => Promise<void>;
  closeWrite?: () => Promise<void>;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | { subarray: (start?: number, end?: number) => Uint8Array }>;
}

interface ProtocolHandlerPayload {
  stream: ProtocolStream;
  connection: {
    remotePeer: {
      toString(): string;
    };
  };
}

export interface BotProfileConfig {
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  ensName?: string;
  ethAddress?: string;
  isBot?: boolean;
}

export interface CreateSkypierBotClientOptions {
  identityProtobuf?: string;
  bootstrapMultiaddrs?: string[];
  listenAddresses?: string[];
  maxConnections?: number;
  profile: BotProfileConfig;
}

export interface SendTextToPeerOptions {
  targetPeerId: string;
  text: string;
  conversationId?: string;
  messageId?: string;
}

export interface BotInboundMessage {
  fromPeerId: string;
  envelope: WireEnvelope;
  text: string;
}

export interface SkypierBotClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPeerId(): string | undefined;
  getProfile(): SharedPeerProfileMetadata | undefined;
  dialPeer(address: string): Promise<void>;
  dialPeerById(peerId: string): Promise<void>;
  sendTextToPeer(options: SendTextToPeerOptions): Promise<string>;
  onMessage(handler: (event: BotInboundMessage) => void | Promise<void>): () => void;
}

function toUint8Array(chunk: Uint8Array | { subarray: (start?: number, end?: number) => Uint8Array }): Uint8Array {
  return chunk instanceof Uint8Array ? chunk : chunk.subarray();
}

async function readFirstFrame(stream: AsyncIterable<Uint8Array | { subarray: (start?: number, end?: number) => Uint8Array }>): Promise<Uint8Array | null> {
  for await (const chunk of lp.decode(stream as AsyncIterable<any>)) {
    return toUint8Array(chunk as Uint8Array | { subarray: (start?: number, end?: number) => Uint8Array });
  }

  return null;
}

async function writeSingleFrame(stream: ProtocolStream, payload: Uint8Array): Promise<void> {
  for await (const chunk of lp.encode([payload])) {
    stream.send(toUint8Array(chunk as Uint8Array | { subarray: (start?: number, end?: number) => Uint8Array }));
  }

  await stream.closeWrite?.();
  await stream.close();
}

function decodeBase64(input: string): Uint8Array {
  return Uint8Array.from(Buffer.from(input, 'base64'));
}

function createConversationId(localPeerId: string, remotePeerId: string): string {
  const sorted = [localPeerId, remotePeerId].sort();
  return `direct-${sorted[0].slice(-8)}-${sorted[1].slice(-8)}`;
}

function createMessageId(): string {
  return `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSkypierBotClient(options: CreateSkypierBotClientOptions): SkypierBotClient {
  let node: SkypierNativeNode | undefined;
  let localPeerId: string | undefined;
  const listeners = new Set<(event: BotInboundMessage) => void | Promise<void>>();

  function getProfile(): SharedPeerProfileMetadata | undefined {
    if (!localPeerId) {
      return undefined;
    }

    return {
      peerId: localPeerId,
      displayName: options.profile.displayName,
      avatarUrl: options.profile.avatarUrl,
      bio: options.profile.bio,
      ensName: options.profile.ensName,
      ethAddress: options.profile.ethAddress,
      isBot: options.profile.isBot ?? true,
      updatedAt: new Date().toISOString(),
    };
  }

  async function emitInbound(event: BotInboundMessage): Promise<void> {
    await Promise.all(Array.from(listeners).map(async (handler) => {
      await handler(event);
    }));
  }

  function requireStarted(): { node: SkypierNativeNode; localPeerId: string } {
    if (!node || !localPeerId) {
      throw new Error('Bot client is not started. Call start() before sending messages.');
    }

    return { node, localPeerId };
  }

  async function sendEnvelopeToPeer(targetPeerId: string, envelope: WireEnvelope): Promise<void> {
    const started = requireStarted();

    const existingConnection = started.node.getConnections()
      .find((connection) => connection.remotePeer.toString() === targetPeerId);

    const connection = existingConnection ?? await started.node.dial(peerIdFromString(targetPeerId));
    const stream = await connection.newStream(SKYPIER_CHAT_PROTOCOLS.message);

    for await (const chunk of lp.encode([serializeWireEnvelope(envelope)])) {
      stream.send(toUint8Array(chunk as Uint8Array | { subarray: (start?: number, end?: number) => Uint8Array }));
    }

    await stream.close();
  }

  return {
    async start() {
      if (node) {
        return;
      }

      const identityProtobuf = options.identityProtobuf?.trim();
      node = await createNativeSkypierNode({
        bootstrapMultiaddrs: options.bootstrapMultiaddrs,
        listenAddresses: options.listenAddresses,
        maxConnections: options.maxConnections,
        identityProtobuf: identityProtobuf ? decodeBase64(identityProtobuf) : undefined,
      });

      node.handle(SKYPIER_CHAT_PROTOCOLS.message, async (payload: unknown) => {
        const handlerPayload = payload as ProtocolHandlerPayload;
        const frame = await readFirstFrame(handlerPayload.stream);
        if (!frame) {
          return;
        }

        const envelope = deserializeWireEnvelope(frame);
        await emitInbound({
          fromPeerId: handlerPayload.connection.remotePeer.toString(),
          envelope,
          text: parseInboundTextPayload(envelope.payload),
        });
      });

      node.handle(SKYPIER_CHAT_PROTOCOLS.profile, async (payload: unknown) => {
        const handlerPayload = payload as ProtocolHandlerPayload;
        // Consume request frame if present.
        await readFirstFrame(handlerPayload.stream);

        const profile = getProfile();
        if (!profile) {
          await handlerPayload.stream.close();
          return;
        }

        const response: ProfileShareResponse = {
          v: 1,
          profile,
        };

        await writeSingleFrame(handlerPayload.stream, new TextEncoder().encode(JSON.stringify(response)));
      });

      await node.start();
      localPeerId = node.peerId.toString();
    },

    async stop() {
      if (!node) {
        return;
      }

      await node.stop();
      node = undefined;
      localPeerId = undefined;
      listeners.clear();
    },

    getPeerId() {
      return localPeerId;
    },

    getProfile,

    async dialPeer(address: string) {
      const started = requireStarted();
      await started.node.dial(multiaddr(address.trim()));
    },

    async dialPeerById(peerId: string) {
      const started = requireStarted();
      await started.node.dial(peerIdFromString(peerId.trim()));
    },

    async sendTextToPeer(sendOptions: SendTextToPeerOptions) {
      const started = requireStarted();

      const targetPeerId = sendOptions.targetPeerId.trim();
      if (!targetPeerId) {
        throw new Error('targetPeerId is required.');
      }

      const messageId = sendOptions.messageId ?? createMessageId();
      const envelope: WireEnvelope = {
        kind: 'message',
        messageId,
        conversationId: sendOptions.conversationId ?? createConversationId(started.localPeerId, targetPeerId),
        senderPeerId: started.localPeerId,
        sentAt: new Date().toISOString(),
        payload: sendOptions.text,
      };

      await sendEnvelopeToPeer(targetPeerId, envelope);
      return messageId;
    },

    onMessage(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}
