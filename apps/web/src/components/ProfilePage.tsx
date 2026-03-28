import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, Paper, Snackbar, Stack, Switch, TextField, Typography } from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditIcon from '@mui/icons-material/Edit';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { UserAvatar } from './UserAvatar';

interface ProfilePageProps {
  peerId: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  shareEnsDisplayName?: boolean;
  preferEnsAvatar?: boolean;
  resolvedEnsName?: string | null;
  resolvedEnsAvatar?: string | null;
  linkedWallets: { address: string; chainId: number }[];
  onSaveProfile: (updates: {
    displayName: string;
    profileBio?: string;
    profileAvatarUrl?: string;
    shareEnsDisplayName: boolean;
    preferEnsAvatar: boolean;
  }) => Promise<void> | void;
}

const MAX_PROFILE_AVATAR_BYTES = 48 * 1024;

function estimateBase64Bytes(dataUri: string): number {
  const base64 = dataUri.split(',')[1] ?? '';
  return Math.ceil(base64.length * 0.75);
}

async function compressProfileAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const MAX_EDGE = 192;
      let { naturalWidth: width, naturalHeight: height } = img;
      if (width > MAX_EDGE || height > MAX_EDGE) {
        const ratio = Math.min(MAX_EDGE / width, MAX_EDGE / height);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        canvas.width = 0;
        canvas.height = 0;
        reject(new Error('Could not prepare image compression.'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const qualitySteps = [0.82, 0.72, 0.62, 0.5];
      let best = '';

      for (const quality of qualitySteps) {
        const candidate = canvas.toDataURL('image/jpeg', quality);
        best = candidate;
        if (estimateBase64Bytes(candidate) <= MAX_PROFILE_AVATAR_BYTES) {
          break;
        }
      }

      canvas.width = 0;
      canvas.height = 0;

      if (!best || estimateBase64Bytes(best) > MAX_PROFILE_AVATAR_BYTES) {
        reject(new Error('Profile image is still too large after compression. Try a smaller image.'));
        return;
      }

      resolve(best);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load selected image.'));
    };

    img.src = objectUrl;
  });
}

function getBlockscoutAddressUrl(chainId: number, address: string): string {
  const hostsByChainId: Record<number, string> = {
    1: 'https://eth.blockscout.com',
    10: 'https://optimism.blockscout.com',
    100: 'https://gnosis.blockscout.com',
    130: 'https://unichain.blockscout.com',
    137: 'https://polygon.blockscout.com',
    42161: 'https://arbitrum.blockscout.com',
    8453: 'https://base.blockscout.com',
    11155111: 'https://eth-sepolia.blockscout.com',
    421614: 'https://arbitrum-sepolia.blockscout.com',
    84532: 'https://base-sepolia.blockscout.com',
  };

  const host = hostsByChainId[chainId] ?? 'https://eth.blockscout.com';
  return `${host}/address/${address}`;
}

