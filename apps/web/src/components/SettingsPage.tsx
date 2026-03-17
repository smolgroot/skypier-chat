import { Box, Typography, Card, CardContent, Button, Stack, TextField, Divider, List, ListItem, ListItemText, ListItemSecondaryAction, IconButton, Switch, ListItemButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import KeyIcon from '@mui/icons-material/Key';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import BackupIcon from '@mui/icons-material/Backup';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';

interface SettingsPageProps {
  keyCustodyPlan: any;
  runtimePlan: any;
  securitySummary: any;
  isLoaded: boolean;
  storageMode: string;
  liveState: any;
  connectedPeers: any[];
  presence: any[];
  peerMultiaddr: string;
  setPeerMultiaddr: (val: string) => void;
  dialPeer: (multiaddr: string) => Promise<string | void>;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  exportBackup: () => Promise<void>;
  lastBackupChecksum?: string;
  account: any;
  handleLinkWallet: () => void;
  unlinkEthAddress: (address: string) => Promise<void>;
  walletBusy: boolean;
  walletError?: string;
  dialError?: string;
  onBiometricUnlockToggle?: (enabled: boolean) => void;
}

export function SettingsPage(props: SettingsPageProps) {
  const {
    keyCustodyPlan,
    runtimePlan,
    securitySummary,
    isLoaded,
    storageMode,
    liveState,
    connectedPeers,
    presence,
    peerMultiaddr,
    setPeerMultiaddr,
    dialPeer,
    startSession,
    stopSession,
    exportBackup,
    lastBackupChecksum,
    account,
    handleLinkWallet,
    unlinkEthAddress,
    walletBusy,
    walletError,
    dialError,
    onBiometricUnlockToggle,
  } = props;

  return (
    <Box sx={{ p: 4, maxWidth: 800, mx: 'auto', height: '100%', overflowY: 'auto' }}>
      <Typography variant="h1" gutterBottom>
        Settings
      </Typography>

      <Stack spacing={4} sx={{ pb: 8 }}>
        {[
          { icon: <KeyIcon color="primary" />, title: 'Unlock and custody', content: (
            <>
              <Typography variant="body1" paragraph>{keyCustodyPlan.recommendation}</Typography>
              <List dense>
                <ListItem disablePadding>
                  <ListItemButton
                    onClick={() => onBiometricUnlockToggle?.(!account.biometricUnlockEnabled)}
                    sx={{ pr: 1 }}
                  >
                    <ListItemText
                      primary="Biometric unlock (experimental)"
                      secondary="Require fingerprint/face to unlock the private key on app load"
                    />
                    <Switch
                      edge="end"
                      checked={account.biometricUnlockEnabled ?? false}
                      onChange={() => onBiometricUnlockToggle?.(!account.biometricUnlockEnabled)}
                    />
                  </ListItemButton>
                </ListItem>
                <ListItem>
                  <ListItemText primary="Biometrics available" secondary="yes" />
                </ListItem>
                <ListItem>
                  <ListItemText primary="Secure hardware available" secondary="no in browser MVP" />
                </ListItem>
              </List>
            </>
          )},
          { icon: <SettingsInputAntennaIcon color="primary" />, title: 'Transport roadmap', content: (
            <>
              <Typography variant="body1" paragraph>
                Noise handshake planned with {runtimePlan.natTraversal.join(', ')} for traversal support.
              </Typography>
              <List dense>
                {runtimePlan.transports.map((t: any) => (
                  <ListItem key={t.transport}>
                    <ListItemText primary={t.transport} secondary={`${t.status} — ${t.reason}`} />
                  </ListItem>
                ))}
              </List>
            </>
          )},
          { title: 'Session view', content: (
            <>
              <Typography variant="body2" color="text.secondary" paragraph>
                Transport {securitySummary.transportStatus}; payloads use {securitySummary.contentEncryption}; local vault uses {securitySummary.localStorageEncryption}. Loaded: {isLoaded ? 'yes' : 'no'}.
              </Typography>
              <List dense>
                <ListItem><ListItemText primary="Persisted locally with" secondary={storageMode} /></ListItem>
                <ListItem><ListItemText primary="Live node status" secondary={liveState.status} /></ListItem>
                <ListItem><ListItemText primary="Local peer ID" secondary={liveState.localPeerId ?? 'not started'} /></ListItem>
                <ListItem><ListItemText primary="Connected peers" secondary={connectedPeers.length} /></ListItem>
                {presence.map((entry) => (
                  <ListItem key={entry.peerId}>
                    <ListItemText primary={entry.peerId.slice(0, 12) + '…'} secondary={entry.reachability} />
                  </ListItem>
                ))}
              </List>
              <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                <Button variant="outlined" onClick={() => void startSession()}>Start live session</Button>
                <Button variant="outlined" color="error" onClick={() => void stopSession()}>Stop</Button>
              </Stack>
              <Box sx={{ mt: 3, display: 'flex', gap: 1 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Peer Multiaddr"
                  value={peerMultiaddr}
                  onChange={(e) => setPeerMultiaddr(e.target.value)}
                  placeholder="/ip4/.../tcp/.../p2p/..."
                />
                <Button 
                  variant="contained" 
                  onClick={() => void dialPeer(peerMultiaddr)}
                  disabled={!peerMultiaddr.trim()}
                >
                  Dial
                </Button>
              </Box>
              {dialError && <Typography color="error" variant="caption" sx={{ mt: 1, display: 'block' }}>{dialError}</Typography>}
              {liveState.lastError && <Typography color="error" variant="caption" sx={{ mt: 1, display: 'block' }}>{liveState.lastError}</Typography>}
            </>
          )},
          { icon: <BackupIcon color="primary" />, title: 'Encrypted backups', content: (
            <>
              <Typography variant="body1" paragraph>
                Exports the current local state as an encrypted JSON bundle.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Latest checksum: {lastBackupChecksum ?? 'not exported yet'}
              </Typography>
              <Button variant="contained" startIcon={<BackupIcon />} sx={{ mt: 2 }} onClick={() => void exportBackup()}>
                Export backup bundle
              </Button>
            </>
          )},
          { icon: <AccountBalanceWalletIcon color="primary" />, title: 'EVM wallet identity', content: (
            <>
              <Typography variant="body1" paragraph>
                Connect an EIP-1193 wallet to link an ETH address to this local Skypier account.
              </Typography>
              <List dense>
                {account.linkedEthAddresses.map((wallet: any) => (
                  <ListItem key={wallet.address}>
                    <ListItemText 
                      primary={`${wallet.address.slice(0, 8)}…${wallet.address.slice(-6)}`} 
                      secondary={`Chain ${wallet.chainId}`} 
                    />
                    <ListItemSecondaryAction>
                      <IconButton edge="end" color="error" onClick={() => void unlinkEthAddress(wallet.address)}>
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
              <Button variant="contained" sx={{ mt: 2 }} onClick={handleLinkWallet} disabled={walletBusy}>
                {walletBusy ? 'Linking…' : 'Connect & link wallet'}
              </Button>
              {walletError && <Typography color="error" variant="caption" sx={{ mt: 1, display: 'block' }}>{walletError}</Typography>}
            </>
          )}
        ].map((section, idx) => (
          <Box 
            key={idx}
            sx={{ 
              p: 3, 
              borderRadius: 4,
              bgcolor: (theme) => 
                theme.palette.mode === 'dark' 
                  ? 'rgba(14, 8, 28, 0.6)' 
                  : 'rgba(255, 255, 255, 0.7)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: (theme) => 
                theme.palette.mode === 'dark' 
                  ? '1px solid rgba(171, 110, 255, 0.15)' 
                  : '1px solid rgba(0, 0, 0, 0.05)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              {section.icon}
              <Typography variant="h3">{section.title}</Typography>
            </Box>
            {section.content}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
