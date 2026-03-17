import { recoverMessageAddress, stringToHex } from 'viem';
import type { LinkedEthAddress } from '@skypier/protocol';

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
}

interface BrowserWindowWithEthereum extends Window {
  ethereum?: Eip1193Provider;
}

export interface WalletLinkResult {
  wallet: LinkedEthAddress;
  chainHexId: string;
}

const walletProofPrefix = 'Skypier Chat wallet link proof';

export async function connectAndLinkEthWallet(localPeerId: string): Promise<WalletLinkResult> {
  const provider = getEthereumProvider();

  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  const account = accounts[0];

  if (!account) {
    throw new Error('No wallet account returned by provider.');
  }

  const chainHexId = await provider.request({ method: 'eth_chainId' }) as string;
  const chainId = Number.parseInt(chainHexId, 16);

  if (!Number.isFinite(chainId)) {
    throw new Error('Invalid chain ID from wallet provider.');
  }

  const linkedAt = new Date().toISOString();
  const proofMessage = [
    walletProofPrefix,
    `Peer: ${localPeerId}`,
    `Address: ${account.toLowerCase()}`,
    `ChainId: ${chainId}`,
    `Timestamp: ${linkedAt}`,
  ].join('\n');

  const signature = await requestPersonalSign(provider, account, proofMessage);
  const recovered = await recoverMessageAddress({
    message: proofMessage,
    signature: signature as `0x${string}`,
  });

  if (recovered.toLowerCase() !== account.toLowerCase()) {
    throw new Error('Wallet signature verification failed.');
  }

  return {
    chainHexId,
    wallet: {
      type: 'evm',
      address: account.toLowerCase(),
      chainId,
      linkedAt,
      signature,
      proofMessage,
    },
  };
}

function getEthereumProvider(): Eip1193Provider {
  const scopedWindow = window as BrowserWindowWithEthereum;
  if (!scopedWindow.ethereum) {
    throw new Error('No injected EVM wallet found. Install MetaMask, Rabby, or another EIP-1193 wallet.');
  }

  return scopedWindow.ethereum;
}

async function requestPersonalSign(provider: Eip1193Provider, account: string, message: string): Promise<string> {
  const hexMessage = stringToHex(message);

  try {
    const signature = await provider.request({
      method: 'personal_sign',
      params: [hexMessage, account],
    }) as string;

    return signature;
  } catch {
    const signature = await provider.request({
      method: 'personal_sign',
      params: [account, hexMessage],
    }) as string;

    return signature;
  }
}