export function ProfilePage({ peerId, displayName, avatarUrl, bio, shareEnsDisplayName = false, preferEnsAvatar = false, resolvedEnsName, resolvedEnsAvatar, linkedWallets, onSaveProfile }: ProfilePageProps) {
  const [shareSuccess, setShareSuccess] = useState<string | undefined>();
  const [shareError, setShareError] = useState<string | undefined>();
  const [shareBusy, setShareBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [editError, setEditError] = useState<string | undefined>();
  const [form, setForm] = useState({
    displayName,
    profileBio: bio ?? '',
    profileAvatarUrl: avatarUrl ?? '',
    shareEnsDisplayName,
    preferEnsAvatar,
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const appUrl = 'https://skypier.chat';
  const effectiveAvatarUrl = preferEnsAvatar && resolvedEnsAvatar ? resolvedEnsAvatar : avatarUrl;

  const inviteText = useMemo(() => (
    `Hey, I'm using Skypier dMessenger, the decentralized and privacy-focused chat. Let's join me there.\n\n${appUrl}\n\nPeer ID: ${peerId}`
  ), [appUrl, peerId]);

  useEffect(() => {
    if (editOpen) {
      return;
    }

    setForm({
      displayName,
      profileBio: bio ?? '',
      profileAvatarUrl: avatarUrl ?? '',
      shareEnsDisplayName,
      preferEnsAvatar,
    });
    setEditError(undefined);
  }, [avatarUrl, bio, displayName, editOpen, preferEnsAvatar, shareEnsDisplayName]);

  const copyToClipboard = async (text: string, successMessage?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (successMessage) {
        setShareSuccess(successMessage);
      }
    } catch {
      setShareError('Could not copy to clipboard. Please copy it manually.');
    }
  };

  const handleShare = async () => {
    setShareError(undefined);
    setShareBusy(true);

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: 'Skypier dMessenger invite',
          text: inviteText,
          url: appUrl,
        });
        setShareSuccess('Invite shared.');
        return;
      }

      await copyToClipboard(inviteText, 'Web Share is not available. Invite copied to clipboard.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      await copyToClipboard(inviteText, 'Share failed. Invite copied to clipboard.');
    } finally {
      setShareBusy(false);
    }
  };

  const handleAvatarSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const compressed = await compressProfileAvatar(file);
      setForm((current) => ({ ...current, profileAvatarUrl: compressed }));
      setEditError(undefined);
      setShareSuccess('Profile image updated. Save to publish it.');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Could not process that image.');
    } finally {
      event.target.value = '';
    }
  };

  const handleSaveProfile = async () => {
    const trimmedName = form.displayName.trim();
    if (!trimmedName) {
      setEditError('Display name is required.');
      return;
    }

    setSaveBusy(true);
    try {
      await onSaveProfile({
        displayName: trimmedName,
        profileBio: form.profileBio.trim() || undefined,
        profileAvatarUrl: form.profileAvatarUrl || undefined,
        shareEnsDisplayName: form.shareEnsDisplayName,
        preferEnsAvatar: form.preferEnsAvatar,
      });
      setEditOpen(false);
      setEditError(undefined);
      setShareSuccess('Profile updated.');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Failed to save profile.');
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <Box sx={{ p: 4, maxWidth: 600, mx: 'auto', height: '100%', overflowY: 'auto' }}>
      <Typography variant="h1" gutterBottom align="center">
        User Profile
      </Typography>
      
      <Paper 
        elevation={0}
        sx={{ 
          p: 4, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          gap: 3, 
          mb: 4,
          bgcolor: (theme) => 
            theme.palette.mode === 'dark' 
              ? 'rgba(14, 8, 28, 0.2)' 
              : 'rgba(255, 255, 255, 0.2)',
          backdropFilter: (theme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
          WebkitBackdropFilter: (theme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
          filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
          border: (theme) => 
            theme.palette.mode === 'dark' 
              ? '1px solid rgba(171, 110, 255, 0.25)' 
              : '1px solid rgba(0, 0, 0, 0.08)',
          borderRadius: 4,
          backgroundImage: 'none',
          boxShadow: (theme) => 
            theme.palette.mode === 'dark'
              ? '0 8px 32px 0 rgba(0, 0, 0, 0.4)'
              : '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
        }}
      >
        <UserAvatar 
          seed={peerId} 
          size={120} 
          src={effectiveAvatarUrl || undefined}
          sx={{ boxShadow: '0 8px 32px rgba(142, 45, 226, 0.3)' }} 
        />

        <Box sx={{ textAlign: 'center', width: '100%' }}>
          <Typography variant="h2" gutterBottom>
            {displayName}
          </Typography>
          {shareEnsDisplayName && resolvedEnsName ? (
            <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 1 }}>
              {resolvedEnsName}
            </Typography>
          ) : null}
          {bio ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {bio}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1} justifyContent="center" sx={{ mb: 1.5, flexWrap: 'wrap' }}>
            {shareEnsDisplayName && resolvedEnsName ? <Chip size="small" label="Sharing ENS name" color="primary" variant="outlined" /> : null}
            {preferEnsAvatar && resolvedEnsAvatar ? <Chip size="small" label="Using ENS avatar" color="primary" variant="outlined" /> : null}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all', mb: 1 }}>
            Peer ID: {peerId}
          </Typography>
          <Button 
            size="small" 
            startIcon={<ContentCopyIcon />} 
            onClick={() => { void copyToClipboard(peerId, 'Peer ID copied.'); }}
          >
            Copy ID
          </Button>
        </Box>

        <Divider sx={{ width: '100%' }} />

        <Box sx={{ p: 2, bgcolor: '#fff', borderRadius: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          <QRCodeSVG value={peerId} size={200} includeMargin={true} />
        </Box>
        <Typography variant="caption" color="text.secondary">
          Scan to connect with me
        </Typography>

        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
            Edit Profile
          </Button>
          <Button variant="contained" startIcon={<ShareIcon />} onClick={() => { void handleShare(); }} disabled={shareBusy}>
            {shareBusy ? 'Sharing…' : 'Share Invite'}
          </Button>
        </Stack>
      </Paper>

      <Typography variant="h3" gutterBottom>
        Linked Wallets
      </Typography>
      {linkedWallets.length > 0 ? (
        <Stack spacing={2}>
          {linkedWallets.map((wallet) => {
            const explorerUrl = getBlockscoutAddressUrl(wallet.chainId, wallet.address);
            return (
            <Paper 
              key={wallet.address} 
              elevation={0}
              sx={{ 
                p: 2, 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                bgcolor: (theme) => 
                  theme.palette.mode === 'dark' 
                    ? 'rgba(14, 8, 28, 0.5)' 
                    : 'rgba(255, 255, 255, 0.3)',
                backdropFilter: 'blur(10px) saturate(180%)',
                WebkitBackdropFilter: 'blur(10px) saturate(180%)',
                border: (theme) => 
                  theme.palette.mode === 'dark' 
                    ? '1px solid rgba(171, 110, 255, 0.1)' 
                    : '1px solid rgba(0, 0, 0, 0.05)',
                backgroundImage: 'none'
              }}
            >
              <Box>
                <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                  {wallet.address.slice(0, 10)}...{wallet.address.slice(-8)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Chain ID: {wallet.chainId}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  component="a"
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  endIcon={<OpenInNewIcon fontSize="small" />}
                >
                  Blockscout
                </Button>
                <Button size="small" onClick={() => { void copyToClipboard(wallet.address, 'Wallet address copied.'); }}>
                  Copy
                </Button>
              </Stack>
            </Paper>
            );
          })}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No wallets linked yet.
        </Typography>
      )}

      <Snackbar
        open={Boolean(shareSuccess)}
        autoHideDuration={3000}
        onClose={() => setShareSuccess(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setShareSuccess(undefined)}>
          {shareSuccess}
        </Alert>
      </Snackbar>

      <Snackbar
        open={Boolean(shareError)}
        autoHideDuration={3500}
        onClose={() => setShareError(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={() => setShareError(undefined)}>
          {shareError}
        </Alert>
      </Snackbar>

      <Dialog open={editOpen} onClose={() => !saveBusy && setEditOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Edit profile</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => { void handleAvatarSelected(event); }}
            style={{ display: 'none' }}
          />

          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <UserAvatar
              seed={peerId}
              size={96}
              src={(form.preferEnsAvatar && resolvedEnsAvatar) ? resolvedEnsAvatar : (form.profileAvatarUrl || undefined)}
            />
          </Box>

          <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap">
            <Button startIcon={<PhotoCameraIcon />} variant="outlined" onClick={() => fileInputRef.current?.click()}>
              Upload avatar
            </Button>
            <Button
              startIcon={<DeleteOutlineIcon />}
              color="inherit"
              onClick={() => setForm((current) => ({ ...current, profileAvatarUrl: '' }))}
              disabled={!form.profileAvatarUrl}
            >
              Remove upload
            </Button>
          </Stack>

          <Typography variant="caption" color="text.secondary">
            Uploaded avatars are compressed into a small base64 JPEG before saving.
          </Typography>

          <TextField
            label="Display name"
            fullWidth
            value={form.displayName}
            onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
          />

          <TextField
            label="Bio"
            fullWidth
            multiline
            minRows={3}
            value={form.profileBio}
            onChange={(event) => setForm((current) => ({ ...current, profileBio: event.target.value }))}
            placeholder="A short profile blurb"
          />

          <FormControlLabel
            control={(
              <Switch
                checked={form.shareEnsDisplayName}
                onChange={(event) => setForm((current) => ({ ...current, shareEnsDisplayName: event.target.checked }))}
                disabled={!resolvedEnsName}
              />
            )}
            label={resolvedEnsName ? `Share ENS display name (${resolvedEnsName})` : 'Share ENS display name'}
          />

          <FormControlLabel
            control={(
              <Switch
                checked={form.preferEnsAvatar}
                onChange={(event) => setForm((current) => ({ ...current, preferEnsAvatar: event.target.checked }))}
                disabled={!resolvedEnsAvatar}
              />
            )}
            label={resolvedEnsAvatar ? 'Prefer ENS avatar over uploaded avatar' : 'Prefer ENS avatar when one is available'}
          />

          {!resolvedEnsName && linkedWallets.length > 0 ? (
            <Typography variant="caption" color="text.secondary">
              ENS data has not resolved yet for your linked wallet.
            </Typography>
          ) : null}
          {linkedWallets.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              Link a wallet in Settings to enable ENS sharing options.
            </Typography>
          ) : null}
          {editError ? <Alert severity="error">{editError}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} disabled={saveBusy}>Cancel</Button>
          <Button onClick={() => { void handleSaveProfile(); }} variant="contained" disabled={saveBusy}>
            {saveBusy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
