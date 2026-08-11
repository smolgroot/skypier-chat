<h1 align="center">Skypier Chat (a.k.a. "dM")</h1>
<p align="center">
  <img src="./apps/web/public/icons/logo_not_optimized.svg" alt="libp2p" height="128">
</p>


<p align="center">
  <img src="https://img.shields.io/badge/libp2p-013343?style=flat&logo=libp2p&logoColor=white" alt="libp2p">
  <img src="https://img.shields.io/badge/TypeScript-013343?style=flat&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React_19-013343?style=flat&logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/PWA-013343?style=flat&logo=pwa&logoColor=white" alt="PWA">
</p>

Skypier Chat is a peer-to-peer messenger. Two people talking means two libp2p
nodes exchanging encrypted envelopes directly, with no account database and
no server able to read what you sent.

The client is a browser-first PWA so it runs without an app store. Transport
and key custody are written generically enough to back a native desktop or
mobile shell later without a rewrite.

## How it works

Every device is a libp2p peer with its own identity key. Conversations are
addressed by peer ID, not by phone number or handle.

1. The client seals the plaintext into an envelope keyed to the recipient's
   device pre-key.
2. It opens a direct libp2p stream to the recipient's peer ID, punching
   through NAT via DCUtR when needed.
3. If the recipient is offline, the sealed envelope goes to a relay's
   mailbox instead. The relay stores ciphertext blindly and hands it back on
   the recipient's next connection; it holds no key to open it.
4. The recipient decrypts locally with its device private key.

Delivery receipts, presence, and profile exchange use the same model over
their own protocol streams (see [Protocol](#protocol)).

## Getting started

### Web client

```bash
pnpm install
pnpm dev
```

Starts the Vite dev server for `apps/web`. First run generates a local
device identity; nothing leaves the device until you message a peer.

### Bot SDK

A regular Skypier peer that sends messages to a target peer ID on an
interval, useful for checking reachability without opening the UI.

```bash
cp apps/bot-example/.env.example apps/bot-example/.env
# set TARGET_PEER_ID (and TARGET_PEER_MULTIADDR for a direct dial)
pnpm bot:random-wiki:smoke
```

`smoke` dials once and exits; `pnpm bot:random-wiki` runs continuously on
`INTERVAL_MS`. Full env var list in
[apps/bot-example/README.md](apps/bot-example/README.md).

### Relay server

Only needed to reach peers behind NAT or deliver to offline peers. A single
Go binary:

```bash
cd relay
go build -trimpath -ldflags="-s -w" -o dist/skypier-relay ./cmd/skypier-relay
./dist/skypier-relay serve --config config.example.yaml
```

Terminates its own TLS (ACME, no reverse proxy needed), listens on `/tls/ws`
for browser peers, and runs in DHT server mode. VPS deployment steps in
[docs/relay-setup.md](docs/relay-setup.md).

## Protocol

Chat traffic is split across dedicated libp2p protocol streams so a peer can
support or refuse each capability independently:

| Protocol ID | Purpose |
|---|---|
| `/skypier/chat/1.0.0/message` | direct message delivery |
| `/skypier/chat/1.0.0/receipts` | delivery/read acknowledgements |
| `/skypier/chat/1.0.0/presence` | online/offline signaling |
| `/skypier/chat/1.0.0/sync` | conversation state sync |
| `/skypier/chat/1.0.0/call-control` | audio call signaling |
| `/skypier/chat/1.0.0/call-audio` | audio call media chunks |
| `/skypier/chat/1.2.0/profile` | display name / bio / avatar exchange |
| `/skypier/chat/1.1.0/mailbox/enqueue` | hand an envelope to a relay for an offline peer |
| `/skypier/chat/1.1.0/mailbox/pull` | fetch envelopes queued for you |
| `/skypier/chat/1.1.0/mailbox/ack` | confirm receipt so the relay can drop it |

Wire envelopes are plain JSON, defined once in
`packages/network/src/protocols.ts` and shared by the browser client and the
bot SDK.

## Encryption

Each device generates an X25519 identity key and a rotating pre-key on first
run (`packages/crypto`). Messages are sealed per recipient device: a random
content-encryption key encrypts the message with AES-GCM, and that key is
wrapped to the recipient's pre-key so only their device can open it. Local
history is encrypted at rest, and backup bundles export encrypted for upload
to a user-linked pinning service without the service holding a usable key.

Push notifications carry nothing but a generic `{"type":"NEW_MESSAGE"}`
trigger, so the push provider learns a notification happened and nothing
else ([docs/web-push-notifications.md](docs/web-push-notifications.md)).

Signed prekey verification and forward secrecy are still open; the honest
list of what's implemented versus what's left lives in
[docs/E2EE-User-Stories.md](docs/E2EE-User-Stories.md).

## Networking

The libp2p stack mirrors the Skypier VPN Go node's configuration, split by
runtime since a browser can't open raw sockets:

| Capability | Native/Node | Browser/PWA |
|---|---|---|
| Transports | QUIC, TCP | WebTransport, WebRTC, WebSockets |
| Encryption | TLS, Noise | Noise |
| NAT traversal | AutoNAT, UPnP, DCUtR | DCUtR |
| Relay | circuit relay transport | circuit relay transport |
| DHT | client mode, `alpha=2` | client mode, conservative `alpha` |

Full Go-to-TypeScript mapping in [docs/networking.md](docs/networking.md).

## Development

```bash
pnpm install     # install all workspace packages
pnpm dev         # run the web client
pnpm build       # build every package (pnpm -r build)
pnpm typecheck   # typecheck every package (pnpm -r typecheck)
```

Each package builds and typechecks independently via its own `tsc`, so a
change to `packages/protocol` surfaces type errors in every consumer.

## Documentation

- [docs/networking.md](docs/networking.md): libp2p configuration and the
  Go-to-TypeScript mapping
- [docs/relay-setup.md](docs/relay-setup.md): deploying the relay to a VPS
- [docs/ens-handles.md](docs/ens-handles.md): finding and DMing people by ENS
  name, publishing your peer ID, and the trust model
- [docs/web-push-notifications.md](docs/web-push-notifications.md): VAPID
  setup for background notifications
- [docs/E2EE-User-Stories.md](docs/E2EE-User-Stories.md): what's done and
  what's left on the encryption roadmap
- [apps/bot-example/README.md](apps/bot-example/README.md): running and
  debugging the bot SDK example
