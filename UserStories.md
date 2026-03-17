# Skypier Chat User Stories

## Product vision

Skypier Chat is a privacy-first peer-to-peer messenger built on libp2p, with no central message storage, encrypted transport, encrypted local persistence, and optional encrypted backup to IPFS through a user-provided pinning provider.

## Guiding constraints

- Message plaintext must only be recoverable by the intended recipient devices.
- Transport should target libp2p with Noise and QUIC where platform support exists.
- NAT traversal should prefer AutoNAT, relay reservation, and hole punching strategies.
- Local chat history must be encrypted at rest.
- The browser-first MVP must remain compatible with a future native shell for stronger biometrics and secure hardware storage.
- Backup payloads stored on IPFS must already be encrypted before upload.

## MVP epics

### Epic 1: Identity and key custody

**User story:** As a user, I want a persistent identity so I can reconnect to my chats across app sessions.

**Tasks:**
- Define device identity, account identity, peer ID, and conversation membership models.
- Generate or import a long-term identity keypair on first launch.
- Wrap private key access behind an unlock session abstraction.
- Add a biometric-capable unlock API with graceful fallback for browsers without platform authenticators.
- Reserve a secure-storage adapter boundary for mobile secure enclave / keystore support.
- Document multi-device identity decisions and trust onboarding flow.

### Epic 2: Transport and session establishment

**User story:** As a user, I want my messages delivered directly over a private peer-to-peer network without a central server.

**Tasks:**
- Create a libp2p node factory configuration with Noise, QUIC, peer identity, and stream protocol IDs.
- Model network capabilities and fallbacks for browser, mobile wrapper, and desktop shell environments.
- Add peer reachability state and session establishment status.
- Integrate AutoNAT and relay/hole-punch strategy metadata into the connection state model.
- Define a direct-message stream envelope for text, reactions, replies, receipts, and presence updates.
- Add retry and offline queue semantics for temporarily disconnected peers.

### Epic 3: Encrypted messaging

**User story:** As a user, I want only the intended recipients to read my message contents.

**Tasks:**
- Define a per-message encrypted envelope and detached metadata layout.
- Separate transport security from payload encryption so backups remain opaque.
- Add reply references, reaction targets, editability flags, timestamps, and sender device metadata.
- Define delivery and read receipt events without exposing plaintext.
- Document attachment and media encryption requirements for later phases.

### Epic 4: Encrypted local persistence

**User story:** As a user, I want my messages to persist securely on my device.

**Tasks:**
- Create an encrypted conversation store interface for IndexedDB-backed persistence.
- Store conversation list, message ciphertext, key metadata, and sync state separately.
- Protect local encryption keys with an unlock session and device-bound secret when available.
- Define rotation, export, wipe, and session timeout behaviors.
- Add a mobile-focused persistence strategy emphasizing durability and secure unlock state.
- Evaluate fallback behavior when secure hardware storage is unavailable.

### Epic 5: Optional encrypted IPFS backup

**User story:** As a user, I want to back up my encrypted chat history to IPFS using my own pinning provider.

**Tasks:**
- Define an encrypted backup bundle format for one conversation or a full-device export.
- Add a provider-agnostic pinning client interface.
- Implement a Pinata adapter behind user-supplied credentials.
- Track CID references locally without exposing plaintext metadata.
- Add import and restore flows for a new device.
- Document trust assumptions around provider metadata leakage.

### Epic 6: Chat UI and UX

**User story:** As a user, I want a familiar chat experience on desktop and mobile.

**Tasks:**
- Build a desktop split-pane layout with conversation list and active thread view.
- Build a mobile-first stacked layout with chat list and thread drill-down.
- Render message bubbles grouped by sender and time.
- Add inline reply composer and reply preview on message cards.
- Add emoji reaction picker and reaction summary chips.
- Add empty, locked, syncing, offline, and unreachable states.

## Near-term implementation milestones

### Milestone 1: Scaffold
- Monorepo with packages and shared TS config
- PWA shell with responsive desktop/mobile layout
- Shared protocol, crypto, storage, and network interfaces

### Milestone 2: Local-first secure prototype
- Identity bootstrap and unlock session abstraction
- Encrypted local conversation repository with mock data
- Chat composer, replies, and reactions wired to local state

### Milestone 3: Peer networking prototype
- libp2p node bootstrap abstraction
- Session state, peer discovery, and direct message pipeline
- Offline queue and reconnect handling

### Milestone 4: Backup and recovery
- Export/import encrypted bundles
- Pinata integration for encrypted IPFS backup
- Recovery UX and key restoration flow

## Open design decisions

- Browser-only PWA versus PWA plus native wrapper for stronger biometrics and secure-chip support
- Single identity key versus per-device keys with device linking
- Attachment transport strategy for large payloads and intermittent peers
- Relay infrastructure expectations under restrictive NATs despite no central storage
- Key escrow stance for account recovery
