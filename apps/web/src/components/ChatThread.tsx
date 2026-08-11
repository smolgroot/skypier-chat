import { Box, Typography, TextField, IconButton, Paper, Stack, useTheme, useMediaQuery, Popover, Badge, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Button, AvatarGroup, Drawer } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import CloseIcon from '@mui/icons-material/Close';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import CallIcon from '@mui/icons-material/Call';
import EditIcon from '@mui/icons-material/Edit';
import { useRef, useEffect, useState } from 'react';
import EmojiPicker, { Theme as EmojiTheme } from 'emoji-picker-react';
import type { ChatMessage, Conversation } from '@skypier/protocol';
import { reachabilityLabel, reachabilityColor } from '@skypier/network';
import { ChatBubble } from './ChatBubble';
import { UserAvatar } from './UserAvatar';
import { CameraCaptureDrawer } from './CameraCaptureDrawer';
import { useVibration } from '../hooks/useVibration';
import { patternBackgroundSx } from '../backgrounds';

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }

  return `${seconds}s`;
}

function callTimelineLabel(message: ChatMessage): string {
  const event = message.systemEvent;
  if (!event) {
    return message.previewText;
  }

  if (event.type === 'call-attempted') {
    return event.direction === 'incoming' ? 'Incoming call' : 'Outgoing call';
  }

  switch (event.endedReason) {
    case 'busy':
      return 'Call ended · busy';
    case 'declined':
      return 'Call ended · declined';
    case 'missed':
      return 'Missed call';
    case 'error':
      return 'Call ended · failed';
    case 'hangup':
    default:
      return 'Call ended';
  }
}

