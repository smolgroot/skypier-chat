import { AvatarGroup, Box, Button, Stack, Typography } from '@mui/material';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import ChatIcon from '@mui/icons-material/Chat';
// import CallIcon from '@mui/icons-material/Call';
import type { Conversation } from '@skypier/protocol';
import { reachabilityLabel, type DialLogEntry } from '@skypier/network';
import { UserAvatar } from './UserAvatar';

const PLACEHOLDER_LOCAL_PEER_ID = '12D3KooWLocalPeer';

function isPlaceholderLocalPeerId(peerId: string | undefined): boolean {
  if (!peerId) return true;
  return peerId === PLACEHOLDER_LOCAL_PEER_ID || peerId.includes('LocalPeer');
}

function formatPeerIdShort(peerId: string): string {
  const trimmed = peerId.trim();
  if (trimmed.length <= 27) {
    return trimmed;
  }
  return `${trimmed.slice(0, 12)}...${trimmed.slice(-12)}`;
}

interface ContactDetailPageProps {
  conversation: Conversation;
  localPeerId: string;
  avatarByPeerId?: Record<string, string | undefined>;
  isDialing: boolean;
  isProfileDebugBusy?: boolean;
  profileDebugMessage?: string;
  profileDebugError?: string;
  dialError?: string;
  dialSuccess?: string;
  dialLogs?: DialLogEntry[];
  onDialPeer: (peerId: string) => void;
  onDebugFetchProfile?: (peerId: string) => void;
  onStartCall?: (peerId: string) => void;
  callDisabled?: boolean;
  callStatusLabel?: string;
  onOpenChat: () => void;
}

export function ContactDetailPage(props: ContactDetailPageProps) {
  const {
    conversation,
    localPeerId,
    avatarByPeerId = {},
    isDialing,
    isProfileDebugBusy,
    profileDebugMessage,
    profileDebugError,
    dialError,
    dialSuccess,
    dialLogs = [],
    onDialPeer,
    onDebugFetchProfile,
    onStartCall,
    callDisabled,
    callStatusLabel,
    onOpenChat,
  } = props;

  const remoteParticipant = conversation.participants.find(
    (participant) => participant.peerId !== localPeerId && !isPlaceholderLocalPeerId(participant.peerId),
  ) ?? conversation.participants.find((participant) => participant.peerId !== localPeerId);
  const remoteAvatarSrc = remoteParticipant?.peerId ? avatarByPeerId[remoteParticipant.peerId] : undefined;
  const isGroupConversation = conversation.kind === 'group' || conversation.participants.length > 2;
  const groupMembers = conversation.participants;

  if (!remoteParticipant) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography variant="h5">Contact not found</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 4, sm: 4 }, maxWidth: 600, mx: 'auto', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Drawer Handle */}
      <Box sx={{ 
        width: 40, 
        height: 4, 
        bgcolor: 'rgba(128, 128, 128, 0.3)', 
        borderRadius: 2, 
        mb: 4 
      }} />

      <Stack spacing={3} alignItems="center" sx={{ width: '100%' }}>
          <UserAvatar seed={remoteParticipant.peerId} size={100} src={remoteAvatarSrc} isBot={remoteParticipant.isBot} sx={{ boxShadow: (theme: import('@mui/material').Theme) => `0 8px 32px ${theme.palette.primary.main}44` }} />
        
        <Box sx={{ textAlign: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
              <Typography variant="h4" sx={{ fontWeight: 'bold' }}>{remoteParticipant.displayName}</Typography>
              {remoteParticipant.isBot ? (
                <Typography variant="caption" color="info.main" sx={{ fontWeight: 700, letterSpacing: '0.05em' }}>
                  BOT
                </Typography>
              ) : null}
            </Box>
          <Typography variant="body2" color="primary" sx={{ fontWeight: '500' }}>
            {reachabilityLabel(conversation.reachability)}
          </Typography>
          {callStatusLabel ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {callStatusLabel}
            </Typography>
          ) : null}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', opacity: 0.7, maxWidth: 300 }} title={remoteParticipant.peerId}>
          {formatPeerIdShort(remoteParticipant.peerId)}
        </Typography>

        {isGroupConversation ? (
          <Box sx={{ width: '100%', mt: 1 }}>
            <Typography variant="overline" sx={{ opacity: 0.65, letterSpacing: 0.8 }}>
              Group members
            </Typography>
            <Stack spacing={1.25} sx={{ mt: 1 }}>
              <AvatarGroup max={6} sx={{ justifyContent: 'flex-start', '& .MuiAvatar-root': { width: 34, height: 34 } }}>
                {groupMembers.map((participant) => (
                  <UserAvatar
                    key={participant.peerId}
                    seed={participant.peerId}
                    size={34}
                      src={avatarByPeerId[participant.peerId]}
                      isBot={participant.isBot}
                    sx={{ border: '1px solid rgba(255,255,255,0.2)' }}
                  />
                ))}
              </AvatarGroup>

              {groupMembers.map((participant) => (
                <Box
                  key={`member-${participant.peerId}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    p: 1,
                    borderRadius: 2,
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                  }}
                >
                  <UserAvatar
                    seed={participant.peerId}
                    size={30}
                      src={avatarByPeerId[participant.peerId]}
                      isBot={participant.isBot}
                  />
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {participant.displayName}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.7 }} noWrap title={participant.peerId}>
                      {formatPeerIdShort(participant.peerId)}
                    </Typography>
                  </Box>
                  {participant.peerId === conversation.adminPeerId ? (
                    <Typography variant="caption" color="primary" sx={{ fontWeight: 600 }}>
                      Admin
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Stack>
          </Box>
        ) : null}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2, width: '100%' }}>
          {/* <Button
            fullWidth
            variant="contained"
            startIcon={<CallIcon />}
            onClick={() => onStartCall?.(remoteParticipant.peerId)}
            disabled={callDisabled || !onStartCall}
            size="large"
            sx={{ borderRadius: 3 }}
          >
            Audio call
          </Button> */}
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
            onClick={() => onDebugFetchProfile?.(remoteParticipant.peerId)}
            disabled={isProfileDebugBusy || !onDebugFetchProfile}
            size="large"
            sx={{ borderRadius: 3 }}
          >
            {isProfileDebugBusy ? 'Fetching profile…' : 'Debug: fetch profile'}
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
        {profileDebugError ? <Typography color="error" variant="caption" sx={{ mt: 1 }}>{profileDebugError}</Typography> : null}
        {profileDebugMessage ? <Typography color="success.main" variant="caption" sx={{ mt: 1 }}>{profileDebugMessage}</Typography> : null}

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
