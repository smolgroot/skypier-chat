import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CallEndIcon from '@mui/icons-material/CallEnd';
import CallIcon from '@mui/icons-material/Call';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { ActiveAudioCall } from '../hooks/useAudioCall';

interface AudioCallDrawerProps {
  call: ActiveAudioCall | null;
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
}

function phaseLabel(call: ActiveAudioCall): string {
  switch (call.phase) {
    case 'incoming':
      return 'Incoming audio call';
    case 'requesting-media':
      return 'Waiting for microphone';
    case 'connecting':
      return 'Opening libp2p audio path';
    case 'ringing':
      return call.direction === 'incoming' ? 'Ringing' : 'Calling…';
    case 'connected':
      return 'Connected';
    case 'ended':
      return call.endedReason === 'busy' ? 'Peer is busy' : 'Call ended';
    case 'error':
      return 'Call failed';
    default:
      return 'Audio call';
  }
}

function phaseMessage(call: ActiveAudioCall): string {
  switch (call.phase) {
    case 'incoming':
      return 'Answer over the existing libp2p route and start secure voice. You will hear earcon feedback during the call lifecycle.';
    case 'requesting-media':
      return 'Skypier needs microphone access before it can continue.';
    case 'connecting':
      return 'Negotiating the relay-backed call control channel with audio earcon feedback.';
    case 'ringing':
      return call.direction === 'incoming'
        ? 'The remote peer is still ringing. Listen for incoming earcon tone.'
        : 'Waiting for the remote peer to answer. Earcon tones play during setup.';
    case 'connected':
      return call.remoteMuted
        ? 'The remote microphone is muted. Earcons confirm mute state changes.'
        : 'Opus audio is flowing over the dedicated libp2p call stream with earcon feedback.';
    case 'ended':
      return call.endedReason === 'busy'
        ? 'The remote peer is already on another call.'
        : 'You can dismiss this panel or place another call.';
    case 'error':
      return call.error ?? 'Something prevented the call from starting.';
    default:
      return 'Preparing audio call controls with earcon feedback.';
  }
}

function startedAtLabel(call: ActiveAudioCall): string | null {
  if (!call.startedAt) {
    return null;
  }

  return new Date(call.startedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function AudioCallDrawer(props: AudioCallDrawerProps) {
  const { call, open, onClose, onAccept, onReject, onEnd, onToggleMute } = props;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  if (!call) {
    return null;
  }

  const showIncomingActions = call.direction === 'incoming' && call.phase === 'incoming';
  const showActiveActions = ['requesting-media', 'connecting', 'ringing', 'connected'].includes(call.phase);

  return (
    <Drawer
      anchor={isMobile ? 'bottom' : 'right'}
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: isMobile ? '100%' : 420,
          maxWidth: '100%',
          borderTopLeftRadius: isMobile ? 24 : 0,
          borderTopRightRadius: isMobile ? 24 : 0,
          bgcolor: (currentTheme) =>
            currentTheme.palette.mode === 'dark'
              ? 'rgba(10, 5, 20, 0.3)'
              : 'rgba(255,255,255,0.72)',
          backdropFilter: (currentTheme) => `blur(24px) saturate(180%) url(#liquid-glass-refraction-${currentTheme.palette.mode})`,
          WebkitBackdropFilter: (currentTheme) => `blur(24px) saturate(180%) url(#liquid-glass-refraction-${currentTheme.palette.mode})`,
          filter: (currentTheme) => `url(#liquid-glass-gloss-${currentTheme.palette.mode})`,
          borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,0.16)',
          borderTop: isMobile ? '1px solid rgba(255,255,255,0.16)' : 'none',
        },
      }}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Stack direction="row" alignItems="flex-start" spacing={1.5}>
          <IconButton
            onClick={onClose}
            aria-label={isMobile ? 'Back' : 'Close audio call controls'}
            sx={{
              mt: 0.25,
              bgcolor: (currentTheme) => currentTheme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.48)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            {isMobile ? <ArrowBackIcon /> : <CloseIcon />}
          </IconButton>

          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              Audio call
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }} noWrap>
              {call.remoteDisplayName}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {phaseMessage(call)}
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip icon={<PhoneInTalkIcon />} label={phaseLabel(call)} color={call.phase === 'connected' ? 'success' : 'default'} variant="outlined" />
          <Chip icon={call.isMuted ? <MicOffIcon /> : <MicIcon />} label={call.isMuted ? 'Muted' : 'Mic live'} variant="outlined" />
          {call.remoteMuted ? <Chip icon={<MicOffIcon />} label="Remote muted" color="warning" variant="outlined" /> : null}
          {startedAtLabel(call) ? <Chip label={`Started ${startedAtLabel(call)}`} variant="outlined" /> : null}
        </Stack>

        <Box
          sx={{
            borderRadius: 3,
            p: 2,
            bgcolor: (currentTheme) => currentTheme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.5)',
            border: '1px solid rgba(255,255,255,0.14)',
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
            Call path
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Call control and live audio both travel over libp2p now, using a dedicated call stream that works with your relay-backed path when peers are reachable.
          </Typography>
        </Box>

        <Divider />

        {showIncomingActions ? (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <Button fullWidth variant="contained" startIcon={<CallIcon />} onClick={onAccept}>
              Answer
            </Button>
            <Button fullWidth variant="outlined" color="error" startIcon={<CallEndIcon />} onClick={onReject}>
              Decline
            </Button>
          </Stack>
        ) : null}

        {showActiveActions ? (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <Button
              fullWidth
              variant={call.isMuted ? 'contained' : 'outlined'}
              startIcon={call.isMuted ? <MicOffIcon /> : <MicIcon />}
              onClick={onToggleMute}
            >
              {call.isMuted ? 'Unmute' : 'Mute'}
            </Button>
            <Button fullWidth variant="contained" color="error" startIcon={<CallEndIcon />} onClick={onEnd}>
              End call
            </Button>
          </Stack>
        ) : null}

        {!showIncomingActions && !showActiveActions ? (
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        ) : null}
      </Box>
    </Drawer>
  );
}
