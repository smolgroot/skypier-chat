import { noise } from '@chainsafe/libp2p-noise';
import { quic } from '@chainsafe/libp2p-quic';
import { yamux } from '@chainsafe/libp2p-yamux';
import { autoNAT } from '@libp2p/autonat';
import { bootstrap } from '@libp2p/bootstrap';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { dcutr } from '@libp2p/dcutr';
import { identify } from '@libp2p/identify';
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht';
import { createEd25519PeerId, createFromProtobuf, exportToProtobuf } from '@libp2p/peer-id-factory';
import { ping } from '@libp2p/ping';
import { tcp } from '@libp2p/tcp';
import { tls } from '@libp2p/tls';
import { uPnPNAT } from '@libp2p/upnp-nat';
import { createLibp2p, type Libp2p } from 'libp2p';

export interface CreateNativeSkypierNodeOptions {
  bootstrapMultiaddrs?: string[];
  dhtClientMode?: boolean;
  dhtAlpha?: number;
  enableAutoNAT?: boolean;
  enableRelayTransport?: boolean;
  enableUPnPNAT?: boolean;
  identityProtobuf?: Uint8Array;
  listenAddresses?: string[];
  maxConnections?: number;
  start?: boolean;
  tcpListenPort?: number;
  udpListenPort?: number;
}

export type SkypierNativeNode = Libp2p;

export async function createNativeSkypierNode(options: CreateNativeSkypierNodeOptions = {}): Promise<SkypierNativeNode> {
  let privateKey: unknown;

  if (options.identityProtobuf != null) {
    const peerId = await createFromProtobuf(options.identityProtobuf);
    const rawPrivateKeyBytes = (peerId as unknown as { privateKey?: Uint8Array }).privateKey;

    if (rawPrivateKeyBytes == null) {
      throw new Error('The provided identity protobuf does not contain a private key.');
    }

    privateKey = privateKeyFromProtobuf(rawPrivateKeyBytes);
  }

  const listenAddresses = options.listenAddresses ?? [
    `/ip4/0.0.0.0/udp/${options.udpListenPort ?? 0}/quic-v1`,
    `/ip4/0.0.0.0/tcp/${options.tcpListenPort ?? 0}`,
  ];

  const peerDiscovery = options.bootstrapMultiaddrs != null && options.bootstrapMultiaddrs.length > 0
    ? [bootstrap({ list: options.bootstrapMultiaddrs })]
    : [];

  return await createLibp2p({
    start: options.start ?? false,
    ...(privateKey != null ? { privateKey: privateKey as any } : {}),
    addresses: {
      listen: listenAddresses,
    },
    connectionManager: {
      maxConnections: options.maxConnections ?? 10,
      maxParallelDials: 2,
      maxDialQueueLength: 50,
      dialTimeout: 10_000,
    },
    transports: [
      quic(),
      tcp(),
      ...(options.enableRelayTransport ?? true ? [circuitRelayTransport()] : []),
    ],
    connectionEncrypters: [tls(), noise()],
    streamMuxers: [
      yamux({
        enableKeepAlive: true,
        streamOptions: {
          initialStreamWindowSize: 256 * 1024,
          maxStreamWindowSize: 16 * 1024 * 1024,
        },
      }),
    ],
    peerDiscovery,
    services: {
      identify: identify(),
      ping: ping(),
      ...(options.enableAutoNAT ?? true ? {
        autoNAT: autoNAT({
          startupDelay: 3_000,
          refreshInterval: 60_000,
        }),
      } : {}),
      dcutr: dcutr({
        retries: 3,
        timeout: 5_000,
      }),
      dht: kadDHT({
        clientMode: options.dhtClientMode ?? true,
        alpha: options.dhtAlpha ?? 2,
        peerInfoMapper: removePrivateAddressesMapper,
      }),
      ...(options.enableUPnPNAT ?? true ? {
        upnpNAT: uPnPNAT({
          autoConfirmAddress: false,
          portMappingDescription: 'Skypier Chat',
        }),
      } : {}),
    },
  });
}

export async function createNativeIdentityExport(identityProtobuf?: Uint8Array): Promise<Uint8Array> {
  const peerId = identityProtobuf == null
    ? await createEd25519PeerId()
    : await createFromProtobuf(identityProtobuf);

  if ((peerId as { privateKey?: unknown }).privateKey == null) {
    throw new Error('Cannot export identity without private key material.');
  }

  return exportToProtobuf(peerId, false);
}
