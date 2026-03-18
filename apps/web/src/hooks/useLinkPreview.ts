import { useState, useEffect } from 'react';

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  logo?: string;
  publisher?: string;
  hostname: string;
}

// In-memory cache to avoid redundant fetches within a session
const previewCache = new Map<string, LinkPreviewData | null>();
const MICROLINK_API = 'https://api.microlink.io';

const URL_REGEX = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

export function extractFirstUrl(text: string): string | null {
  const match = URL_REGEX.exec(text);
  // Reset regex state
  URL_REGEX.lastIndex = 0;
  return match ? match[0] : null;
}

export function useLinkPreview(text: string): {
  preview: LinkPreviewData | null;
  loading: boolean;
} {
  const url = extractFirstUrl(text);
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) {
      setPreview(null);
      return;
    }

    // Serve from cache immediately
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url) ?? null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function fetchPreview() {
      try {
        const apiUrl = `${MICROLINK_API}?url=${encodeURIComponent(url!)}`;
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as {
          status: string;
          data: {
            title?: string;
            description?: string;
            image?: { url?: string };
            logo?: { url?: string };
            publisher?: string;
            url?: string;
          };
        };

        if (json.status !== 'success' || !json.data) {
          previewCache.set(url!, null);
          return;
        }

        const { data } = json;

        // Build a clean hostname label
        let hostname = url!;
        try { hostname = new URL(url!).hostname.replace(/^www\./, ''); } catch { /* ignore */ }

        const result: LinkPreviewData = {
          url: data.url ?? url!,
          title: data.title || undefined,
          description: data.description || undefined,
          image: data.image?.url || undefined,
          logo: data.logo?.url || undefined,
          publisher: data.publisher || hostname,
          hostname,
        };

        previewCache.set(url!, result);
        if (!cancelled) setPreview(result);
      } catch {
        previewCache.set(url!, null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchPreview();
    return () => { cancelled = true; };
  }, [url]);

  return { preview, loading };
}
