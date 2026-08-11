import 'dotenv/config';
import { buildRandomWikipediaMessage, createSkypierBotClient, runIntervalTask } from '@skypier/bot';

const DEFAULT_BOOTSTRAP_MULTIADDRS = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
];

const TARGET_PEER_ID = process.env.TARGET_PEER_ID?.trim();
const TARGET_PEER_MULTIADDR = process.env.TARGET_PEER_MULTIADDR?.trim();
const BOT_DISPLAY_NAME = process.env.BOT_DISPLAY_NAME?.trim() || 'Skypier Wiki Bot';
const BOT_BIO = process.env.BOT_BIO?.trim() || 'Automated peer sending random Wikipedia links.';
const BOT_IDENTITY_PROTOBUF = process.env.BOT_IDENTITY_PROTOBUF?.trim();
const CONVERSATION_ID = process.env.CONVERSATION_ID?.trim();
const configuredBootstrapMultiaddrs = String(process.env.BOT_BOOTSTRAP_MULTIADDRS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const BOOTSTRAP_MULTIADDRS = configuredBootstrapMultiaddrs.length > 0
  ? configuredBootstrapMultiaddrs
  : DEFAULT_BOOTSTRAP_MULTIADDRS;

const INTERVAL_MS = (() => {
  const parsed = Number(process.env.INTERVAL_MS ?? '600000');
  if (!Number.isFinite(parsed)) {
    return 600_000;
  }
  return Math.max(10_000, Math.floor(parsed));
})();

if (!TARGET_PEER_ID) {
  throw new Error('TARGET_PEER_ID is required.');
}

const bot = createSkypierBotClient({
  identityProtobuf: BOT_IDENTITY_PROTOBUF,
  bootstrapMultiaddrs: BOOTSTRAP_MULTIADDRS,
  profile: {
    displayName: BOT_DISPLAY_NAME,
    bio: BOT_BIO,
    isBot: true,
  },
});

await bot.start();
console.log('[bot] started with peer ID:', bot.getPeerId());

if (TARGET_PEER_MULTIADDR) {
  void bot.dialPeer(TARGET_PEER_MULTIADDR).catch((error) => {
    console.warn('[bot] initial multiaddr dial failed, sends will retry on demand:', error instanceof Error ? error.message : error);
  });
} else {
  void bot.dialPeerById(TARGET_PEER_ID).catch((error) => {
    console.warn('[bot] initial dial failed, sends will retry on demand:', error instanceof Error ? error.message : error);
  });
}

bot.onMessage((event) => {
  console.log(`[bot] inbound from ${event.fromPeerId}: ${event.text}`);
});

const stopIntervalTask = runIntervalTask(async () => {
  const message = buildRandomWikipediaMessage();
  const messageId = await bot.sendTextToPeer({
    targetPeerId: TARGET_PEER_ID,
    text: message,
    conversationId: CONVERSATION_ID,
  });

  console.log(`[bot] sent ${messageId} to ${TARGET_PEER_ID}: ${message}`);
}, {
  intervalMs: INTERVAL_MS,
  runImmediately: true,
  onError: (error) => {
    console.error('[bot] scheduled send failed:', error);
  },
});

const shutdown = async () => {
  console.log('[bot] shutting down...');
  stopIntervalTask();
  await bot.stop();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
