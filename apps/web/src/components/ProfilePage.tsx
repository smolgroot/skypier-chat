import { useMemo, useState } from 'react';
import { Box, Typography, Button, Paper, Divider, Stack, Snackbar, Alert } from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';
import { UserAvatar } from './UserAvatar';
import { useENS } from '../hooks/useENS';

interface ProfilePageProps {
  peerId: string;
  displayName: string;
  linkedWallets: { address: string; chainId: number }[];
}

export function ProfilePage({ peerId, displayName, linkedWallets }: ProfilePageProps) {
  const firstWallet = linkedWallets[0]?.address;
  const { name: ensName, avatar: ensAvatar } = useENS(firstWallet);
  const [shareSuccess, setShareSuccess] = useState<string | undefined>();
  const [shareError, setShareError] = useState<string | undefined>();
  const [shareBusy, setShareBusy] = useState(false);

  const inviteText = useMemo(() => (
    `Hey, I'm using Skypier dMessenger, the decentralized and privacy-focused chat. Let's join me there.\n\nPeer ID: ${peerId}`
  ), [peerId]);

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
          src={ensAvatar}
          sx={{ boxShadow: '0 8px 32px rgba(142, 45, 226, 0.3)' }} 
        />

        <Box sx={{ textAlign: 'center', width: '100%' }}>
          <Typography variant="h2" gutterBottom>
            {ensName || displayName}
          </Typography>
          {ensName && (
            <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 1 }}>
              ({displayName})
            </Typography>
          )}
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
          {linkedWallets.map((wallet) => (
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
              <Button size="small" onClick={() => { void copyToClipboard(wallet.address, 'Wallet address copied.'); }}>
                Copy
              </Button>
            </Paper>
          ))}
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
    </Box>
  );
}
