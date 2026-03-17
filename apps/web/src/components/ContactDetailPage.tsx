import { Box, Button, Stack, Typography } from '@mui/material';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import ChatIcon from '@mui/icons-material/Chat';
import type { Conversation } from '@skypier/protocol';
import { reachabilityLabel } from '@skypier/network';
import { UserAvatar } from './UserAvatar';

interface ContactDetailPageProps {
  conversation: Conversation;
  localPeerId: string;
  isDialing: boolean;
  dialError?: string;
  dialSuccess?: string;
  onDialPeer: (peerId: string) => void;
  onOpenChat: () => void;
}

export function ContactDetailPage(props: ContactDetailPageProps) {
  const { conversation, localPeerId, isDialing, dialError, dialSuccess, onDialPeer, onOpenChat } = props;

  const remoteParticipant = conversation.participants.find((participant) => participant.peerId !== localPeerId);

  if (!remoteParticipant) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography variant="h5">Contact not found</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 4, pt: 2, maxWidth: 600, mx: 'auto', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
      </Stack>
    </Box>
  );
}
