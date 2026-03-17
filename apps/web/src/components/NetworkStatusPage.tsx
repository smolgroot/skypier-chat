import { Box, Typography, Paper, Grid, Chip, List, ListItem, ListItemText, Divider, Stack } from '@mui/material';
import SignalWifi4BarIcon from '@mui/icons-material/SignalWifi4Bar';
import HubIcon from '@mui/icons-material/Hub';
import SpeedIcon from '@mui/icons-material/Speed';
import SecurityIcon from '@mui/icons-material/Security';
import type { BrowserLiveSessionState } from '@skypier/network';
import { createRuntimePlan } from '@skypier/network';

interface NetworkStatusPageProps {
  sessionState: BrowserLiveSessionState;
}

export function NetworkStatusPage({ sessionState }: NetworkStatusPageProps) {
  const plan = createRuntimePlan('browser-pwa');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'success';
      case 'starting': return 'warning';
      case 'stopped': return 'error';
      case 'error': return 'error';
      default: return 'default';
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1000, mx: 'auto', overflowY: 'auto', height: '100%' }}>
      <Typography variant="h4" sx={{ mb: 4, fontWeight: 'bold' }}>
        Network Status
      </Typography>

      <Grid container spacing={3}>
        {/* Connection Status Card */}
        <Grid sx={{ gridColumn: { xs: 'span 12', md: 'span 6' } }}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              height: '100%',
              bgcolor: (theme) => 
                theme.palette.mode === 'dark' 
                  ? 'rgba(14, 8, 28, 0.3)' 
                  : 'rgba(255, 255, 255, 0.35)',
              backdropFilter: 'blur(30px) saturate(190%)',
              WebkitBackdropFilter: 'blur(30px) saturate(190%)',
              border: (theme) => 
                theme.palette.mode === 'dark' 
                  ? '1px solid rgba(171, 110, 255, 0.2)' 
                  : '1px solid rgba(0, 0, 0, 0.08)',
              borderRadius: 4,
              boxShadow: (theme) => 
                theme.palette.mode === 'dark'
                  ? '0 8px 32px 0 rgba(0, 0, 0, 0.4)'
                  : '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
            }}
          >
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <SignalWifi4BarIcon color="primary" />
                <Typography variant="h6">Connection Overview</Typography>
              </Box>
              
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">Status</Typography>
                <Chip 
                  label={sessionState.status.toUpperCase()} 
                  size="small" 
                  color={getStatusColor(sessionState.status) as any}
                  sx={{ fontWeight: 'bold' }}
                />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">Connected Peers</Typography>
                <Typography variant="h6" color="primary">{sessionState.connectedPeers.length}</Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">Local Peer ID</Typography>
                <Typography variant="caption" sx={{ wordBreak: 'break-all', opacity: 0.7 }}>
                  {sessionState.localPeerId || 'Not initialized'}
                </Typography>
              </Box>

              {sessionState.lastError && (
                <Box sx={{ mt: 2, p: 1.5, bgcolor: 'rgba(244, 67, 54, 0.1)', borderRadius: 2, border: '1px solid rgba(244, 67, 54, 0.2)' }}>
                  <Typography variant="caption" color="error">
                    <strong>Last Error:</strong> {sessionState.lastError}
                  </Typography>
                </Box>
              )}
            </Stack>
          </Paper>
        </Grid>

        {/* Capability Card */}
        <Grid sx={{ gridColumn: { xs: 'span 12', md: 'span 6' } }}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              height: '100%',
              bgcolor: (theme) => 
                theme.palette.mode === 'dark' 
                  ? 'rgba(14, 8, 28, 0.3)' 
                  : 'rgba(255, 255, 255, 0.35)',
              backdropFilter: 'blur(30px) saturate(190%)',
              WebkitBackdropFilter: 'blur(30px) saturate(190%)',
              border: (theme) => 
                theme.palette.mode === 'dark' 
                  ? '1px solid rgba(171, 110, 255, 0.2)' 
                  : '1px solid rgba(0, 0, 0, 0.08)',
              borderRadius: 4,
              boxShadow: (theme) => 
                theme.palette.mode === 'dark'
                  ? '0 8px 32px 0 rgba(0, 0, 0, 0.4)'
                  : '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
            }}
          >
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <SecurityIcon color="primary" />
                <Typography variant="h6">Protocol Capabilities</Typography>
              </Box>
              
              <List disablePadding>
                {plan.transports.map((t) => (
                  <ListItem key={t.transport} sx={{ px: 0, py: 0.5 }}>
                    <ListItemText 
                      primary={t.transport.charAt(0).toUpperCase() + t.transport.slice(1)} 
                      secondary={t.reason}
                      primaryTypographyProps={{ variant: 'body2', fontWeight: 'bold' }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                    <Chip 
                      label={t.status.toUpperCase()} 
                      size="small" 
                      variant="outlined" 
                      color={t.status === 'supported' || t.status === 'target' ? 'success' : 'default'}
                      sx={{ fontSize: '0.6rem', height: 20 }}
                    />
                  </ListItem>
                ))}
              </List>
            </Stack>
          </Paper>
        </Grid>

        {/* Active Peers Card */}
        <Grid sx={{ gridColumn: 'span 12' }}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              bgcolor: (theme) => 
                theme.palette.mode === 'dark' 
                  ? 'rgba(14, 8, 28, 0.3)' 
                  : 'rgba(255, 255, 255, 0.35)',
              backdropFilter: 'blur(30px) saturate(190%)',
              WebkitBackdropFilter: 'blur(30px) saturate(190%)',
              border: (theme) => 
                theme.palette.mode === 'dark' 
                  ? '1px solid rgba(171, 110, 255, 0.2)' 
                  : '1px solid rgba(0, 0, 0, 0.08)',
              borderRadius: 4,
              boxShadow: (theme) => 
                theme.palette.mode === 'dark'
                  ? '0 8px 32px 0 rgba(0, 0, 0, 0.4)'
                  : '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <HubIcon color="primary" />
              <Typography variant="h6">Active Mesh Connections</Typography>
            </Box>
            
            <Divider sx={{ mb: 2, opacity: 0.1 }} />

            {sessionState.connectedPeers.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                No active connections found. Connecting to network mesh...
              </Typography>
            ) : (
              <List>
                {sessionState.connectedPeers.map((peerId) => (
                  <ListItem key={peerId} divider>
                    <ListItemText 
                      primary={peerId} 
                      primaryTypographyProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
                    />
                    <Chip label="Direct WebRTC" size="small" variant="outlined" sx={{ ml: 2, fontSize: '0.7rem' }} />
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        {/* Runtime Notes */}
        <Grid sx={{ gridColumn: 'span 12' }}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              bgcolor: 'rgba(171, 110, 255, 0.05)',
              border: (theme) => 
                theme.palette.mode === 'dark' 
                  ? '1px solid rgba(171, 110, 255, 0.1)' 
                  : '1px solid rgba(142, 45, 226, 0.1)',
              borderRadius: 4,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
              <SpeedIcon color="primary" sx={{ fontSize: 20 }} />
              <Typography variant="subtitle2">Network Environment Notes</Typography>
            </Box>
            <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 1 }}>
              {plan.browserCaveat}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {plan.notes.map((note, idx) => (
                <Chip key={idx} label={note} size="small" variant="outlined" sx={{ mt: 1, fontSize: '0.65rem', height: 'auto', '& .MuiChip-label': { display: 'block', whiteSpace: 'normal', py: 0.5 } }} />
              ))}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
