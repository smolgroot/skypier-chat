import type {
  DeviceIdentity,
  DevicePreKeyBundle,
  EncryptedMessageEnvelope,
  LocalDeviceCryptoState,
  MessageCiphertext,
  RecipientKeyWrap,
  SessionSecuritySummary,
} from '@skypier/protocol';
import { x25519 } from '@noble/curves/ed25519.js';

export interface UnlockCapabilities {
  biometricsAvailable: boolean;
  secureHardwareAvailable: boolean;
  canPersistWrappedKey: boolean;
}

export interface UnlockSession {
  unlockedAt: string;
  expiresAt: string;
  protectedBy: 'passphrase' | 'biometric' | 'hardware-backed';
}

export interface KeyCustodyPlan {
  device: DeviceIdentity;
  capabilities: UnlockCapabilities;
  recommendation: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CEK_LENGTH_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;
const WRAP_SALT_BYTES = 16;

export interface GenerateDeviceCryptoStateOptions {
  deviceId: string;
  peerId: string;
  createdAt?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function createRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function hkdfInfo(label: string): Uint8Array {
  return encoder.encode(label);
}

async function deriveAesGcmKey(sharedSecret: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<CryptoKey> {
  const hkdfBaseKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret as BufferSource,
    'HKDF',
    false,
    ['deriveKey'],
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: info as BufferSource,
    },
    hkdfBaseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importMessageKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', rawKey as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function sharedSecretFromKeys(secretKeyB64: string, publicKeyB64: string): Uint8Array {
  return x25519.getSharedSecret(base64ToBytes(secretKeyB64), base64ToBytes(publicKeyB64));
}

export function generateDeviceCryptoState(options: GenerateDeviceCryptoStateOptions): LocalDeviceCryptoState {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const identityPrivateKey = x25519.utils.randomSecretKey();
  const preKeyPrivateKey = x25519.utils.randomSecretKey();

  return {
    version: 1,
    algorithm: 'x25519',
    deviceId: options.deviceId,
    peerId: options.peerId,
    identityPrivateKey: bytesToBase64(identityPrivateKey),
    identityPublicKey: bytesToBase64(x25519.getPublicKey(identityPrivateKey)),
    preKeyId: `prekey-${createdAt}`,
    preKeyPrivateKey: bytesToBase64(preKeyPrivateKey),
    preKeyPublicKey: bytesToBase64(x25519.getPublicKey(preKeyPrivateKey)),
    createdAt,
  };
}

export function exportDevicePreKeyBundle(state: LocalDeviceCryptoState, expiresAt?: string): DevicePreKeyBundle {
  return {
    version: 1,
    algorithm: 'x25519',
    deviceId: state.deviceId,
    peerId: state.peerId,
    identityPublicKey: state.identityPublicKey,
    preKeyId: state.preKeyId,
    preKeyPublicKey: state.preKeyPublicKey,
    createdAt: state.createdAt,
    expiresAt,
  };
}

export interface EncryptMessageEnvelopeOptions {
  plaintext: string;
  senderKeyId: string;
  recipientBundles: DevicePreKeyBundle[];
  aad?: string;
}

export interface DecryptMessageEnvelopeOptions {
  envelope: EncryptedMessageEnvelope;
  deviceCryptoState: LocalDeviceCryptoState;
}

async function wrapContentKeyForRecipient(
  contentKey: Uint8Array,
  recipientBundle: DevicePreKeyBundle,
  senderKeyId: string,
): Promise<RecipientKeyWrap> {
  const ephemeralSecretKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralSecretKey);
  const sharedSecret = x25519.getSharedSecret(ephemeralSecretKey, base64ToBytes(recipientBundle.preKeyPublicKey));
  const salt = createRandomBytes(WRAP_SALT_BYTES);
  const nonce = createRandomBytes(AES_GCM_NONCE_BYTES);
  const wrappingKey = await deriveAesGcmKey(
    sharedSecret,
    salt,
    hkdfInfo(`skypier:wrap:${recipientBundle.peerId}:${recipientBundle.deviceId}:${recipientBundle.preKeyId}:${senderKeyId}`),
  );
  const wrappedKey = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce as BufferSource,
      additionalData: encoder.encode(recipientBundle.deviceId),
    },
    wrappingKey,
    contentKey as BufferSource,
  );

  return {
    recipientPeerId: recipientBundle.peerId,
    recipientDeviceId: recipientBundle.deviceId,
    keyWrapAlgorithm: 'x25519-hkdf-sha256',
    preKeyId: recipientBundle.preKeyId,
    ephemeralPublicKey: bytesToBase64(ephemeralPublicKey),
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(nonce),
    wrappedKey: bytesToBase64(new Uint8Array(wrappedKey)),
  };
}

