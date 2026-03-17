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
          avatar = await publicClient.getEnsAvatar({ name });
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