function callTimelineMeta(message: ChatMessage): string {
  const parts = [
    new Date(message.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  ];

  if (message.systemEvent?.durationMs != null && message.systemEvent.durationMs > 0) {
    parts.push(formatDuration(message.systemEvent.durationMs));
  }

  return parts.join(' · ');
}

interface ChatThreadProps {
  conversation: Conversation;
  localPeerId: string;
  remoteAvatarUrl?: string;
  avatarByPeerId?: Record<string, string | undefined>;
  messages: ChatMessage[];
  composerValue: string;
  replyTarget?: ChatMessage;
  currentUserDisplayName: string;
  onOpenContact: () => void;
  onComposerChange: (val: string) => void;
  onReplyClear: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onSendMessage: () => void;
  onRetryMessage?: (messageId: string) => void;
  onOpenRetryDetails?: () => void;
  onReplySelect?: (message: ChatMessage) => void;
  onSendImage?: (file: File) => void;
  onStartCall?: () => void;
  callButtonDisabled?: boolean;
  callStatusLabel?: string;
  onRenameGroup?: (newTitle: string) => void;
}

export function ChatThread(props: ChatThreadProps) {
  const {
    conversation,
    localPeerId,
    remoteAvatarUrl,
    avatarByPeerId = {},
    messages,
    composerValue,
    replyTarget,
    currentUserDisplayName,
    onOpenContact,
    onComposerChange,
    onReplyClear,
    onToggleReaction,
    onSendMessage,
    onRetryMessage,
    onOpenRetryDetails,
    onReplySelect,
    onSendImage,
    onStartCall,
    callButtonDisabled,
    callStatusLabel,
    onRenameGroup,
  } = props;

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { vibrate, patterns } = useVibration();

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);

  const [emojiAnchorEl, setEmojiAnchorEl] = useState<HTMLButtonElement | null>(null);
  const showEmojiPicker = Boolean(emojiAnchorEl);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [cameraDrawerOpen, setCameraDrawerOpen] = useState(false);

  const isGroupAdmin = Boolean(conversation.adminPeerId && conversation.adminPeerId === localPeerId);

  const handleOpenRename = () => {
    setRenameValue(conversation.title);
    setRenameDialogOpen(true);
  };

  const handleConfirmRename = () => {
    if (renameValue.trim()) {
      onRenameGroup?.(renameValue.trim());
    }
    setRenameDialogOpen(false);
  };
  const unsentCount = messages.filter((message) => ['sending', 'queued', 'local-only'].includes(message.delivery)).length;
  const remoteParticipant = conversation.participants.find((participant) => participant.peerId !== localPeerId)
    ?? conversation.participants[0];
  const groupParticipants = conversation.participants.filter((participant) => participant.peerId !== localPeerId);
  const isGroupConversation = conversation.kind === 'group' || groupParticipants.length > 1;
  const groupMembers = isGroupConversation ? conversation.participants : [];

  const handleEmojiClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setEmojiAnchorEl(event.currentTarget);
  };

  const handleEmojiClose = () => {
    setEmojiAnchorEl(null);
  };

  const handleOpenAttachSheet = () => {
    setAttachSheetOpen(true);
  };

  const handleCloseAttachSheet = () => {
    setAttachSheetOpen(false);
  };

  const handleChooseGallery = () => {
    setAttachSheetOpen(false);
    // Delay click until the sheet close transition starts, avoiding overlap.
    window.setTimeout(() => {
      fileInputRef.current?.click();
    }, 80);
  };

  const handleChooseCamera = () => {
    setAttachSheetOpen(false);
    setCameraDrawerOpen(true);
  };

  const onEmojiSelect = (emojiData: any) => {
    onComposerChange(composerValue + emojiData.emoji);
  };

  // We no longer need to force scroll to bottom on every message 
  // because flex-direction: column-reverse inherently pins to the bottom.
  // The Date separators and messages are naturally flow from bottom-up.
  useEffect(() => {
    // Left empty since column-reverse handles it
  }, [messages]);

  useEffect(() => {
    // Left empty since column-reverse handles it
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  useEffect(() => {
    if (!replyTarget) {
      return;
    }

    // Focus composer when a reply target is chosen so typing can start immediately.
    composerInputRef.current?.focus();
  }, [replyTarget?.id]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      vibrate(patterns.messageSent);
      onSendMessage();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* Header - Hidden on mobile because MainLayout handles it */}
      {!isMobile && (
        <Box sx={{
          p: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          bgcolor: 'background.paper',
          borderBottom: '1px solid rgba(0,0,0,0.1)',
          zIndex: 1
        }}>
          <IconButton onClick={onOpenContact} sx={{ p: 0 }} aria-label="Open contact details">
            <UserAvatar seed={remoteParticipant?.peerId ?? conversation.id} size={40} src={remoteAvatarUrl} isBot={remoteParticipant?.isBot} />
          </IconButton>
          <Box sx={{ flexGrow: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{conversation.title}</Typography>
              {!isGroupConversation && remoteParticipant?.isBot ? (
                <Chip size="small" label="Bot" color="info" variant="outlined" />
              ) : null}
              {isGroupConversation && isGroupAdmin && onRenameGroup ? (
                <IconButton size="small" onClick={handleOpenRename} aria-label="Rename group" sx={{ opacity: 0.6 }}>
                  <EditIcon sx={{ fontSize: 16 }} />
                </IconButton>
              ) : null}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {reachabilityColor(conversation.reachability) != null && (
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: reachabilityColor(conversation.reachability),
                    flexShrink: 0,
                    boxShadow: conversation.reachability === 'direct'
                      ? '0 0 6px rgba(76,175,80,0.7)'
                      : 'none',
                  }}
                />
              )}
              <Typography variant="caption" color="secondary.main">
                {reachabilityLabel(conversation.reachability)}
              </Typography>
              {isGroupConversation ? (
                <Chip
                  label={`${groupParticipants.length + 1} members`}
                  size="small"
                  variant="outlined"
                />
              ) : null}
              {callStatusLabel ? <Chip label={callStatusLabel} size="small" variant="outlined" /> : null}
            </Box>
            {isGroupConversation ? (
              <Stack direction="row" spacing={1} sx={{ mt: 0.75, alignItems: 'center' }}>
                <AvatarGroup max={6} sx={{ '& .MuiAvatar-root': { width: 28, height: 28, fontSize: 12 } }}>
                  {groupMembers.map((participant) => (
                    <UserAvatar
                      key={participant.peerId}
                      seed={participant.peerId}
                      size={28}
                      src={avatarByPeerId[participant.peerId]}
                      displayName={participant.displayName}
                      isBot={participant.isBot}
                      sx={{ border: `2px solid ${theme.palette.background.paper}` }}
                    />
                  ))}
                </AvatarGroup>
                <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.9 }}>
                  {groupMembers.slice(0, 3).map((participant) => participant.displayName).join(', ')}
                  {groupMembers.length > 3 ? ` +${groupMembers.length - 3}` : ''}
                </Typography>
              </Stack>
            ) : null}
          </Box>
          {isGroupConversation && !isGroupAdmin && conversation.adminPeerId ? (
            <Typography variant="caption" color="text.secondary" sx={{ px: 1, whiteSpace: 'nowrap', opacity: 0.7 }}>
              Admin: {conversation.participants.find((p) => p.peerId === conversation.adminPeerId)?.displayName ?? conversation.adminPeerId.slice(0, 10) + '…'}
            </Typography>
          ) : null}
          <IconButton onClick={onStartCall} aria-label="Start audio call" disabled={callButtonDisabled || !onStartCall}>
            <CallIcon />
          </IconButton>
          <IconButton onClick={onOpenRetryDetails} aria-label="Open delivery details">
            <Badge badgeContent={unsentCount} color="warning" invisible={unsentCount === 0}>
              <AutorenewIcon />
            </Badge>
          </IconButton>
        </Box>
      )}

      {/* Messages */}
      <Box
        ref={scrollRef}
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          px: 2,
          pb: 'calc(110px + env(safe-area-inset-bottom))',
          // On mobile, extend scroll area behind the glass AppBar
          pt: isMobile ? 'calc(env(safe-area-inset-top) + 80px)' : 2,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 0.25,
          ...patternBackgroundSx,
        }}
      >
        {messages.slice().reverse().map((msg, reversedIndex) => {
          const originalIndex = messages.length - 1 - reversedIndex;
          const showDate = originalIndex === 0 ||
            new Date(msg.createdAt).toDateString() !== new Date(messages[originalIndex - 1].createdAt).toDateString();

          return (
            <Box
              key={msg.id}
              sx={{
                display: 'flex',
                flexDirection: 'column-reverse',
              }}
            >
              {msg.systemEvent ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', my: 1.25 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                    <Chip
                      label={callTimelineLabel(msg)}
                      size="small"
                      variant="filled"
                      sx={{
                        bgcolor: (currentTheme) => currentTheme.palette.mode === 'dark'
                          ? 'rgba(171,110,255,0.18)'
                          : 'rgba(31,124,255,0.14)',
                        color: 'text.primary',
                        border: (currentTheme) => currentTheme.palette.mode === 'dark'
                          ? '1px solid rgba(171,110,255,0.22)'
                          : '1px solid rgba(31,124,255,0.16)',
                        backdropFilter: 'blur(8px)',
                        '& .MuiChip-label': { px: 1.25, fontWeight: 600 },
                      }}
                    />
                    <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                      {callTimelineMeta(msg)}
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <ChatBubble
                  message={msg}
                  isSelf={msg.senderDisplayName === currentUserDisplayName}
                  onReplySelect={onReplySelect}
                  onToggleReaction={onToggleReaction}
                  onRetryMessage={onRetryMessage}
                />
              )}
              {showDate && (
                <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                  <Paper sx={{ px: 2, py: 0.5, borderRadius: 4, bgcolor: 'rgba(0,0,0,0.2)', color: 'white' }}>
                    <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                      {new Date(msg.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric' })}
                    </Typography>
                  </Paper>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Composer */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          p: 2,
          pb: 'calc(env(safe-area-inset-bottom) + 12px)',
          bgcolor: (currentTheme) =>
            currentTheme.palette.mode === 'dark'
              ? 'rgba(14, 8, 28, 0.15)'
              : 'rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(15px) saturate(190%)',
          WebkitBackdropFilter: (currentTheme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${currentTheme.palette.mode})`,
          filter: (currentTheme) => `url(#liquid-glass-gloss-${currentTheme.palette.mode})`,
          borderTop: (currentTheme) =>
            currentTheme.palette.mode === 'dark'
              ? '1px solid rgba(171, 110, 255, 0.12)'
              : '1px solid rgba(0, 0, 0, 0.04)',
          boxShadow: (currentTheme) =>
            currentTheme.palette.mode === 'dark'
              ? '0 -8px 24px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.02)'
              : '0 -8px 24px rgba(31, 38, 135, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
        }}
      >
        {callStatusLabel ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
            <Chip label={callStatusLabel} size="small" color="primary" variant="outlined" />
          </Box>
        ) : null}
        {replyTarget && (
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1,
            mb: 1,
            borderLeft: '3px solid',
            borderColor: 'primary.main',
            bgcolor: 'rgba(0,0,0,0.05)',
            borderRadius: '0 4px 4px 0'
          }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                Replying to {replyTarget.senderDisplayName}
              </Typography>
              <Typography variant="body2" noWrap sx={{ opacity: 0.8 }}>
                {replyTarget.previewText}
              </Typography>
            </Box>
            <IconButton size="small" onClick={onReplyClear}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        )}

        <Paper
          elevation={0}
          sx={{
            display: 'flex',
            alignItems: 'center', // Changed from flex-end for better placeholder alignment
            p: '2px 8px',
            borderRadius: '8px', // Removed the 24px rounded corners
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(136, 175, 224, 0.1)'
          }}
        >
          <IconButton size="small" onClick={handleEmojiClick}>
            <EmojiEmotionsIcon color="action" />
          </IconButton>
          <Popover
            open={showEmojiPicker}
            anchorEl={emojiAnchorEl}
            onClose={handleEmojiClose}
            anchorOrigin={{
              vertical: 'top',
              horizontal: 'left',
            }}
            transformOrigin={{
              vertical: 'bottom',
              horizontal: 'left',
            }}
            PaperProps={{
              sx: {
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(10, 5, 20, 0.4)' : 'rgba(255, 255, 255, 0.4)',
                backdropFilter: (theme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
                WebkitBackdropFilter: (theme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
                filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
                borderRadius: '16px',
                border: (theme) => 
                  theme.palette.mode === 'dark' 
                    ? '1px solid rgba(171, 110, 255, 0.25)' 
                    : '1px solid rgba(0, 0, 0, 0.08)',
                mb: 1,
                // Make the internal EmojiPicker transparent so our glass background shows through
                '& .EmojiPickerReact': {
                  '--epr-bg-color': 'transparent',
                  '--epr-category-label-bg-color': 'transparent',
                  '--epr-search-input-bg-color': theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  border: 'none',
                }
              }
            }}
          >
            <EmojiPicker
              onEmojiClick={onEmojiSelect}
              theme={theme.palette.mode === 'dark' ? EmojiTheme.DARK : EmojiTheme.LIGHT}
              lazyLoadEmojis
            />
          </Popover>
          <IconButton size="small" onClick={handleOpenAttachSheet} disabled={!onSendImage} aria-label="Attach media">
            <AttachFileIcon color="action" />
          </IconButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onSendImage) {
                onSendImage(file);
                e.target.value = '';
              }
            }}
          />
          <TextField
            fullWidth
            inputRef={composerInputRef}
            placeholder="  Write a message..."
            value={composerValue}
            onChange={(e) => onComposerChange(e.target.value)}
            onKeyPress={handleKeyPress}
            variant="standard"
            InputProps={{
              disableUnderline: true,
              sx: {
                py: 0.5,
                px: 1,
                borderRadius: 0,
                fontSize: '0.95rem',
                '& .MuiInputBase-input::placeholder': {
                  opacity: 0.6
                }
              }
            }}
          />
          <IconButton
            disabled={!composerValue.trim()}
            onClick={() => {
              vibrate(patterns.messageSent);
              onSendMessage();
            }}
            sx={{
              mb: 0.5,
              color: 'primary.main',
              transform: composerValue.trim() ? 'scale(1.1)' : 'scale(1)',
              transition: 'transform 0.2s'
            }}
          >
            <SendIcon />
          </IconButton>
        </Paper>
      </Box>

      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename group</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Group name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { handleConfirmRename(); } }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleConfirmRename} disabled={!renameValue.trim()}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      <Drawer
        anchor="bottom"
        open={attachSheetOpen}
        onClose={handleCloseAttachSheet}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: 560,
            mx: 'auto',
            left: 0,
            right: 0,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            bgcolor: (currentTheme) =>
              currentTheme.palette.mode === 'dark'
                ? 'rgba(10, 5, 20, 0.6)'
                : 'rgba(255,255,255,0.88)',
            backdropFilter: (currentTheme) => `blur(22px) saturate(180%) url(#liquid-glass-refraction-${currentTheme.palette.mode})`,
            WebkitBackdropFilter: (currentTheme) => `blur(22px) saturate(180%) url(#liquid-glass-refraction-${currentTheme.palette.mode})`,
            filter: (currentTheme) => `url(#liquid-glass-gloss-${currentTheme.palette.mode})`,
            borderTop: (currentTheme) => currentTheme.palette.mode === 'dark'
              ? '1px solid rgba(171, 110, 255, 0.2)'
              : '1px solid rgba(0,0,0,0.08)',
            pb: 'env(safe-area-inset-bottom, 0px)',
          },
        }}
      >
        <Box sx={{ pt: 1.25, display: 'flex', justifyContent: 'center' }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'rgba(128,128,128,0.35)' }} />
        </Box>

        <Box sx={{ px: 2.5, pt: 1.25, pb: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.25 }}>
            Add photo
          </Typography>

          <Stack spacing={1}>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<CameraAltIcon />}
              onClick={handleChooseCamera}
              sx={{ justifyContent: 'flex-start', py: 1.1, borderRadius: 2.25 }}
            >
              Take photo
            </Button>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<PhotoLibraryIcon />}
              onClick={handleChooseGallery}
              sx={{ justifyContent: 'flex-start', py: 1.1, borderRadius: 2.25 }}
            >
              Choose from gallery
            </Button>
            <Button fullWidth color="inherit" onClick={handleCloseAttachSheet} sx={{ py: 1 }}>
              Cancel
            </Button>
          </Stack>
        </Box>
      </Drawer>

      <CameraCaptureDrawer
        open={cameraDrawerOpen}
        onClose={() => setCameraDrawerOpen(false)}
        onSendImage={(file) => {
          if (!onSendImage) {
            return;
          }

          vibrate(patterns.messageSent);
          onSendImage(file);
        }}
      />
    </Box>
  );
}
