import 'dotenv/config';
import { buildRandomWikipediaMessage, createSkypierBotClient } from '@skypier/bot';

const DEFAULT_BOOTSTRAP_MULTIADDRS = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
];

const TARGET_PEER_ID = process.env.TARGET_PEER_ID?.trim();
const TARGET_PEER_MULTIADDR = process.env.TARGET_PEER_MULTIADDR?.trim();
const BOT_DISPLAY_NAME = process.env.BOT_DISPLAY_NAME?.trim() || 'Skypier Wiki Bot (Smoke)';
const BOT_BIO = process.env.BOT_BIO?.trim() || 'Smoke-test bot for Skypier peer messaging.';
const BOT_IDENTITY_PROTOBUF = process.env.BOT_IDENTITY_PROTOBUF?.trim();
const CONVERSATION_ID = process.env.CONVERSATION_ID?.trim();
const configuredBootstrapMultiaddrs = String(process.env.BOT_BOOTSTRAP_MULTIADDRS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const BOOTSTRAP_MULTIADDRS = configuredBootstrapMultiaddrs.length > 0
  ? configuredBootstrapMultiaddrs
  : DEFAULT_BOOTSTRAP_MULTIADDRS;

if (!TARGET_PEER_ID) {
  throw new Error('TARGET_PEER_ID is required. Copy .env.example to .env and set a valid peer ID first.');
}
const targetPeerId = TARGET_PEER_ID;

async function main() {
  const bot = createSkypierBotClient({
    identityProtobuf: BOT_IDENTITY_PROTOBUF,
    bootstrapMultiaddrs: BOOTSTRAP_MULTIADDRS,
    profile: {
      displayName: BOT_DISPLAY_NAME,
      bio: BOT_BIO,
      isBot: true,
    },
  });

  try {
    await bot.start();
    console.log('[bot-smoke] started with peer ID:', bot.getPeerId());

    try {
      if (TARGET_PEER_MULTIADDR) {
        await bot.dialPeer(TARGET_PEER_MULTIADDR);
        console.log('[bot-smoke] dial succeeded via multiaddr:', TARGET_PEER_MULTIADDR);
      } else {
        await bot.dialPeerById(targetPeerId);
        console.log('[bot-smoke] dial succeeded:', targetPeerId);
      }
    } catch (error) {
      console.warn('[bot-smoke] dial warning, continuing to send test message:', error instanceof Error ? error.message : error);
    }

    const message = buildRandomWikipediaMessage('Smoke test random article');
    const messageId = await bot.sendTextToPeer({
      targetPeerId,
      text: message,
      conversationId: CONVERSATION_ID,
    });

    console.log(`[bot-smoke] sent ${messageId} to ${targetPeerId}: ${message}`);
    console.log('[bot-smoke] success');
  } finally {
    await bot.stop();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const isTimeout = /timeout/i.test(message);
  const hasNoAddress = /no valid addresses/i.test(message);
  if (isTimeout) {
    console.error('[bot-smoke] send failed due to network timeout.');
    console.error('[bot-smoke] Ensure the destination peer is online and reachable.');
    console.error('[bot-smoke] If you run a dedicated relay, set BOT_BOOTSTRAP_MULTIADDRS in apps/bot-example/.env.');
  }
  if (hasNoAddress) {
    console.error('[bot-smoke] peer ID has no known dialable addresses.');
    console.error('[bot-smoke] Set TARGET_PEER_MULTIADDR in apps/bot-example/.env, e.g. /dns4/relay.example/tcp/443/tls/ws/p2p/<peerId>.');
  }
  console.error('[bot-smoke] failed:', message);
  process.exit(1);
});
