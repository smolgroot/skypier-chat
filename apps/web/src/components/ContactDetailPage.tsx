import { Box, Button, Stack, Typography } from '@mui/material';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import ChatIcon from '@mui/icons-material/Chat';
import type { Conversation } from '@skypier/protocol';
import { reachabilityLabel, type DialLogEntry } from '@skypier/network';
import { UserAvatar } from './UserAvatar';

const PLACEHOLDER_LOCAL_PEER_ID = '12D3KooWLocalPeer';

function isPlaceholderLocalPeerId(peerId: string | undefined): boolean {
  if (!peerId) return true;
  return peerId === PLACEHOLDER_LOCAL_PEER_ID || peerId.includes('LocalPeer');
}

interface ContactDetailPageProps {
  conversation: Conversation;
  localPeerId: string;
  isDialing: boolean;
  dialError?: string;
  dialSuccess?: string;
  dialLogs?: DialLogEntry[];
  onDialPeer: (peerId: string) => void;
  onOpenChat: () => void;
}

export function ContactDetailPage(props: ContactDetailPageProps) {
  const { conversation, localPeerId, isDialing, dialError, dialSuccess, dialLogs = [], onDialPeer, onOpenChat } = props;

  const remoteParticipant = conversation.participants.find(
    (participant) => participant.peerId !== localPeerId && !isPlaceholderLocalPeerId(participant.peerId),
  ) ?? conversation.participants.find((participant) => participant.peerId !== localPeerId);

  if (!remoteParticipant) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography variant="h5">Contact not found</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 4, sm: 4 }, pt: { xs: 8, sm: 2 }, maxWidth: 600, mx: 'auto', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Drawer Handle */}
      <Box sx={{ 
        width: 40, 
        height: 4, 
        bgcolor: 'rgba(128, 128, 128, 0.3)', 
        borderRadius: 2, 
        mb: 4 
      }} />

      <Stack spacing={3} alignItems="center" sx={{ width: '100%' }}>
        <UserAvatar seed={remoteParticipant.peerId} size={100} sx={{ boxShadow: (theme: import('@mui/material').Theme) => `0 8px 32px ${theme.palette.primary.main}44` }} />
        
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>{remoteParticipant.displayName}</Typography>
          <Typography variant="body2" color="primary" sx={{ fontWeight: '500' }}>
            {reachabilityLabel(conversation.reachability)}
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all', textAlign: 'center', opacity: 0.7, maxWidth: 300 }}>
          {remoteParticipant.peerId}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2, width: '100%' }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<SatelliteAltIcon />}
            onClick={() => onDialPeer(remoteParticipant.peerId)}
            disabled={isDialing}
            size="large"
            sx={{ borderRadius: 3 }}
          >
            {isDialing ? 'Dialing…' : 'Test connectivity'}
          </Button>
          <Button 
            fullWidth 
            variant="outlined" 
            startIcon={<ChatIcon />} 
            onClick={onOpenChat}
            size="large"
            sx={{ borderRadius: 3 }}
          >
            Send message
          </Button>
        </Stack>

        {dialError ? <Typography color="error" variant="caption" sx={{ mt: 1 }}>{dialError}</Typography> : null}
        {dialSuccess ? <Typography color="success.main" variant="caption" sx={{ mt: 1 }}>{dialSuccess}</Typography> : null}

        {/* Dial Logs Section */}
        {(isDialing || dialLogs.length > 0) && (
          <Box sx={{ 
            width: '100%', 
            mt: 3, 
            p: 2, 
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.05)',
            borderRadius: 3,
            maxHeight: 180,
            overflowY: 'auto',
            border: '1px solid rgba(128,128,128,0.1)'
          }}>
            <Typography variant="overline" sx={{ opacity: 0.6, display: 'block', mb: 1, lineHeight: 1 }}>
              P2P Dial Diagnostics
            </Typography>
            <Stack spacing={0.5}>
              {dialLogs.map((log, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Box sx={{ 
                    width: 6, 
                    height: 6, 
                    borderRadius: '50%', 
                    flexShrink: 0,
                    bgcolor: log.level === 'error' ? 'error.main' 
                           : log.level === 'warn' ? 'warning.main' 
                           : log.level === 'success' ? 'success.main' 
                           : 'primary.main'
                  }} />
                  <Typography variant="caption" sx={{ 
                    fontFamily: 'SF Mono, monospace', 
                    fontSize: '0.65rem',
                    color: log.level === 'error' ? 'error.light' : 'text.primary',
                    opacity: log.level === 'info' ? 0.7 : 1
                  }}>
                    {log.message}
                  </Typography>
                </Box>
              ))}
              {isDialing && (
                <Typography variant="caption" sx={{ fontStyle: 'italic', opacity: 0.5 }}>
                  Working...
                </Typography>
              )}
              {dialLogs.length === 0 && isDialing && (
                <Typography variant="caption" sx={{ opacity: 0.5 }}>
                  Initializing P2P stack...
                </Typography>
              )}
            </Stack>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
