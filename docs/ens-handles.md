# ENS handles

Skypier lets people find and DM each other by ENS name. Instead of sharing a 52-character
peer ID, you share:

```
https://skypier.chat/u/vitalik.eth
```

There is **no Skypier smart contract**. The mapping lives in a standard ENS **text record**
on the name's own resolver — the same mechanism behind `avatar`, `url`, and `com.twitter`.

## How it works

| | |
|---|---|
| Text record key | `xyz.skypier.peerid` |
| Value | a libp2p peer ID (`12D3KooW…`) |
| Written by | the ENS name's owner, via `setText` on their resolver |
| Read by | `getEnsText` through the ENS Universal Resolver |

Because only the name's owner can call `setText`, ENS supplies the entire authorization
model. Nothing to deploy, audit, or maintain.

Reads go through the Universal Resolver, which handles CCIP-Read. Offchain and L2 names —
Basenames, `.cb.id`, wildcard subnames — therefore resolve with no extra work.

## The `/u/` route

`/u/:handle` is the canonical user link and accepts either form:

- `/u/vitalik.eth` — resolved via ENS, then redirected to `/chats/<peerId>`
- `/u/12D3KooW…` — a raw peer ID, redirected immediately with no network call

`/chats/<peerId>` keeps working as an alias, so every link already shared stays valid.

Resolution happens in an effect that waits for the splash/onboarding/unlock gate to
settle, so a cold load on `/u/vitalik.eth` survives onboarding and resolves afterwards.

### Hosting requirement

`/u/vitalik.eth` contains a dot. The default SPA rewrite in `vercel.json` excludes any
path containing a dot, so **an explicit `/u/(.*)` rewrite is required** or the route 404s
in production:

```json
"rewrites": [
  { "source": "/u/(.*)", "destination": "/index.html" },
  { "source": "/((?!.*\\..*).*)", "destination": "/index.html" }
]
```

Do **not** widen the general rule to allow dots — that would serve `index.html` for a
missing JS chunk, turning a clean 404 into a MIME-type error.

This cannot be reproduced locally: Vite's dev and preview servers fall back to
`index.html` for any unmatched path with no dot rule, so `/u/vitalik.eth` works in
`pnpm dev` and only fails once deployed. Verify on a preview deployment:

```
curl -I https://<preview>/u/vitalik.eth           # expect 200 text/html
curl -I https://<preview>/assets/index-<hash>.js  # expect the JS asset, not index.html
curl -I https://<preview>/does-not-exist.png      # expect 404
```

The service worker mirrors this: a navigation that returns 404 falls back to the cached
app shell, so installed PWAs don't inherit a host-side gap.

## Publishing your peer ID

Settings → **ENS handle**. The panel defaults to your wallet's primary (reverse) ENS name
and accepts any other name you own.

1. **Check name** — reads the resolver and owner, shows the current record, and simulates
   the write to confirm this wallet is authorized.
2. **Publish peer ID** — switches the wallet to the ENS chain, then sends `setText`.

Write access is determined by simulating the call (`eth_call` with `from` set) rather than
comparing owner addresses. PublicResolver authorizes the registry owner, the NameWrapper
owner, `isApprovedForAll` operators *and* per-node delegates; simulating asks the chain
exactly what the chain will enforce, so Safe and delegate setups work correctly. It also
catches resolvers that can't be written from the app at all.

Republishing an unchanged value short-circuits without sending a transaction.

### Cost and permanence

`setText` costs roughly 50,000 gas. It publicly and permanently links that ENS name — often
already tied to a real-world identity — to your Skypier peer ID. The value can be
overwritten later, but the history stays on-chain forever.

## Trust model

**ENS proves that the owner of a name claims a peer ID. It never proves that a peer ID
belongs to that name.**

Anyone can publish *someone else's* peer ID into their *own* name, so `attacker.eth` could
point at a third party's peer ID. This is a one-way, unauthenticated pointer: an invite
convenience, not an identity binding.

Consequences for the UI:

- The peer ID remains the security anchor — it *is* the public key, and stays visible.
  The handle is only a label.
- A resolved handle shows as **claimed via ENS · unconfirmed** until the peer's own shared
  profile echoes the same name back, at which point it becomes **confirmed** (`✓`).
  That is not cryptographic proof either — the peer's profile is self-asserted — but it
  does defeat the naive attack, since the real owner of a peer ID will never echo an
  attacker's name.
- Record values are treated as untrusted input: capped at 128 characters, validated with
  the same peer-ID check used for pasted input, and only ever passed to `dialPeerById`
  (never to a multiaddr dial).

### Planned: cryptographic proof

A second text record, `xyz.skypier.proof`, holding a libp2p signature over the ENS name
made with the peer's private key, verifiable client-side against the public key embedded
in the peer ID. That closes the loop completely, still with zero custom contracts, and is
purely additive — no schema change and no migration.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `VITE_ENS_RPC_URL` | `https://ethereum.publicnode.com` | JSON-RPC endpoint for all ENS reads |
| `VITE_ENS_CHAIN_ID` | `1` (mainnet) | Set to `11155111` for Sepolia |
| `VITE_ENS_PEERID_TEXT_KEY` | `xyz.skypier.peerid` | Text-record key to read and write |

Every `/u/<name>` load sends the name and the user's IP to whatever RPC endpoint is
configured. Lookups are cached (30 min for hits, 2 min for misses, in memory and
`localStorage`) so repeat visits stay local, but self-hosters should point
`VITE_ENS_RPC_URL` at their own node.

## Testing

**Sepolia is the intended path for exercising the publish flow.** Set
`VITE_ENS_CHAIN_ID=11155111`, register a test name in the ENS app, publish, and look it up
through `/u/` — the full loop, at zero cost. Without this, the first execution of the
write path is a real mainnet transaction.

**Testing resolution without owning a name:** temporarily set
`VITE_ENS_PEERID_TEXT_KEY=com.twitter` and open `/u/vitalik.eth`. A non-null value proves
transport, Universal Resolver routing, normalization, caching and the whole `/u/` pipeline
work, independently of anyone having published a Skypier record. Unset it afterwards.

Resolve a `.cb.id` or `*.uni.eth` subname to confirm the offchain CCIP-Read path works
from the browser.

Wallet paths worth exercising deliberately: rejecting the chain switch; rejecting the
signature; connecting an address that does *not* own the name (the wallet should never
show a confirmation dialog — nothing is broadcast); a name with no resolver set; a
**wrapped** name (owner resolves through `NameWrapper.ownerOf`); and republishing an
unchanged value.
