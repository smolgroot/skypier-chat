import type { PresenceSnapshot, Reachability } from '@skypier/protocol';
import {
  SKYPIER_CHAT_PROTOCOLS,
  deserializeWireEnvelope,
  serializeWireEnvelope,
  type SkypierChatProtocol,
  type WireEnvelope,
} from './protocols';

export { SKYPIER_CHAT_PROTOCOLS, deserializeWireEnvelope, serializeWireEnvelope };
export { createBrowserLiveSession } from './session';
export { generateNewIdentity, getPeerIdFromProtobuf } from './identity';
export type { BrowserLiveSession, BrowserLiveSessionEventMap, BrowserLiveSessionState, SessionStatus, PeerReachabilityEvent } from './session';

export type RuntimeKind = 'browser-pwa' | 'native-node';

export interface TransportCapability {
  transport: 'quic' | 'tcp' | 'webtransport' | 'webrtc' | 'websockets' | 'relay';
  status: 'target' | 'supported' | 'fallback' | 'blocked';
  reason: string;
}

export interface NetworkRuntimePlan {
  runtime: RuntimeKind;
  handshake: 'noise';
  transports: TransportCapability[];
  natTraversal: Array<'autonat' | 'relay-reservation' | 'hole-punching'>;
  listenAddresses: string[];
  protocols: SkypierChatProtocol[];
  dht: {
    clientMode: boolean;
    alpha: number;
    addressScope: 'public-only';
  };
  browserCaveat: string;
  notes: string[];
}

export interface SessionCapabilityReport {
  runtime: RuntimeKind;
  supportsNoise: true;
  supportsAutoNAT: boolean;
  supportsHolePunching: boolean;
  supportsQUIC: boolean;
  supportsTCP: boolean;
  supportsBrowserFallbacks: boolean;
}

export function createRuntimePlan(runtime: RuntimeKind = 'browser-pwa'): NetworkRuntimePlan {
  if (runtime === 'native-node') {
    return {
      runtime,
      handshake: 'noise',
      transports: [
        {
          transport: 'quic',
          status: 'target',
          reason: 'Matches the Go deployment pattern for direct UDP-based sessions.',
        },
        {
          transport: 'tcp',
          status: 'supported',
          reason: 'Useful for fallback connectivity and DCUtR upgrades.',
        },
        {
          transport: 'relay',
          status: 'supported',
          reason: 'Keeps connectivity available while hole punching is negotiated.',
        },
      ],
      natTraversal: ['autonat', 'relay-reservation', 'hole-punching'],
      listenAddresses: ['/ip4/0.0.0.0/udp/0/quic-v1', '/ip4/0.0.0.0/tcp/0'],
      protocols: Object.values(SKYPIER_CHAT_PROTOCOLS),
      dht: {
        clientMode: true,
        alpha: 2,
        addressScope: 'public-only',
      },
      browserCaveat: 'Native runtimes are the path for real QUIC listeners and future secure-chip-backed key custody.',
      notes: [
        'AutoNAT verifies reachability; DCUtR performs relay-assisted hole punching.',
        'Yamux is tuned to a 16 MiB stream window to preserve throughput headroom.',
        'DHT query parallelism stays conservative to avoid connection churn.',
      ],
    };
  }

  return {
    runtime,
    handshake: 'noise',
    transports: [
      {
        transport: 'quic',
        status: 'blocked',
        reason: 'Pure browser PWAs cannot reliably expose native QUIC listeners today.',
      },
      {
        transport: 'webtransport',
        status: 'target',
        reason: 'Closest browser-facing equivalent to a QUIC-like path.',
      },
      {
        transport: 'webrtc',
        status: 'fallback',
        reason: 'Useful for browser direct sessions and relay-assisted upgrades.',
      },
      {
        transport: 'websockets',
        status: 'fallback',
        reason: 'Helps bootstrap relay reachability from restrictive networks.',
      },
      {
        transport: 'relay',
        status: 'supported',
        reason: 'Maintains delivery while direct browser-compatible paths are negotiated.',
      },
    ],
    natTraversal: ['relay-reservation', 'hole-punching'],
    listenAddresses: ['/webrtc', '/p2p-circuit'],
    protocols: Object.values(SKYPIER_CHAT_PROTOCOLS),
    dht: {
      clientMode: true,
      alpha: 2,
      addressScope: 'public-only',
    },
    browserCaveat: 'PWAs use WebTransport/WebRTC/WebSocket fallbacks until native wrappers can expose fuller QUIC and secure-key APIs.',
    notes: [
      'Browser nodes keep Noise for connection encryption even when QUIC is unavailable.',
      'Relay plus DCUtR provides the browser-appropriate hole punching path.',
      'A native wrapper remains the path to secure-chip-backed keys on mobile and desktop.',
    ],
  };
}

export function createSessionCapabilityReport(runtime: RuntimeKind = 'browser-pwa'): SessionCapabilityReport {
  return {
    runtime,
    supportsNoise: true,
    supportsAutoNAT: runtime === 'native-node',
    supportsHolePunching: true,
    supportsQUIC: runtime === 'native-node',
    supportsTCP: runtime === 'native-node',
    supportsBrowserFallbacks: runtime === 'browser-pwa',
  };
}

export function createPresence(): PresenceSnapshot[] {
  return [
    {
      peerId: '12D3KooWRemotePeerAri',
      isOnline: true,
      reachability: 'direct',
      lastSeenAt: '2026-03-16T08:42:00.000Z',
    },
    {
      peerId: '12D3KooWRemotePeerNoah',
      isOnline: true,
      reachability: 'relayed',
      lastSeenAt: '2026-03-16T07:11:00.000Z',
    },
  ];
}

export function reachabilityLabel(reachability: Reachability): string {
  switch (reachability) {
    case 'direct':
      return 'Direct secure path';
    case 'relayed':
      return 'Relayed session';
    case 'offline':
      return 'Offline';
    default:
      return 'Unknown reachability';
  }
}

export function reachabilityColor(reachability: Reachability): string | undefined {
  switch (reachability) {
    case 'direct':
      return '#4caf50';
    case 'relayed':
      return '#ff9800';
    case 'offline':
      return '#f44336';
    default:
      return undefined;
  }
}

export type { SkypierChatProtocol, WireEnvelope };