export async function encryptMessageEnvelope(options: EncryptMessageEnvelopeOptions): Promise<EncryptedMessageEnvelope> {
  const iv = createRandomBytes(AES_GCM_NONCE_BYTES);
  const contentKey = createRandomBytes(CEK_LENGTH_BYTES);
  const key = await importMessageKey(contentKey);
  const additionalData = options.aad != null ? encoder.encode(options.aad) : undefined;
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      ...(additionalData != null ? { additionalData } : {}),
    },
    key,
    encoder.encode(options.plaintext),
  );

  const keyWraps = await Promise.all(
    options.recipientBundles.map((recipientBundle) =>
      wrapContentKeyForRecipient(contentKey, recipientBundle, options.senderKeyId),
    ),
  );

  return {
    v: 1,
    algorithm: 'aes-gcm',
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    nonce: bytesToBase64(iv),
    senderKeyId: options.senderKeyId,
    aad: options.aad,
    keyWraps,
  };
}

export async function decryptMessageEnvelope(options: DecryptMessageEnvelopeOptions): Promise<string> {
  if (options.envelope.v !== 1) {
    throw new Error('Unsupported encrypted envelope version');
  }

  if (options.envelope.algorithm !== 'aes-gcm') {
    throw new Error(`Unsupported encrypted envelope algorithm: ${options.envelope.algorithm}`);
  }

  const keyWrap = options.envelope.keyWraps.find((entry) =>
    entry.recipientDeviceId === options.deviceCryptoState.deviceId
    && entry.preKeyId === options.deviceCryptoState.preKeyId,
  );

  if (!keyWrap) {
    throw new Error(`No key wrap found for device ${options.deviceCryptoState.deviceId}`);
  }

  const wrappingKey = await deriveAesGcmKey(
    sharedSecretFromKeys(options.deviceCryptoState.preKeyPrivateKey, keyWrap.ephemeralPublicKey),
    base64ToBytes(keyWrap.salt),
    hkdfInfo(`skypier:wrap:${keyWrap.recipientPeerId}:${keyWrap.recipientDeviceId}:${keyWrap.preKeyId}:${options.envelope.senderKeyId}`),
  );
  const contentKey = new Uint8Array(await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(keyWrap.nonce) as BufferSource,
      additionalData: encoder.encode(keyWrap.recipientDeviceId),
    },
    wrappingKey,
    base64ToBytes(keyWrap.wrappedKey) as BufferSource,
  ));

  const key = await importMessageKey(contentKey);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(options.envelope.nonce) as BufferSource,
      ...(options.envelope.aad != null ? { additionalData: encoder.encode(options.envelope.aad) } : {}),
    },
    key,
    base64ToBytes(options.envelope.ciphertext) as BufferSource,
  );

  return decoder.decode(plaintext);
}

export function toLegacyMessageCiphertext(envelope: EncryptedMessageEnvelope, recipientDeviceIds: string[]): MessageCiphertext {
  return {
    algorithm: envelope.algorithm,
    ciphertext: envelope.ciphertext,
    nonce: envelope.nonce,
    recipientDeviceIds,
    senderKeyId: envelope.senderKeyId,
    aad: envelope.aad,
    keyWraps: envelope.keyWraps,
  };
}

export function createSecuritySummary(): SessionSecuritySummary {
  return {
    transport: 'noise',
    transportStatus: 'planned',
    contentEncryption: 'recipient-envelope',
    localStorageEncryption: 'wrapped-device-key',
  };
}

export function createKeyCustodyPlan(device: DeviceIdentity, capabilities: UnlockCapabilities): KeyCustodyPlan {
  if (capabilities.secureHardwareAvailable) {
    return {
      device,
      capabilities,
      recommendation: 'Store the wrapped identity key in secure hardware and require biometrics to unwrap it.',
    };
  }

  if (capabilities.biometricsAvailable) {
    return {
      device,
      capabilities,
      recommendation: 'Protect the local wrapping key with platform biometrics and rotate the unlock session aggressively.',
    };
  }

  return {
    device,
    capabilities,
    recommendation: 'Fallback to passphrase-protected local key wrapping and encourage encrypted backup export.',
  };
}
