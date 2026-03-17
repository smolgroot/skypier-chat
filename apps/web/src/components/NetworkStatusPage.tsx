import React from 'react';
import { Box, Typography, Paper, Grid, Chip, List, ListItem, ListItemText, Divider, Stack } from '@mui/material';
import SignalWifi4BarIcon from '@mui/icons-material/SignalWifi4Bar';
import HubIcon from '@mui/icons-material/Hub';
import SpeedIcon from '@mui/icons-material/Speed';
import SecurityIcon from '@mui/icons-material/Security';
import RouterIcon from '@mui/icons-material/Router';
import ArticleIcon from '@mui/icons-material/Article';
import type { BrowserLiveSessionState } from '@skypier/network';
import { createRuntimePlan } from '@skypier/network';
import type { NetworkLogEntry } from '../useNetworkLog';

interface NetworkStatusPageProps {
  sessionState: BrowserLiveSessionState;
  networkLog?: NetworkLogEntry[];
}

const GlassPaper = ({ children, sx = {} }: { children: React.ReactNode, sx?: any }) => (
  <Paper
    elevation={0}
    sx={{
      p: 3,
      height: '100%',
      bgcolor: (theme: any) => 
        theme.palette.mode === 'dark' 
          ? 'rgba(14, 8, 28, 0.2)' 
          : 'rgba(255, 255, 255, 0.4)',
      backdropFilter: (theme: any) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
      WebkitBackdropFilter: (theme: any) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
      filter: (theme: any) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
      border: (theme: any) => 
        theme.palette.mode === 'dark' 
          ? '1px solid rgba(171, 110, 255, 0.2)' 
          : '1px solid rgba(0, 0, 0, 0.08)',
      borderRadius: 4,
      boxShadow: (theme: any) => 
        theme.palette.mode === 'dark'
          ? '0 8px 32px 0 rgba(0, 0, 0, 0.4)'
          : '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
      ...sx
    }}
  >
    {children}
  </Paper>
);

