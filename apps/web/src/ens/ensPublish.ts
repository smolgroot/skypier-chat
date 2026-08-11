import { createWalletClient, custom, getAddress, type Address, type Hash } from 'viem';
import { namehash } from 'viem/ens';
import { getEthereumProvider, type Eip1193Provider } from '../walletLinking';
import {
  ensAppUrl,
  ensChain,
  ENS_NAME_WRAPPER_ADDRESS,
  ENS_REGISTRY_ADDRESS,
  getEnsPublicClient,
  normalizeEnsName,
  SKYPIER_PEERID_TEXT_KEY,
} from './ensClient';
import { invalidateEnsHandle } from './ensHandles';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ensRegistryAbi = [
  {
    name: 'resolver',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const nameWrapperAbi = [
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const textResolverAbi = [
  {
    name: 'setText',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

export type EnsPublishStage =
  | 'connecting'
  | 'switching-chain'
  | 'checking'
  | 'awaiting-signature'
  | 'pending'
  | 'confirmed';

export interface EnsHandleWritability {
  name: string;
  node: `0x${string}`;
  resolverAddress: Address | null;
  ownerAddress: Address | null;
  isWrapped: boolean;
  callerCanWrite: boolean;
  currentRecord: string | null;
  reason?: string;
}

/**
 * ENS records live on one chain; the wallet may be anywhere. There is no chain-switching
 * helper elsewhere in the app, so this is it.
 */
export async function ensureEnsChain(provider: Eip1193Provider): Promise<void> {
  const before = await provider.request({ method: 'eth_chainId' }) as string;
  if (Number.parseInt(before, 16) === ensChain.id) {
    return;
  }

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${ensChain.id.toString(16)}` }],
    });
  } catch {
    throw new Error(`Switch your wallet to ${ensChain.name} to publish an ENS record.`);
  }

  // Some wallets resolve the switch before it has actually taken effect.
  const after = await provider.request({ method: 'eth_chainId' }) as string;
  if (Number.parseInt(after, 16) !== ensChain.id) {
    throw new Error(`Your wallet is not on ${ensChain.name}.`);
  }
}

/**
 * Determines whether `account` can write the Skypier text record for `name`.
 *
 * The authoritative check is a `simulateContract` call rather than an ownership
 * comparison: PublicResolver authorises the registry owner, the NameWrapper owner,
 * `isApprovedForAll` operators *and* per-node delegates. Re-implementing that matrix is
 * how you wrongly tell a Safe or delegate user they don't own their own name. Simulating
 * asks the chain exactly what the chain will enforce, costs nothing, and also catches
 * resolvers that don't implement `setText` at all (offchain/CCIP and L2 resolvers).
 */
export async function checkEnsHandleWritable(
  rawName: string,
  account: Address,
  probeValue = 'skypier-write-probe',
): Promise<EnsHandleWritability> {
  const name = normalizeEnsName(rawName);
  if (!name) {
    throw new Error(`"${rawName.trim()}" isn't a valid ENS name.`);
  }

  const client = getEnsPublicClient();
  const node = namehash(name);

  // Read the resolver from the registry, NOT via getEnsResolver: the latter walks up the
  // parent chain for wildcard resolution, and writing to an inherited parent resolver
  // would succeed on-chain while this name's own `text()` still returned nothing.
  const resolverAddress = await client.readContract({
    address: ENS_REGISTRY_ADDRESS,
    abi: ensRegistryAbi,
    functionName: 'resolver',
    args: [node],
  });

  if (!resolverAddress || resolverAddress === ZERO_ADDRESS) {
    return {
      name,
      node,
      resolverAddress: null,
      ownerAddress: null,
      isWrapped: false,
      callerCanWrite: false,
      currentRecord: null,
      reason: `${name} has no resolver set. Set the Public Resolver at ${ensAppUrl(name)} first.`,
    };
  }

  const registryOwner = await client.readContract({
    address: ENS_REGISTRY_ADDRESS,
    abi: ensRegistryAbi,
    functionName: 'owner',
    args: [node],
  });

  // A wrapped name is owned by the NameWrapper contract; the human owner is behind it.
  const isWrapped = registryOwner?.toLowerCase() === ENS_NAME_WRAPPER_ADDRESS.toLowerCase();
  let ownerAddress: Address | null = registryOwner ?? null;
  if (isWrapped) {
    ownerAddress = await client.readContract({
      address: ENS_NAME_WRAPPER_ADDRESS,
      abi: nameWrapperAbi,
      functionName: 'ownerOf',
      args: [BigInt(node)],
    }).catch(() => null);
  }

  const currentRecord = await client.readContract({
    address: resolverAddress,
    abi: textResolverAbi,
    functionName: 'text',
    args: [node, SKYPIER_PEERID_TEXT_KEY],
  }).catch(() => null);

  let callerCanWrite = false;
  let reason: string | undefined;
  try {
    await client.simulateContract({
      address: resolverAddress,
      abi: textResolverAbi,
      functionName: 'setText',
      args: [node, SKYPIER_PEERID_TEXT_KEY, probeValue],
      account,
    });
    callerCanWrite = true;
  } catch (error) {
    callerCanWrite = false;
    reason = describeSimulateFailure(error, name);
  }

  return {
    name,
    node,
    resolverAddress,
    ownerAddress,
    isWrapped,
    callerCanWrite,
    currentRecord: currentRecord?.trim() ? currentRecord.trim() : null,
    reason,
  };
}

export interface EnsPublishResult {
  name: string;
  hash: Hash | null;
  resolverAddress: Address;
  alreadyPublished: boolean;
}

export async function publishSkypierPeerIdToEns(options: {
  name: string;
  peerId: string;
  onStage?: (stage: EnsPublishStage) => void;
}): Promise<EnsPublishResult> {
  const { peerId, onStage } = options;
  const trimmedPeerId = peerId.trim();
  if (!trimmedPeerId) {
    throw new Error('No local peer ID is available yet.');
  }

  onStage?.('connecting');
  const provider = getEthereumProvider();
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  const rawAccount = accounts[0];
  if (!rawAccount) {
    throw new Error('No wallet account returned by provider.');
  }
  const account = getAddress(rawAccount);

  onStage?.('switching-chain');
  await ensureEnsChain(provider);

  onStage?.('checking');
  const check = await checkEnsHandleWritable(options.name, account, trimmedPeerId);

  if (!check.resolverAddress) {
    throw new Error(check.reason ?? `${check.name} has no resolver set.`);
  }

  // Republishing an identical value would burn gas for nothing.
  if (check.currentRecord === trimmedPeerId) {
    invalidateEnsHandle(check.name);
    onStage?.('confirmed');
    return {
      name: check.name,
      hash: null,
      resolverAddress: check.resolverAddress,
      alreadyPublished: true,
    };
  }

  if (!check.callerCanWrite) {
    throw new Error(check.reason
      ?? `This wallet can't write records for ${check.name}. Connect the address that owns it.`);
  }

  const client = getEnsPublicClient();
  // Simulate with the real value so the request we send is the one the chain validated.
  const { request } = await client.simulateContract({
    address: check.resolverAddress,
    abi: textResolverAbi,
    functionName: 'setText',
    args: [check.node, SKYPIER_PEERID_TEXT_KEY, trimmedPeerId],
    account,
  });

  const walletClient = createWalletClient({
    account,
    chain: ensChain,
    transport: custom(provider),
  });

  onStage?.('awaiting-signature');
  const hash = await walletClient.writeContract(request);

  onStage?.('pending');
  await client.waitForTransactionReceipt({ hash, confirmations: 1 });

  // Drop the cached lookup so the user's own /u/<name> link works immediately.
  invalidateEnsHandle(check.name);
  onStage?.('confirmed');

  return {
    name: check.name,
    hash,
    resolverAddress: check.resolverAddress,
    alreadyPublished: false,
  };
}

function describeSimulateFailure(error: unknown, name: string): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/revert/i.test(message) || /unauthori[sz]ed/i.test(message)) {
    return `This wallet can't write records for ${name}. Connect the address that owns it.`;
  }

  if (/function .* not found|execution reverted|returned no data/i.test(message)) {
    return `${name} uses a resolver that can't be written from this app (it may be an offchain or L2 resolver). Use the ENS app instead.`;
  }

  return `Couldn't verify write access for ${name}: ${message}`;
}

export function describeEnsWriteError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Failed to publish the ENS record.';
  }

  const message = error.message;
  const code = (error as { code?: number }).code;

  if (code === 4001 || /user rejected|user denied/i.test(message)) {
    return 'Signature request rejected.';
  }

  if (/insufficient funds/i.test(message)) {
    return `Not enough ${ensChain.nativeCurrency.symbol} to cover gas for this transaction.`;
  }

  // These already carry user-facing copy from the checks above.
  return message;
}
