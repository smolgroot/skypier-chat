import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import ScheduleSendIcon from '@mui/icons-material/ScheduleSend';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { ChatMessage } from '@skypier/protocol';
import type { BrowserLiveSessionState } from '@skypier/network';
import { useVibration } from '../hooks/useVibration';

interface MessageRetryDrawerProps {
  open: boolean;
  onClose: () => void;
  conversationTitle: string;
  messages: ChatMessage[];
  sessionState: BrowserLiveSessionState;
  onRetryMessage: (message: ChatMessage) => void;
}

function statusLabel(delivery: ChatMessage['delivery']): string {
  switch (delivery) {
    case 'sending':
      return 'Sending now';
    case 'queued':
      return 'Queued for auto retry';
    case 'local-only':
      return 'Stored locally';
    default:
      return delivery;
  }
}

function statusColor(delivery: ChatMessage['delivery']): 'warning' | 'error' | 'info' {
  switch (delivery) {
    case 'queued':
      return 'warning';
    case 'local-only':
      return 'error';
    case 'sending':
    default:
      return 'info';
  }
}

function statusReason(delivery: ChatMessage['delivery']): string {
  switch (delivery) {
    case 'queued':
      return 'The session queued this message and will retry automatically when a route becomes available.';
    case 'local-only':
      return 'This message never made it into a live transport path. Use Retry to attempt delivery again.';
    case 'sending':
    default:
      return 'The app is still trying the first live send attempt.';
  }
}

export function MessageRetryDrawer(props: MessageRetryDrawerProps) {
  const { open, onClose, conversationTitle, messages, sessionState, onRetryMessage } = props;
  const { vibrate, patterns } = useVibration();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const queuedCount = messages.filter((message) => message.delivery === 'queued').length;
  const localOnlyCount = messages.filter((message) => message.delivery === 'local-only').length;
  const sendingCount = messages.filter((message) => message.delivery === 'sending').length;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 420 },
          maxWidth: '100%',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? 'rgba(10, 5, 20, 0.22)'
              : 'rgba(255, 255, 255, 0.68)',
          backdropFilter: (theme) => `blur(18px) saturate(190%)`,
          WebkitBackdropFilter: (theme) => `blur(18px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
          filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
          borderLeft: (theme) => theme.palette.mode === 'dark'
            ? '1px solid rgba(171, 110, 255, 0.18)'
            : '1px solid rgba(255,255,255,0.55)',
          boxShadow: (theme) =>
            theme.palette.mode === 'dark'
              ? '0 12px 40px rgba(0,0,0,0.45)'
              : '0 12px 40px rgba(31, 38, 135, 0.12)',
        },
      }}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
        <Stack direction="row" alignItems="flex-start" spacing={1.5}>
          <IconButton
            onClick={onClose}
            aria-label={isMobile ? 'Back' : 'Close delivery details'}
            sx={{
              mt: 0.25,
              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)',
              border: '1px solid rgba(255,255,255,0.12)',
              '&:hover': {
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.7)',
              },
            }}
          >
            {isMobile ? <ArrowBackIcon /> : <CloseIcon />}
          </IconButton>

          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              Delivery details
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>
              {conversationTitle}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Review unsent messages and how the retry mechanism is currently behaving.
            </Typography>
          </Box>
        </Stack>

        {/* <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip icon={<ScheduleSendIcon />} label={`${sendingCount} sending`} size="small" variant="outlined" />
          <Chip icon={<AutorenewIcon />} label={`${queuedCount} queued`} size="small" color="warning" variant="outlined" />
          <Chip icon={<CloudOffIcon />} label={`${localOnlyCount} local-only`} size="small" color="error" variant="outlined" />
          <Chip label={`${sessionState.queuedOutgoing} total queued`} size="small" variant="outlined" />
        </Stack> */}

        {/* <Alert severity={sessionState.status === 'running' ? 'info' : 'warning'}>
          {sessionState.status === 'running'
            ? 'Automatic retries run while the live session is active. Queued messages will be retried in the background.'
            : 'The live session is not fully running. Automatic retries may be delayed until connectivity is restored.'}
        </Alert> */}

        {/* <Box
          sx={{
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.38)',
            borderRadius: 2,
            p: 2,
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Retry mechanism
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Queued messages already sit in the session retry loop. Local-only messages need a fresh manual retry to create a new live send attempt. If a retry still cannot reach the peer, the app keeps the message locally and updates its delivery state again.
          </Typography>
        </Box> */}

        <Divider />

        {messages.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No unsent messages in this chat.
            </Typography>
          </Box>
        ) : (
          <List sx={{ p: 0, overflowY: 'auto', flexGrow: 1 }}>
            {messages.map((message, index) => (
              <ListItem
                key={message.id}
                divider={index < messages.length - 1}
                alignItems="flex-start"
                sx={{ px: 0, py: 1.5 }}
                secondaryAction={
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      vibrate(patterns.retry);
                      onRetryMessage(message);
                    }}
                    disabled={message.delivery === 'sending'}
                  >
                    Retry
                  </Button>
                }
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ pr: 8, flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {message.previewText}
                      </Typography>
                      <Chip
                        label={statusLabel(message.delivery)}
                        size="small"
                        color={statusColor(message.delivery)}
                        variant="outlined"
                      />
                    </Stack>
                  }
                  secondary={
                    <Stack spacing={0.5} sx={{ mt: 0.75, pr: 8 }}>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(message.createdAt).toLocaleString()}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {statusReason(message.delivery)}
                      </Typography>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', opacity: 0.7 }}>
                        {message.id}
                      </Typography>
                    </Stack>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
        <Divider />

        <Stack direction="row" justifyContent="flex-end" sx={{ pt: 0.5 }}>
          <Button
            onClick={onClose}
            variant="contained"
            sx={{
              borderRadius: 999,
              minWidth: 110,
              boxShadow: 'none',
            }}
          >
            Done
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
