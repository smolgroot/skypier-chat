import React from 'react';
import { Box, Typography, Paper, Grid, Chip, List, ListItem, ListItemText, Divider, Stack, Button, Tooltip, IconButton } from '@mui/material';
import SignalWifi4BarIcon from '@mui/icons-material/SignalWifi4Bar';
import HubIcon from '@mui/icons-material/Hub';
import SpeedIcon from '@mui/icons-material/Speed';
import SecurityIcon from '@mui/icons-material/Security';
import RouterIcon from '@mui/icons-material/Router';
import ArticleIcon from '@mui/icons-material/Article';
import BugReportIcon from '@mui/icons-material/BugReport';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { BrowserLiveSessionState, NetworkDebugSnapshot } from '@skypier/network';
import { createRuntimePlan } from '@skypier/network';
import type { NetworkLogEntry } from '../useNetworkLog';
import { NetworkGraph } from './NetworkGraph';

interface NetworkStatusPageProps {
  sessionState: BrowserLiveSessionState;
  networkLog?: NetworkLogEntry[];
  getDebugInfo?: () => NetworkDebugSnapshot | null;
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
          : 'rgba(255, 255, 255, 0.2)',
      backdropFilter: (theme: any) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
      WebkitBackdropFilter: (theme: any) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
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

export function NetworkStatusPage({ sessionState, networkLog = [], getDebugInfo }: NetworkStatusPageProps) {
  const logEndRef = React.useRef<HTMLDivElement>(null);
  const [debugSnapshot, setDebugSnapshot] = React.useState<NetworkDebugSnapshot | null>(null);
  const [copied, setCopied] = React.useState(false);

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

        {/* Capability Card
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
        </Grid> */}

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

        {/* Connection Details / Debug Panel */}
        <Grid sx={{ gridColumn: 'span 12' }}>
          <GlassPaper>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <BugReportIcon color="primary" />
              <Typography variant="h6">Connection Details</Typography>
              <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
                {debugSnapshot && (
                  <Tooltip title={copied ? 'Copied!' : 'Copy debug JSON'}>
                    <IconButton
                      size="small"
                      onClick={() => {
                        void navigator.clipboard.writeText(JSON.stringify(debugSnapshot, null, 2));
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      <ContentCopyIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setDebugSnapshot(getDebugInfo?.() ?? null)}
                  sx={{ fontSize: '0.7rem', textTransform: 'none' }}
                >
                  Refresh
                </Button>
              </Box>
            </Box>

            <Divider sx={{ mb: 2, opacity: 0.1 }} />

            {!debugSnapshot ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                Press Refresh to load connection details.
              </Typography>
            ) : (
              <Stack spacing={2}>
                {/* Relay & WebRTC status */}
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  <Chip
                    label={debugSnapshot.hasRelayReservation ? '✓ Relay reservation' : '✗ No relay reservation'}
                    size="small"
                    color={debugSnapshot.hasRelayReservation ? 'success' : 'error'}
                    sx={{ fontWeight: 'bold' }}
                  />
                  <Chip
                    label={debugSnapshot.hasWebRTCAddress ? '✓ WebRTC listener' : '✗ No WebRTC address'}
                    size="small"
                    color={debugSnapshot.hasWebRTCAddress ? 'success' : 'warning'}
                    sx={{ fontWeight: 'bold' }}
                  />
                  <Chip
                    label={`${debugSnapshot.totalConnections} connection(s)`}
                    size="small"
                    variant="outlined"
                  />
                  <Chip
                    label={`${debugSnapshot.directConnections} direct / ${debugSnapshot.relayedConnections} relayed`}
                    size="small"
                    variant="outlined"
                  />
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Configured relay targets
                  </Typography>
                  {debugSnapshot.configuredRelayAddresses.length > 0 ? (
                    <List disablePadding dense>
                      {debugSnapshot.configuredRelayAddresses.map((addr, idx) => (
                        <ListItem
                          key={`${addr}-${idx}`}
                          divider={idx < debugSnapshot.configuredRelayAddresses.length - 1}
                          sx={{ px: 0, py: 0.5 }}
                        >
                          <ListItemText
                            primary={
                              <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                {addr}
                              </Typography>
                            }
                          />
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      No explicit relay targets configured.
                    </Typography>
                  )}
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Active reservation addresses
                  </Typography>
                  {debugSnapshot.relayListenAddresses.length > 0 ? (
                    <List disablePadding dense>
                      {debugSnapshot.relayListenAddresses.map((addr, idx) => (
                        <ListItem
                          key={`${addr}-${idx}`}
                          divider={idx < debugSnapshot.relayListenAddresses.length - 1}
                          sx={{ px: 0, py: 0.5 }}
                        >
                          <ListItemText
                            primary={
                              <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                {addr}
                              </Typography>
                            }
                          />
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      Reservation not announced yet.
                    </Typography>
                  )}
                </Box>

                {/* Per-peer list */}
                {debugSnapshot.connections.length > 0 && (
                  <List disablePadding dense>
                    {debugSnapshot.connections.map((conn, idx) => (
                      <ListItem
                        key={`${conn.remotePeerId}-${idx}`}
                        divider={idx < debugSnapshot.connections.length - 1}
                        sx={{ px: 0, py: 0.75 }}
                      >
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>
                                {conn.remotePeerId.slice(0, 16)}…{conn.remotePeerId.slice(-8)}
                              </Typography>
                              <Chip
                                label={conn.transportType}
                                size="small"
                                variant="outlined"
                                color={
                                  conn.transportType === 'webrtc' ? 'primary'
                                  : conn.transportType === 'relay' ? 'warning'
                                  : conn.transportType === 'websocket' ? 'info'
                                  : 'default'
                                }
                                sx={{ fontSize: '0.6rem', height: 18 }}
                              />
                              <Chip
                                label={conn.direction}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: '0.6rem', height: 18 }}
                              />
                            </Box>
                          }
                          secondary={conn.remoteAddr}
                          secondaryTypographyProps={{ sx: { fontFamily: 'monospace', fontSize: '0.65rem', wordBreak: 'break-all', opacity: 0.6 } }}
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
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

        <Grid sx={{ gridColumn: 'span 12' }}>
          <GlassPaper>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <HubIcon color="primary" />
              <Typography variant="h6">Network Topology (Interactive)</Typography>
              <Chip 
                label={`${sessionState.connectedPeers.length} Peers`} 
                size="small" 
                variant="outlined" 
                sx={{ ml: 'auto', fontSize: '0.65rem' }} 
              />
            </Box>
            
            <Divider sx={{ mb: 3, opacity: 0.1 }} />

            {sessionState.connectedPeers.length === 0 ? (
              <Box sx={{ py: 8, textAlign: 'center', bgcolor: 'rgba(0,0,0,0.05)', borderRadius: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  No active connections found. Connecting to network mesh...
                </Typography>
              </Box>
            ) : (
              <NetworkGraph 
                localPeerId={sessionState.localPeerId || 'Me'} 
                connectedPeers={sessionState.connectedPeers} 
              />
            )}
            
            <Typography variant="caption" sx={{ mt: 2, display: 'block', opacity: 0.5, textAlign: 'center' }}>
              Drag nodes to explore the mesh. The center node represents your local Peer.
            </Typography>
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
