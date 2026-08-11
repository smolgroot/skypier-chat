import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';

/**
 * ENS text-record key holding a Skypier peer ID.
 *
 * Namespaced so it can never collide with the conventional keys (`avatar`, `url`,
 * `com.twitter`, …). Overridable via env mainly so the read pipeline can be smoke-tested
 * against a key that real names already populate — see docs/ens-handles.md.
 */
export const SKYPIER_PEERID_TEXT_KEY =
  (import.meta.env.VITE_ENS_PEERID_TEXT_KEY ?? '').trim() || 'xyz.skypier.peerid';

/**
 * The ENS registry deploys to the same address on every chain, and viem's chain
 * definitions do not carry an `ensRegistry` entry (only `ensUniversalResolver`), so
 * `getChainContractAddress(chain, 'ensRegistry')` would throw. Hardcode it.
 */
export const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const;

/** Holder-of-record for wrapped names; the true owner is then `NameWrapper.ownerOf(node)`. */
export const ENS_NAME_WRAPPER_ADDRESS = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401' as const;

/**
 * Sepolia carries a full ENS deployment, so pointing here lets the whole
 * publish -> lookup loop be exercised without spending mainnet gas.
 */
export const ensChain = (import.meta.env.VITE_ENS_CHAIN_ID ?? '').trim() === '11155111'
  ? sepolia
  : mainnet;

const ENS_RPC_URL = (import.meta.env.VITE_ENS_RPC_URL ?? '').trim() || 'https://ethereum.publicnode.com';

const publicClient = createPublicClient({
  chain: ensChain,
  transport: http(ENS_RPC_URL),
});

export function getEnsPublicClient() {
  return publicClient;
}

/**
 * ENSIP-15 normalization. `normalize` throws on malformed input, so every caller needs
 * this wrapper rather than a bare call.
 */
export function normalizeEnsName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes('.')) {
    return null;
  }

  try {
    const normalized = normalize(trimmed);
    return normalized || null;
  } catch {
    return null;
  }
}

export function ensExplorerUrl(hash: string): string {
  const base = ensChain.blockExplorers?.default.url ?? 'https://etherscan.io';
  return `${base}/tx/${hash}`;
}

export function ensAppUrl(name: string): string {
  return ensChain.id === sepolia.id
    ? `https://app.ens.domains/${name}?chain=sepolia`
    : `https://app.ens.domains/${name}`;
}