export function NetworkStatusPage({ sessionState, networkLog = [] }: NetworkStatusPageProps) {
  const logEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [networkLog.length]);
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
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1000, mx: 'auto', overflowY: 'auto', height: '100%', pb: 8 }}>
      <Typography variant="h4" sx={{ mb: 4, fontWeight: 'bold' }}>
        Network Status
      </Typography>

      <Grid container spacing={3}>
        {/* Connection Status Card */}
        <Grid sx={{ gridColumn: { xs: 'span 12', md: 'span 6' } }}>
          <GlassPaper>
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

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="body2" color="text.secondary">Local Peer ID</Typography>
                <Typography variant="caption" sx={{ wordBreak: 'break-all', opacity: 0.7, fontFamily: 'monospace' }}>
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
          </GlassPaper>
        </Grid>

        {/* Capability Card */}
        <Grid sx={{ gridColumn: { xs: 'span 12', md: 'span 6' } }}>
          <GlassPaper>
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
                      secondaryTypographyProps={{ variant: 'caption', sx: { wordBreak: 'break-word' } }}
                    />
                    <Chip 
                      label={t.status.toUpperCase()} 
                      size="small" 
                      variant="outlined" 
                      color={t.status === 'supported' || t.status === 'target' ? 'success' : 'default'}
                      sx={{ fontSize: '0.6rem', height: 20, ml: 1 }}
                    />
                  </ListItem>
                ))}
              </List>
            </Stack>
          </GlassPaper>
        </Grid>

        {/* Listen Multiaddresses Card */}
        <Grid sx={{ gridColumn: 'span 12' }}>
          <GlassPaper>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <RouterIcon color="primary" />
              <Typography variant="h6">Listen Multiaddresses</Typography>
            </Box>

            <Divider sx={{ mb: 2, opacity: 0.1 }} />

            {sessionState.listenAddresses.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                No listen addresses available. Node may not be started yet.
              </Typography>
            ) : (
              <List disablePadding>
                {sessionState.listenAddresses.map((addr, idx) => (
                  <ListItem key={idx} divider={idx < sessionState.listenAddresses.length - 1} sx={{ px: 0, py: 1 }}>
                    <ListItemText
                      primary={addr}
                      primaryTypographyProps={{ sx: { fontFamily: 'monospace', fontSize: '0.78rem', wordBreak: 'break-all' } }}
                    />
                    <Chip
                      label={
                        addr.includes('/webrtc') ? 'WebRTC'
                        : addr.includes('/p2p-circuit') ? 'Relay'
                        : addr.includes('/ws') ? 'WebSocket'
                        : 'Other'
                      }
                      size="small"
                      variant="outlined"
                      color={addr.includes('/webrtc') ? 'primary' : addr.includes('/p2p-circuit') ? 'warning' : 'default'}
                      sx={{ fontSize: '0.65rem', height: 20, ml: 1, flexShrink: 0 }}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </GlassPaper>
        </Grid>

        {/* Registered Protocols Card */}
        <Grid sx={{ gridColumn: 'span 12' }}>
          <GlassPaper>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <ArticleIcon color="primary" />
              <Typography variant="h6">Registered Protocols</Typography>
            </Box>

            <Divider sx={{ mb: 2, opacity: 0.1 }} />

            {sessionState.protocols.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                No protocols registered yet.
              </Typography>
            ) : (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {sessionState.protocols.map((proto) => (
                  <Chip
                    key={proto}
                    label={proto}
                    size="small"
                    variant="outlined"
                    color={proto.startsWith('/skypier') ? 'primary' : 'default'}
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.7rem',
                      height: 'auto',
                      '& .MuiChip-label': { display: 'block', whiteSpace: 'normal', py: 0.5 },
                    }}
                  />
                ))}
              </Stack>
            )}
          </GlassPaper>
        </Grid>

        {/* Live Log Panel */}
        <Grid sx={{ gridColumn: 'span 12' }}>
          <GlassPaper>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <ArticleIcon color="primary" />
              <Typography variant="h6">Live Network Log</Typography>
              <Chip
                label={`${networkLog.length} entries`}
                size="small"
                variant="outlined"
                sx={{ ml: 'auto', fontSize: '0.65rem', height: 20 }}
              />
            </Box>

            <Divider sx={{ mb: 1, opacity: 0.1 }} />

            <Box
              sx={{
                maxHeight: 360,
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: '0.72rem',
                lineHeight: 1.7,
                bgcolor: (theme: any) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(0,0,0,0.35)'
                    : 'rgba(0,0,0,0.03)',
                borderRadius: 2,
                p: 1.5,
              }}
            >
              {networkLog.length === 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 3, textAlign: 'center' }}>
                  No log entries yet. Start the session to see network activity.
                </Typography>
              ) : (
                networkLog.map((entry) => (
                  <Box
                    key={entry.id}
                    sx={{
                      display: 'flex',
                      gap: 1,
                      py: 0.25,
                      color:
                        entry.level === 'error'
                          ? '#f44336'
                          : entry.level === 'warn'
                            ? '#ff9800'
                            : 'text.secondary',
                    }}
                  >
                    <Box
                      component="span"
                      sx={{ flexShrink: 0, opacity: 0.5, minWidth: 85 }}
                    >
                      {entry.timestamp.slice(11, 23)}
                    </Box>
                    <Box
                      component="span"
                      sx={{ flexShrink: 0, minWidth: 36, fontWeight: 'bold', textTransform: 'uppercase' }}
                    >
                      {entry.level === 'log' ? 'INF' : entry.level === 'warn' ? 'WRN' : 'ERR'}
                    </Box>
                    <Box component="span" sx={{ wordBreak: 'break-all' }}>
                      {entry.message}
                    </Box>
                  </Box>
                ))
              )}
              <div ref={logEndRef} />
            </Box>
          </GlassPaper>
        </Grid>

        {/* Active Peers Card */}
        <Grid sx={{ gridColumn: 'span 12' }}>
          <GlassPaper>
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
                  <ListItem key={peerId} divider sx={{ px: 0, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1 }}>
                    <ListItemText 
                      primary={peerId} 
                      primaryTypographyProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' } }}
                    />
                    <Chip label="Direct WebRTC" size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                  </ListItem>
                ))}
              </List>
            )}
          </GlassPaper>
        </Grid>

        {/* Runtime Notes
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
        </Grid> */}
      </Grid>
    </Box>
  );
}
