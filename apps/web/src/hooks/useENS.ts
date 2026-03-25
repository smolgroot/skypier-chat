import { useState, useEffect } from 'react';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(),
});

export interface ENSData {
  name: string | null;
  avatar: string | null;
  loading: boolean;
}

function canUseDomImageCheck(): boolean {
  return typeof window !== 'undefined' && typeof Image !== 'undefined';
}

function isLikelyHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

async function verifyImageUrl(url: string): Promise<boolean> {
  if (!isLikelyHttpUrl(url)) {
    return false;
  }

  if (!canUseDomImageCheck()) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const img = new Image();
    const timeout = window.setTimeout(() => {
      img.src = '';
      resolve(false);
    }, 7000);

    img.onload = () => {
      window.clearTimeout(timeout);
      resolve(true);
    };
    img.onerror = () => {
      window.clearTimeout(timeout);
      resolve(false);
    };
    img.src = url;
  });
}

function normalizeEnsAvatarUrl(value: string | null): string | null {
  if (!value) return null;

  if (value.startsWith('ipfs://')) {
    const path = value.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return `https://ipfs.io/ipfs/${path}`;
  }

  if (value.startsWith('ipns://')) {
    const path = value.slice('ipns://'.length).replace(/^ipns\//, '');
    return `https://ipfs.io/ipns/${path}`;
  }

  return value;
}

async function resolveEnsAvatar(name: string): Promise<string | null> {
  const direct = normalizeEnsAvatarUrl(await publicClient.getEnsAvatar({ name }));
  if (direct && await verifyImageUrl(direct)) {
    return direct;
  }

  const metadataAvatar = `https://metadata.ens.domains/mainnet/avatar/${encodeURIComponent(name)}`;
  if (await verifyImageUrl(metadataAvatar)) {
    return metadataAvatar;
  }

  return null;
}

export function useENS(address?: string): ENSData {
  const [data, setData] = useState<ENSData>({ name: null, avatar: null, loading: false });

  useEffect(() => {
    if (!address || !address.startsWith('0x')) {
      setData({ name: null, avatar: null, loading: false });
      return;
    }

    let isMounted = true;
    const fetchENS = async () => {
      setData(prev => ({ ...prev, loading: true }));
      try {
        const name = await publicClient.getEnsName({ address: address as `0x${string}` });
        let avatar: string | null = null;
        
        if (name && isMounted) {
          avatar = await resolveEnsAvatar(name);
        }

        if (isMounted) {
          setData({ name, avatar, loading: false });
        }
      } catch (error) {
        console.error('Error fetching ENS data:', error);
        if (isMounted) {
          setData({ name: null, avatar: null, loading: false });
        }
      }
    };

    void fetchENS();

    return () => {
      isMounted = false;
    };
  }, [address]);

  return data;
}
