# Skypier Bot Example

This example runs a bot peer using the `@skypier/bot` SDK.

## Behavior

- Connects as a regular Skypier peer (with its own peer ID)
- Sends a random Wikipedia link to one dedicated peer ID every interval
- Defaults to every 10 minutes (`600000` ms)

## Environment Variables

- `TARGET_PEER_ID` (required): destination peer ID.
- `TARGET_PEER_MULTIADDR` (optional): explicit multiaddr for the destination peer (recommended for smoke tests).
- `BOT_BOOTSTRAP_MULTIADDRS` (optional): comma-separated bootstrap/relay multiaddrs.
- `INTERVAL_MS` (optional): send interval in milliseconds. Minimum `10000`.
- `BOT_DISPLAY_NAME` (optional): bot display name.
- `BOT_BIO` (optional): bot bio.
- `BOT_IDENTITY_PROTOBUF` (optional): base64 identity protobuf to keep stable identity across restarts.
- `CONVERSATION_ID` (optional): force a fixed conversation ID.

## Run

From workspace root:

```bash
pnpm install
cp apps/bot-example/.env.example apps/bot-example/.env
pnpm bot:random-wiki
```

The process logs each send and keeps running until stopped.

If `BOT_BOOTSTRAP_MULTIADDRS` is not set, the bot falls back to the standard libp2p bootstrap peers.

## Smoke Test

Run one send attempt and exit:

```bash
pnpm bot:random-wiki:smoke
```

This command starts the bot, dials the target peer, sends one random Wikipedia message, and exits.

If smoke test fails with a timeout:

- Verify the destination peer is online.
- If you use a dedicated relay, set `BOT_BOOTSTRAP_MULTIADDRS` in `apps/bot-example/.env`.

If smoke test fails with `no valid addresses`:

- Set `TARGET_PEER_MULTIADDR` in `apps/bot-example/.env` and rerun.
