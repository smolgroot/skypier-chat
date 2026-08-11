import { createEd25519PeerId, exportToProtobuf, createFromProtobuf } from '@libp2p/peer-id-factory';

function b64Encode(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function b64Decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function generateNewIdentity() {
  const peerId = await createEd25519PeerId();
  const proto = exportToProtobuf(peerId);
  return {
    peerId: peerId.toString(),
    protobuf: b64Encode(proto),
  };
}

export async function getPeerIdFromProtobuf(base64Proto: string) {
  const bytes = b64Decode(base64Proto);
  const peerId = await createFromProtobuf(bytes);
  return peerId;
}

export type InvalidIdentityReason = 'malformed' | 'missing-private-key';

export class InvalidIdentityError extends Error {
  readonly reason: InvalidIdentityReason;

  constructor(reason: InvalidIdentityReason, message: string) {
    super(message);
    this.name = 'InvalidIdentityError';
    this.reason = reason;
  }
}

/**
 * Parses a base64 identity protobuf and verifies it actually carries a private key.
 *
 * `getPeerIdFromProtobuf` happily resolves a public-key-only export, which then
 * fails much later when the node starts (see the same private-key check in
 * browser.ts / node.ts). Import flows should use this instead so a bad paste is
 * caught while the user can still do something about it.
 */
export async function resolveIdentityFromProtobuf(
  base64Proto: string,
): Promise<{ peerId: string; protobuf: string }> {
  const protobuf = base64Proto.trim();

  let peerId;
  try {
    peerId = await getPeerIdFromProtobuf(protobuf);
  } catch {
    throw new InvalidIdentityError(
      'malformed',
      'This does not look like a valid identity secret. Check that the whole value was pasted.',
    );
  }

  if ((peerId as unknown as { privateKey?: Uint8Array }).privateKey == null) {
    throw new InvalidIdentityError(
      'missing-private-key',
      'This identity has no private key. It looks like a public Peer ID rather than your secret backup.',
    );
  }

  return { peerId: peerId.toString(), protobuf };
}
