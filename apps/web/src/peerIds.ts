export function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractPeerIdFromChatTarget(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const decoded = safeDecodeUriComponent(value).trim();
  if (!decoded) {
    return undefined;
  }

  if (decoded.startsWith('/chats/')) {
    const peerFromPath = safeDecodeUriComponent(decoded.slice('/chats/'.length).split('/')[0] ?? '').trim();
    return peerFromPath || undefined;
  }

  if (decoded.startsWith('/u/')) {
    const peerFromPath = safeDecodeUriComponent(decoded.slice('/u/'.length).split('/')[0] ?? '').trim();
    return peerFromPath || undefined;
  }

  if (decoded.startsWith('web+skypierchat:')) {
    const protocolPayload = decoded.slice('web+skypierchat:'.length).replace(/^\/+/, '');
    return extractPeerIdFromChatTarget(protocolPayload);
  }

  try {
    const parsed = new URL(decoded);
    if (parsed.pathname.startsWith('/chats/')) {
      const peerFromPath = safeDecodeUriComponent(parsed.pathname.slice('/chats/'.length).split('/')[0] ?? '').trim();
      return peerFromPath || undefined;
    }

    if (parsed.pathname.startsWith('/u/')) {
      const peerFromPath = safeDecodeUriComponent(parsed.pathname.slice('/u/'.length).split('/')[0] ?? '').trim();
      return peerFromPath || undefined;
    }

    const peerFromQuery = parsed.searchParams.get('peer');
    if (peerFromQuery) {
      return extractPeerIdFromChatTarget(peerFromQuery);
    }
  } catch {
    // Not a URL, continue with raw value.
  }

  return decoded;
}

export function isLikelyPeerId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith('conv-') || trimmed.startsWith('group-')) {
    return false;
  }

  if (/[/?#]/.test(trimmed)) {
    return false;
  }

  if (/^(12D3KooW|Qm|bafz)/.test(trimmed)) {
    return true;
  }

  return /^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(trimmed);
}

/**
 * Discriminates an ENS-style handle from a raw peer ID. Peer IDs are base58/base32
 * and never contain a dot, so the dot is a reliable, cheap discriminator.
 */
export function looksLikeEnsHandle(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes('.')) {
    return false;
  }

  if (/[\s/?#]/.test(trimmed)) {
    return false;
  }

  return !trimmed.startsWith('.') && !trimmed.endsWith('.');
}
