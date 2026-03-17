import { Box, Typography, Button, Paper, Divider, Stack } from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';
import { UserAvatar } from './UserAvatar';

interface ProfilePageProps {
  peerId: string;
  displayName: string;
  linkedWallets: { address: string; chainId: number }[];
}

export function ProfilePage({ peerId, displayName, linkedWallets }: ProfilePageProps) {
  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
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
          backdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
          WebkitBackdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
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
          sx={{ boxShadow: '0 8px 32px rgba(142, 45, 226, 0.3)' }} 
        />

        <Box sx={{ textAlign: 'center', width: '100%' }}>
          <Typography variant="h2" gutterBottom>
            {displayName}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all', mb: 1 }}>
            Peer ID: {peerId}
          </Typography>
          <Button 
            size="small" 
            startIcon={<ContentCopyIcon />} 
            onClick={() => copyToClipboard(peerId)}
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
          <Button variant="contained" startIcon={<ShareIcon />}>
            Share Link
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
              <Button size="small" onClick={() => copyToClipboard(wallet.address)}>
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
    </Box>
  );
}
