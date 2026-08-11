/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** JSON-RPC endpoint used for all ENS reads. Defaults to a public node. */
  readonly VITE_ENS_RPC_URL?: string;
  /** Chain ID for ENS reads/writes. `11155111` selects Sepolia for free end-to-end testing. */
  readonly VITE_ENS_CHAIN_ID?: string;
  /** ENS text-record key holding a Skypier peer ID. Defaults to `xyz.skypier.peerid`. */
  readonly VITE_ENS_PEERID_TEXT_KEY?: string;

  readonly VITE_RELAY_BOOTSTRAP_MULTIADDRS?: string;
  readonly VITE_RELAY_UNREAD_CHECK_URL?: string;
  readonly VITE_RELAY_UNREAD_CHECK_TOKEN?: string;
  readonly VITE_WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  readonly VITE_ENABLE_PEER_DISCOVERY?: string;
  readonly VITE_ENABLE_DHT?: string;
  readonly VITE_ENABLE_PUBLIC_BOOTSTRAP?: string;
  readonly VITE_LIBP2P_MAX_CONNECTIONS?: string;
  readonly VITE_MAX_MESSAGES_PER_CONVERSATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
