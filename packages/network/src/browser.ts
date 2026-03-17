import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { dcutr } from '@libp2p/dcutr';
import { identify } from '@libp2p/identify';
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht';
import { createFromProtobuf } from '@libp2p/peer-id-factory';
import { ping } from '@libp2p/ping';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { createLibp2p, type Libp2p } from 'libp2p';

export interface CreateBrowserSkypierNodeOptions {
  bootstrapMultiaddrs?: string[];
  identityProtobuf?: Uint8Array;
  listenAddresses?: string[];
  maxConnections?: number;
  start?: boolean;
}

export type SkypierBrowserNode = Libp2p;

export async function createBrowserSkypierNode(options: CreateBrowserSkypierNodeOptions = {}): Promise<SkypierBrowserNode> {
  let importedPrivateKey: unknown;

  if (options.identityProtobuf != null) {
    const peerId = await createFromProtobuf(options.identityProtobuf);
    importedPrivateKey = (peerId as { privateKey?: unknown }).privateKey;

    if (importedPrivateKey == null) {
      throw new Error('The provided identity protobuf does not contain a private key.');
    }
  }

  const peerDiscovery = options.bootstrapMultiaddrs != null && options.bootstrapMultiaddrs.length > 0
    ? [bootstrap({ list: options.bootstrapMultiaddrs })]
    : [];

  return await createLibp2p({
    start: options.start ?? false,
    ...(importedPrivateKey != null ? { privateKey: importedPrivateKey as any } : {}),
    addresses: {
      listen: options.listenAddresses ?? ['/webrtc', '/p2p-circuit'],
    },
    connectionManager: {
      maxConnections: options.maxConnections ?? 10,
      maxParallelDials: 2,
      dialTimeout: 10_000,
    },
    transports: [
      webSockets(),
      webRTC(),
      circuitRelayTransport(),
    ],
    connectionGater: {
      denyDialMultiaddr: () => false,
    },
    connectionEncrypters: [noise()],
    streamMuxers: [
      yamux({
        enableKeepAlive: true,
        streamOptions: {
          maxStreamWindowSize: 16 * 1024 * 1024,
        },
      }),
    ],
    peerDiscovery,
    peerRouters: [
      kadDHT({
        clientMode: true,
        alpha: 2,
        peerInfoMapper: removePrivateAddressesMapper,
      }) as any,
    ],
    services: {
      identify: identify(),
      ping: ping(),
      dcutr: dcutr(),
    },
  });
}
