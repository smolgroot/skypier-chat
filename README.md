# Skypier Chat

Skypier Chat is a peer-to-peer messenger built for privacy-first communication over libp2p.

## Goals

- No central message storage
- End-to-end encrypted transport and encrypted local persistence
- Optional encrypted IPFS backups via user-linked pinning services
- Mobile and desktop support through a responsive PWA architecture
- Future-ready key custody with biometrics and secure hardware integration

## Workspace

- `apps/web`: PWA client shell
- `packages/protocol`: shared chat and identity types
- `packages/crypto`: key custody and envelope encryption interfaces
- `packages/storage`: encrypted local persistence abstractions
- `packages/network`: libp2p transport configuration and session state
- `packages/backup`: encrypted export bundles and IPFS pinning integration surface
- `packages/ui`: reusable chat UI primitives

## Quick start

```bash
pnpm install
pnpm dev
```

## Notes

The initial scaffold favors a browser-first PWA MVP while keeping transport and key management abstract enough to support stronger native mobile/desktop integrations later.

## Current prototype

- Encrypted local-first chat history persistence with IndexedDB preference and localStorage fallback
- Responsive desktop/mobile chat shell with local send, reply, and reaction flows
- Encrypted backup bundle export suitable for later upload through a user-linked pinning provider such as Pinata
- Real libp2p runtime factories for native/node and browser/PWA environments, with the Go-to-TypeScript transport mapping documented in [docs/networking.md](docs/networking.md)
