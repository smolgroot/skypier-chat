import {
  Box,
  Chip,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CallEndIcon from '@mui/icons-material/CallEnd';
import CallIcon from '@mui/icons-material/Call';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import type { ActiveAudioCall } from '../hooks/useAudioCall';
import { CallAudioMeter } from './CallAudioMeter';

interface AudioCallDrawerProps {
  call: ActiveAudioCall | null;
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  localStream?: MediaStream | null;
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

function startedAtLabel(call: ActiveAudioCall): string | null {
  if (!call.startedAt) {
    return null;
  }

  return new Date(call.startedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Large round call-action button, phone-app style
function CallActionButton({
  icon,
  label,
  onClick,
  color = 'default',
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: 'accept' | 'decline' | 'mute' | 'default';
  disabled?: boolean;
}) {
  const bgByColor = {
    accept: 'linear-gradient(135deg, #22c55e, #16a34a)',
    decline: 'linear-gradient(135deg, #ef4444, #b91c1c)',
    mute: 'rgba(255,255,255,0.14)',
    default: 'rgba(255,255,255,0.10)',
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75 }}>
      <IconButton
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        sx={{
          width: 68,
          height: 68,
          background: bgByColor[color],
          border: color === 'mute' || color === 'default' ? '1px solid rgba(255,255,255,0.18)' : 'none',
          boxShadow: (color === 'accept' || color === 'decline')
            ? '0 4px 20px rgba(0,0,0,0.35)'
            : '0 2px 8px rgba(0,0,0,0.2)',
          color: '#fff',
          transition: 'transform 0.12s, box-shadow 0.12s',
          '&:hover': {
            transform: 'scale(1.07)',
            boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
          },
          '&:active': { transform: 'scale(0.95)' },
          '& .MuiSvgIcon-root': { fontSize: 30 },
        }}
      >
        {icon}
      </IconButton>
      <Typography variant="caption" sx={{ opacity: 0.7, fontSize: '0.7rem' }}>
        {label}
      </Typography>
    </Box>
  );
}

export function AudioCallDrawer(props: AudioCallDrawerProps) {
  const { call, open, onClose, onAccept, onReject, onEnd, onToggleMute, localStream } = props;

  if (!call) {
    return null;
  }

  const showIncomingActions = call.direction === 'incoming' && call.phase === 'incoming';
  const showActiveActions = ['requesting-media', 'connecting', 'ringing', 'connected'].includes(call.phase);
  const showDone = !showIncomingActions && !showActiveActions;

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: '100%',
          maxWidth: 480,
          mx: 'auto',
          left: 0,
          right: 0,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          bgcolor: (currentTheme) =>
            currentTheme.palette.mode === 'dark'
              ? 'rgba(10, 5, 20, 0.55)'
              : 'rgba(255,255,255,0.80)',
          backdropFilter: (currentTheme) => `blur(28px) saturate(190%) url(#liquid-glass-refraction-${currentTheme.palette.mode})`,
          WebkitBackdropFilter: (currentTheme) => `blur(28px) saturate(190%) url(#liquid-glass-refraction-${currentTheme.palette.mode})`,
          filter: (currentTheme) => `url(#liquid-glass-gloss-${currentTheme.palette.mode})`,
          borderTop: (currentTheme) => currentTheme.palette.mode === 'dark'
            ? '1px solid rgba(171, 110, 255, 0.22)'
            : '1px solid rgba(0,0,0,0.07)',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.35)',
          pb: 'env(safe-area-inset-bottom, 0px)',
        },
      }}
    >
      {/* Drag handle */}
      <Box sx={{ pt: 1.5, display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'rgba(128,128,128,0.35)' }} />
      </Box>

      <Box sx={{ px: 3, pt: 2, pb: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        {/* Caller info */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {call.remoteDisplayName}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {phaseLabel(call)}
            {startedAtLabel(call) ? ` · ${startedAtLabel(call)}` : ''}
          </Typography>
        </Box>

        {/* Status chips */}
        <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" useFlexGap>
          <Chip icon={<PhoneInTalkIcon />} label={phaseLabel(call)} color={call.phase === 'connected' ? 'success' : 'default'} size="small" variant="outlined" />
          {call.isMuted ? <Chip icon={<MicOffIcon />} label="Muted" size="small" variant="outlined" /> : null}
          {call.remoteMuted ? <Chip icon={<MicOffIcon />} label="Remote muted" color="warning" size="small" variant="outlined" /> : null}
        </Stack>

        {/* Audio meter */}
        {call.phase === 'connected' ? (
          <CallAudioMeter
            stream={localStream ?? null}
            isMuted={call.isMuted}
            label="Mic"
            height={72}
          />
        ) : null}

        {/* Call action buttons */}
        {showIncomingActions ? (
          <Stack direction="row" spacing={5} justifyContent="center" sx={{ pt: 1 }}>
            <CallActionButton icon={<CallEndIcon />} label="Decline" color="decline" onClick={onReject} />
            <CallActionButton icon={<CallIcon />} label="Answer" color="accept" onClick={onAccept} />
          </Stack>
        ) : null}

        {showActiveActions ? (
          <Stack direction="row" spacing={4} justifyContent="center" sx={{ pt: 1 }}>
            <CallActionButton
              icon={call.isMuted ? <MicOffIcon /> : <MicIcon />}
              label={call.isMuted ? 'Unmute' : 'Mute'}
              color="mute"
              onClick={onToggleMute}
            />
            <CallActionButton icon={<CallEndIcon />} label="End call" color="decline" onClick={onEnd} />
          </Stack>
        ) : null}

        {showDone ? (
          <CallActionButton icon={<CallEndIcon />} label="Dismiss" color="decline" onClick={onClose} />
        ) : null}
      </Box>
    </Drawer>
  );
}

