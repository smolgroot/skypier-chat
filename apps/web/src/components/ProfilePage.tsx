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
      
      <Paper sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, mb: 4 }}>
        <UserAvatar 
          seed={peerId} 
          size={120} 
          sx={{ boxShadow: '0 8px 16px rgba(0,0,0,0.2)' }} 
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

        <Box sx={{ p: 2, bgcolor: '#fff', borderRadius: 2, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}>
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
            <Paper key={wallet.address} sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
