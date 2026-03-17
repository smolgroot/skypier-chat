# Skypier Chat networking

## Goal

Mirror the spirit of the Skypier VPN Go node in TypeScript while keeping the browser PWA viable.

## Go to TypeScript mapping

- `libp2p.Security(noise.ID, noise.New)` → `connectionEncrypters: [noise()]`
- `libp2p.Security(libp2ptls.ID, libp2ptls.New)` → `connectionEncrypters: [tls(), noise()]` on native nodes
- `libp2p.Transport(quic.NewTransport)` → `transports: [quic()]` for native/node runtimes
- `libp2p.Transport(tcp.NewTCPTransport)` → `transports: [tcp()]`
- `libp2p.Muxer(yamux.ID, yamux.DefaultTransport)` → `streamMuxers: [yamux({ streamOptions: { maxStreamWindowSize: 16 * 1024 * 1024 } })]`
- `libp2p.NATPortMap()` → `services: { upnpNAT: uPnPNAT() }`
- `libp2p.EnableAutoNATv2()` → current JS implementation uses `@libp2p/autonat`; AutoNAT verifies reachability, while hole punching is handled by `@libp2p/dcutr`
- `libp2p.EnableHolePunching()` → `services: { dcutr: dcutr() }` with `circuitRelayTransport()` enabled
- `dht.Mode(dht.ModeClient)` and public address filtering → `kadDHT({ clientMode: true, alpha: 2, peerInfoMapper: removePrivateAddressesMapper })`

## Runtime split

### Native/node runtime

- Uses QUIC and TCP listeners
- Enables Noise and TLS
- Uses AutoNAT, UPnP/NAT port mapping, relay transport, and DCUtR
- Best match for future desktop shell or native mobile wrapper

### Browser/PWA runtime

- Cannot depend on native QUIC listeners today
- Uses WebTransport, WebRTC, WebSockets, relay transport, and DCUtR
- Keeps Noise as the connection encryption layer
- Stays DHT client-only with conservative query parallelism

## Protocol IDs

- Message stream: `/skypier/chat/1.0.0/message`
- Receipts stream: `/skypier/chat/1.0.0/receipts`
- Presence stream: `/skypier/chat/1.0.0/presence`
- Sync stream: `/skypier/chat/1.0.0/sync`

## Current status

- The package now exposes real libp2p factories in [packages/network/src/node.ts](../packages/network/src/node.ts) and [packages/network/src/browser.ts](../packages/network/src/browser.ts).
- The web app still displays capability planning and has not started a live libp2p node inside the UI yet.
- The next network step is wiring a chat session adapter that opens the message protocol stream, queues outbound envelopes while offline, and hydrates UI presence from actual peer events.
