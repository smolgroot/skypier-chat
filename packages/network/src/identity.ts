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
