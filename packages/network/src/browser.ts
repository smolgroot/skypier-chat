import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
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
    // peerId.privateKey from the old peer-id-factory is raw marshalled bytes (Uint8Array).
    // libp2p v3 expects a PrivateKey *object* with .type / .publicKey,
    // so we must convert via privateKeyFromProtobuf.
    const rawPrivateKeyBytes = (peerId as unknown as { privateKey?: Uint8Array }).privateKey;

    if (rawPrivateKeyBytes == null) {
      throw new Error('The provided identity protobuf does not contain a private key.');
    }

    importedPrivateKey = privateKeyFromProtobuf(rawPrivateKeyBytes);
  }

  const peerDiscovery = options.bootstrapMultiaddrs != null && options.bootstrapMultiaddrs.length > 0
    ? [bootstrap({ list: options.bootstrapMultiaddrs })]
    : [];

  const transports = [
    safelyCreate(() => webSockets()),
    safelyCreate(() => webRTC()),
    safelyCreate(() => circuitRelayTransport({
      reservationConcurrency: 2,
    })),
  ].filter((transport): transport is NonNullable<typeof transport> => transport != null);

  if (transports.length === 0) {
    throw new Error('No browser transport could be initialized for libp2p.');
  }

  const services = {
    identify: safelyCreate(() => identify()),
    ping: safelyCreate(() => ping()),
    dcutr: safelyCreate(() => dcutr()),
    dht: safelyCreate(() => kadDHT({
      clientMode: true,
      peerInfoMapper: removePrivateAddressesMapper,
    })),
  };

  return await createLibp2p({
    start: options.start ?? false,
    ...(importedPrivateKey != null ? { privateKey: importedPrivateKey as any } : {}),
    addresses: {
      listen: options.listenAddresses ?? ['/webrtc', '/p2p-circuit'],
    },
    connectionManager: {
      maxConnections: options.maxConnections ?? 100,
      maxParallelDials: 5,
      dialTimeout: 30_000,
    },
    transports,
    connectionGater: {
      denyDialMultiaddr: (addr) => {
        const addrStr = addr.toString();

        // Block plain-text ws:// — browsers enforce mixed-content policy anyway
        if (addrStr.includes('/ws/') || addrStr.endsWith('/ws')) {
          if (!addrStr.includes('/tls/') && !addrStr.includes('/wss')) {
            return true;
          }
        }

        // Block IPv6-encoded .libp2p.direct hostnames — many browsers / networks
        // can't resolve these (e.g. "2605-a141-2252-9259--1.k51q…libp2p.direct")
        const ipv6DnsPattern = /\/dns[46]?\/[\da-f]+-[\da-f]+-[\da-f]+-[\da-f]+-.*\.libp2p\.direct/i;
        if (ipv6DnsPattern.test(addrStr)) {
          // IPv4-encoded ones look like "141-95-145-190.k51q…" (4 groups)
          // IPv6-encoded ones have 5+ hyphen-separated hex groups
          const hostMatch = addrStr.match(/\/dns[46]?\/([\da-f-]+)\./i);
          if (hostMatch) {
            const groups = hostMatch[1].split('-');
            if (groups.length > 4) {
              return true; // IPv6-encoded, skip
            }
          }
        }

        return false;
      },
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
    services: Object.fromEntries(Object.entries(services).filter(([, value]) => value != null)) as any,
  });
}

function safelyCreate<T>(factory: () => T): T | undefined {
  try {
    const value = factory();
    return value ?? undefined;
  } catch {
    return undefined;
  }
}
