import type { BackupManifest } from '@skypier/protocol';
import type { PersistedChatState } from '@skypier/storage';

export interface EncryptedBackupBundle {
  manifest: BackupManifest;
  encryptedPayload: string;
  recoveryKey: string;
}

export interface PinningProviderConfig {
  provider: 'pinata';
  jwt: string;
}

export interface PinningUploadRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export async function createEncryptedBackupBundle(state: PersistedChatState): Promise<EncryptedBackupBundle> {
  const recoveryBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(recoveryBytes), 'AES-GCM', false, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  const encryptedPayload = JSON.stringify({
    version: 1,
    iv: bytesToBase64(iv),
    payload: bytesToBase64(new Uint8Array(encrypted)),
  });

  const manifest: BackupManifest = {
    conversationIds: state.conversations.map((conversation) => conversation.id),
    exportedAt: new Date().toISOString(),
    pinningProvider: 'pinata',
    ciphertextBundleChecksum: await sha256(encryptedPayload),
  };

  return {
    manifest,
    encryptedPayload,
    recoveryKey: bytesToBase64(recoveryBytes),
  };
}

export function createPinataUploadRequest(bundle: EncryptedBackupBundle, config: PinningProviderConfig): PinningUploadRequest {
  return {
    url: 'https://api.pinata.cloud/pinning/pinJSONToIPFS',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.jwt}`,
    },
    body: JSON.stringify({
      pinataMetadata: {
        name: `skypier-chat-backup-${bundle.manifest.exportedAt}`,
      },
      pinataContent: {
        manifest: bundle.manifest,
        encryptedPayload: bundle.encryptedPayload,
      },
    }),
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}