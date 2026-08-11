import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, Paper, Snackbar, Stack, Switch, TextField, Typography, Tabs, Tab, IconButton } from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
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
  /** ENS name this account published a peer-ID record on, if any. */
  ensHandle?: string;
  /** Peer ID that record actually contains; a mismatch means it needs republishing. */
  ensHandlePublishedPeerId?: string;
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

export function ProfilePage({ peerId, displayName, avatarUrl, bio, shareEnsDisplayName = false, preferEnsAvatar = false, resolvedEnsName, resolvedEnsAvatar, ensHandle, ensHandlePublishedPeerId, linkedWallets, onSaveProfile }: ProfilePageProps) {
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
  const [activeTab, setActiveTab] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };
  const appUrl = 'https://skypier.chat';
  // `/u/` is the canonical user link and accepts both forms. The ENS variant is less than
  // half the length, which measurably loosens the QR code.
  const profileLink = useMemo(
    () => (ensHandle?.trim()
      ? `${appUrl}/u/${ensHandle.trim()}`
      : `${appUrl}/u/${encodeURIComponent(peerId)}`),
    [appUrl, ensHandle, peerId],
  );
  const ensHandleIsStale = Boolean(
    ensHandle && ensHandlePublishedPeerId && ensHandlePublishedPeerId !== peerId,
  );
  const effectiveAvatarUrl = preferEnsAvatar && resolvedEnsAvatar ? resolvedEnsAvatar : avatarUrl;

  const inviteText = useMemo(() => (
    `Hey, I'm using Skypier dMessenger, the decentralized and privacy-focused chat.\n\nStart a secure chat with me:\n${profileLink}\n\nIf needed, my Peer ID is: ${peerId}`
  ), [peerId, profileLink]);

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
          url: profileLink,
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
    <Box sx={{ display: 'flex', height: '100%', flexDirection: { xs: 'column', md: 'row' }, overflowX: 'hidden', overflowY: { xs: 'auto', md: 'hidden' } }}>
      {/* Left panel - Profile Basics */}
      <Box
        sx={{
          width: { xs: '100%', md: '40%' },
          maxWidth: { md: 480 },
          minWidth: { md: 360 },
          display: 'flex',
          flexDirection: 'column',
          borderRight: (theme) => theme.palette.mode === 'dark' ? '1px solid rgba(171, 110, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.08)',
          borderBottom: { xs: (theme) => theme.palette.mode === 'dark' ? '1px solid rgba(171, 110, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.08)', md: 'none' },
          bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(14, 8, 28, 0.2)' : 'rgba(255, 255, 255, 0.4)',
          overflowY: { xs: 'visible', md: 'auto' },
          flexShrink: 0,
          zIndex: 2,
        }}
      >
        <Box 
          sx={{ 
            height: 180, 
            width: '100%', 
            background: (theme) => theme.palette.mode === 'dark' 
              ? 'linear-gradient(135deg, #1A0D35 0%, #351C61 50%, #1A0D35 100%)' 
              : 'linear-gradient(135deg, #8E2DE2 0%, #4A00E0 100%)',
            flexShrink: 0
          }} 
        />
        
        <Box sx={{ px: { xs: 2, sm: 3 }, pb: 4, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mt: '-65px', mb: 2 }}>
            <Box 
              sx={{ 
                borderRadius: '50%', 
                padding: '5px', 
                bgcolor: (theme) => theme.palette.mode === 'dark' ? '#0f0a1c' : '#fff',
                position: 'relative'
              }}
            >
              <UserAvatar 
                seed={peerId} 
                size={120} 
                src={effectiveAvatarUrl || undefined}
                sx={{ 
                  boxShadow: '0 4px 14px rgba(0,0,0,0.2)', 
                  border: '2px solid transparent'
                }} 
              />
            </Box>
          </Box>

          <Box sx={{ mb: 3 }}>
            <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              {displayName}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
              <Typography variant="body1" color="text.secondary">
                {shareEnsDisplayName && resolvedEnsName ? resolvedEnsName : `@${peerId.slice(0, 8)}`}
              </Typography>
              <Chip 
                size="small" 
                label="Copy ID" 
                icon={<ContentCopyIcon sx={{ fontSize: 12 }} />} 
                onClick={() => { void copyToClipboard(peerId, 'Peer ID copied.'); }}
                sx={{ height: 20, fontSize: '0.65rem', cursor: 'pointer', '.MuiChip-label': { px: 1 } }}
              />
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all', mt: 1 }}>
              Peer ID: {peerId}
            </Typography>

            {bio ? (
              <Typography variant="body1" sx={{ mt: 2, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {bio}
              </Typography>
            ) : null}

            <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
              {shareEnsDisplayName && resolvedEnsName ? <Chip size="small" label="ENS Linked" variant="outlined" /> : null}
              {preferEnsAvatar && resolvedEnsAvatar ? <Chip size="small" label="ENS Avatar" variant="outlined" /> : null}
              {ensHandle ? (
                <Chip
                  size="small"
                  color={ensHandleIsStale ? 'warning' : 'default'}
                  variant="outlined"
                  label={ensHandleIsStale
                    ? `${ensHandle} · record is stale`
                    : `Published to ENS · ${ensHandle}`}
                />
              ) : null}
            </Stack>
          </Box>

          <Stack direction="row" spacing={2} sx={{ mt: 'auto', pt: 2 }}>
            <Button 
              fullWidth
              variant="outlined" 
              size="large" 
              sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 'bold' }}
              onClick={() => setEditOpen(true)}
            >
              Edit Profile
            </Button>
            <Button 
              fullWidth
              variant="contained" 
              size="large" 
              disableElevation
              sx={{ 
                borderRadius: 3, 
                textTransform: 'none', 
                fontWeight: 'bold',
                background: (theme) => theme.palette.mode === 'dark' ? 'linear-gradient(135deg, #8e2de2, #4a00e0)' : 'linear-gradient(135deg, #1f7cff, #42c6ff)',
              }}
              onClick={() => { void handleShare(); }} 
              disabled={shareBusy}
            >
              {shareBusy ? 'Sharing…' : 'Share Profile'}
            </Button>
          </Stack>
        </Box>
      </Box>

      {/* Right panel - Extra details / Tabs */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflowY: { xs: 'visible', md: 'hidden' },
          bgcolor: (theme) => theme.palette.mode === 'dark' ? 'transparent' : 'rgba(255, 255, 255, 0.2)',
        }}
      >
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: { xs: 2, md: 4 }, pt: { xs: 2, md: 4 } }}>
          <Tabs 
            value={activeTab} 
            onChange={handleTabChange} 
            aria-label="profile tabs"
            TabIndicatorProps={{ sx: { height: 3, borderRadius: '3px 3px 0 0' } }}
          >
            <Tab 
              icon={<QrCode2Icon sx={{ mr: 1, mb: '0 !important' }} />} 
              iconPosition="start"
              label="QR Code" 
              sx={{ textTransform: 'none', fontWeight: 600, minHeight: 48 }} 
            />
            <Tab 
              icon={<AccountBalanceWalletIcon sx={{ mr: 1, mb: '0 !important' }} />} 
              iconPosition="start"
              label="Linked Wallets" 
              sx={{ textTransform: 'none', fontWeight: 600, minHeight: 48 }} 
            />
          </Tabs>
        </Box>

        <Box sx={{ flexGrow: 1, p: { xs: 2, md: 4 }, overflowY: { xs: 'visible', md: 'auto' } }}>
          {activeTab === 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
              <Box 
                sx={{ 
                  p: 4, 
                  bgcolor: '#fff', 
                  borderRadius: 4, 
                  boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
                  border: '1px solid rgba(0,0,0,0.05)',
                  mb: 3
                }}
              >
                <QRCodeSVG value={profileLink} size={280} includeMargin={true} />
              </Box>
              <Typography variant="body1" color="text.secondary" fontWeight={500}>
                Scan to connect with me
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1, wordBreak: 'break-all', fontFamily: ensHandle ? undefined : 'monospace' }}
              >
                {profileLink}
              </Typography>
            </Box>
          )}

          {activeTab === 1 && (
            <Box sx={{ maxWidth: 800 }}>
              {linkedWallets.length > 0 ? (
                <Stack spacing={2}>
                  {linkedWallets.map((wallet) => {
                    const explorerUrl = getBlockscoutAddressUrl(wallet.chainId, wallet.address);
                    return (
                      <Paper 
                        key={wallet.address} 
                        elevation={0}
                        sx={{ 
                          p: 2.5, 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : '#fff',
                          border: (theme) => theme.palette.mode === 'dark' ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.08)',
                          borderRadius: 3
                        }}
                      >
                        <Box>
                          <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                            {wallet.address.slice(0, 10)}...{wallet.address.slice(-8)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            Chain ID: {wallet.chainId}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1}>
                          <IconButton
                            size="small"
                            component="a"
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            color="primary"
                            sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(142, 45, 226, 0.15)' : 'rgba(31, 124, 255, 0.1)' }}
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                          <IconButton 
                            size="small" 
                            color="secondary"
                            onClick={() => { void copyToClipboard(wallet.address, 'Wallet address copied.'); }}
                            sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255, 0.1)' : 'rgba(0,0,0, 0.05)' }}
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Paper>
                    );
                  })}
                </Stack>
              ) : (
                <Box sx={{ py: 8, textAlign: 'center' }}>
                  <Typography variant="h6" color="text.secondary" gutterBottom>
                    No linked wallets
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    You can link Ethereum wallets in Settings to share your ENS details on your profile.
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>

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
