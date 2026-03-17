import { Box, Button, Stack, Typography } from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
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
    <Box sx={{ p: 4, maxWidth: 700, mx: 'auto', width: '100%' }}>
      <Box
        sx={{
          p: 3,
          borderRadius: 4,
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? 'rgba(14, 8, 28, 0.25)'
              : 'rgba(255, 255, 255, 0.3)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: (theme) =>
            theme.palette.mode === 'dark'
              ? '1px solid rgba(171, 110, 255, 0.15)'
              : '1px solid rgba(0, 0, 0, 0.05)',
        }}
      >
        <Stack spacing={2} alignItems="center">
          <UserAvatar seed={remoteParticipant.peerId} size={92} />
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>{remoteParticipant.displayName}</Typography>
          <Typography variant="body2" color="text.secondary">
            {reachabilityLabel(conversation.reachability)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all', textAlign: 'center' }}>
            {remoteParticipant.peerId}
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1, width: '100%' }}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<PhoneIcon />}
              onClick={() => onDialPeer(remoteParticipant.peerId)}
              disabled={isDialing}
            >
              {isDialing ? 'Dialing…' : 'Test peer dial'}
            </Button>
            <Button fullWidth variant="outlined" startIcon={<ChatIcon />} onClick={onOpenChat}>
              Open chat
            </Button>
          </Stack>

          {dialError ? <Typography color="error" variant="caption">{dialError}</Typography> : null}
          {dialSuccess ? <Typography color="success.main" variant="caption">{dialSuccess}</Typography> : null}
        </Stack>
      </Box>
    </Box>
  );
}
