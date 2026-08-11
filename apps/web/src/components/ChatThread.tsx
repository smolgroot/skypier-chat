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
          bgcolor: (theme) => (theme.palette.mode === 'light' ? '#e2e2e2' : '#090611'),
          backgroundImage: (theme) =>
            theme.palette.mode === 'light' || theme.palette.mode === 'dark'
              ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 304 304\' width=\'304\' height=\'304\'%3E%3Cpath fill=\'%23ffffff\' fill-opacity=\'0.4\' d=\'M44.1 224a5 5 0 1 1 0 2H0v-2h44.1zm160 48a5 5 0 1 1 0 2H82v-2h122.1zm57.8-46a5 5 0 1 1 0-2H304v2h-42.1zm0 16a5 5 0 1 1 0-2H304v2h-42.1zm6.2-114a5 5 0 1 1 0 2h-86.2a5 5 0 1 1 0-2h86.2zm-256-48a5 5 0 1 1 0 2H0v-2h12.1zm185.8 34a5 5 0 1 1 0-2h86.2a5 5 0 1 1 0 2h-86.2zM258 12.1a5 5 0 1 1-2 0V0h2v12.1zm-64 208a5 5 0 1 1-2 0v-54.2a5 5 0 1 1 2 0v54.2zm48-198.2V80h62v2h-64V21.9a5 5 0 1 1 2 0zm16 16V64h46v2h-48V37.9a5 5 0 1 1 2 0zm-128 96V208h16v12.1a5 5 0 1 1-2 0V210h-16v-76.1a5 5 0 1 1 2 0zm-5.9-21.9a5 5 0 1 1 0 2H114v48H85.9a5 5 0 1 1 0-2H112v-48h12.1zm-6.2 130a5 5 0 1 1 0-2H176v-74.1a5 5 0 1 1 2 0V242h-60.1zm-16-64a5 5 0 1 1 0-2H114v48h10.1a5 5 0 1 1 0 2H112v-48h-10.1zM66 284.1a5 5 0 1 1-2 0V274H50v30h-2v-32h18v12.1zM236.1 176a5 5 0 1 1 0 2H226v94h48v32h-2v-30h-48v-98h12.1zm25.8-30a5 5 0 1 1 0-2H274v44.1a5 5 0 1 1-2 0V146h-10.1zm-64 96a5 5 0 1 1 0-2H208v-80h16v-14h-42.1a5 5 0 1 1 0-2H226v18h-16v80h-12.1zm86.2-210a5 5 0 1 1 0 2H272V0h2v32h10.1zM98 101.9V146H53.9a5 5 0 1 1 0-2H96v-42.1a5 5 0 1 1 2 0zM53.9 34a5 5 0 1 1 0-2H80V0h2v34H53.9zm60.1 3.9V66H82v64H69.9a5 5 0 1 1 0-2H80V64h32V37.9a5 5 0 1 1 2 0zM101.9 82a5 5 0 1 1 0-2H128V37.9a5 5 0 1 1 2 0V82h-28.1zm16-64a5 5 0 1 1 0-2H146v44.1a5 5 0 1 1-2 0V18h-26.1zm102.2 270a5 5 0 1 1 0 2H98v14h-2v-16h124.1zM242 149.9V160h16v34h-16v62h48v48h-2v-46h-48v-66h16v-30h-16v-12.1a5 5 0 1 1 2 0zM53.9 18a5 5 0 1 1 0-2H64V2H48V0h18v18H53.9zm112 32a5 5 0 1 1 0-2H192V0h50v2h-48v48h-28.1zm-48-48a5 5 0 0 1-9.8-2h2.07a3 3 0 1 0 5.66 0H178v34h-18V21.9a5 5 0 1 1 2 0V32h14V2h-58.1zm0 96a5 5 0 1 1 0-2H137l32-32h39V21.9a5 5 0 1 1 2 0V66h-40.17l-32 32H117.9zm28.1 90.1a5 5 0 1 1-2 0v-76.51L175.59 80H224V21.9a5 5 0 1 1 2 0V82h-49.59L146 112.41v75.69zm16 32a5 5 0 1 1-2 0v-99.51L184.59 96H300.1a5 5 0 0 1 3.9-3.9v2.07a3 3 0 0 0 0 5.66v2.07a5 5 0 0 1-3.9-3.9H185.41L162 121.41v98.69zm-144-64a5 5 0 1 1-2 0v-3.51l48-48V48h32V0h2v50H66v55.41l-48 48v2.69zM50 53.9v43.51l-48 48V208h26.1a5 5 0 1 1 0 2H0v-65.41l48-48V53.9a5 5 0 1 1 2 0zm-16 16V89.41l-34 34v-2.82l32-32V69.9a5 5 0 1 1 2 0zM12.1 32a5 5 0 1 1 0 2H9.41L0 43.41V40.6L8.59 32h3.51zm265.8 18a5 5 0 1 1 0-2h18.69l7.41-7.41v2.82L297.41 50H277.9zm-16 160a5 5 0 1 1 0-2H288v-71.41l16-16v2.82l-14 14V210h-28.1zm-208 32a5 5 0 1 1 0-2H64v-22.59L40.59 194H21.9a5 5 0 1 1 0-2H41.41L66 216.59V242H53.9zm150.2 14a5 5 0 1 1 0 2H96v-56.6L56.6 162H37.9a5 5 0 1 1 0-2h19.5L98 200.6V256h106.1zm-150.2 2a5 5 0 1 1 0-2H80v-46.59L48.59 178H21.9a5 5 0 1 1 0-2H49.41L82 208.59V258H53.9zM34 39.8v1.61L9.41 66H0v-2h8.59L32 40.59V0h2v39.8zM2 300.1a5 5 0 0 1 3.9 3.9H3.83A3 3 0 0 0 0 302.17V256h18v48h-2v-46H2v42.1zM34 241v63h-2v-62H0v-2h34v1zM17 18H0v-2h16V0h2v18h-1zm273-2h14v2h-16V0h2v16zm-32 273v15h-2v-14h-14v14h-2v-16h18v1zM0 92.1A5.02 5.02 0 0 1 6 97a5 5 0 0 1-6 4.9v-2.07a3 3 0 1 0 0-5.66V92.1zM80 272h2v32h-2v-32zm37.9 32h-2.07a3 3 0 0 0-5.66 0h-2.07a5 5 0 0 1 9.8 0zM5.9 0A5.02 5.02 0 0 1 0 5.9V3.83A3 3 0 0 0 3.83 0H5.9zm294.2 0h2.07A3 3 0 0 0 304 3.83V5.9a5 5 0 0 1-3.9-5.9zm3.9 300.1v2.07a3 3 0 0 0-1.83 1.83h-2.07a5 5 0 0 1 3.9-3.9zM97 100a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-48 32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32 48a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16-64a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 96a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-144a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-96 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm96 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16-64a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-32 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM49 36a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-32 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM33 68a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-48a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 240a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16-64a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm80-176a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32 48a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm112 176a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 180a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 84a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32 64a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z\'%3E%3C/path%3E%3C/svg%3E")'
              : 'none',
          backgroundRepeat: 'repeat',
          backgroundBlendMode: (theme) => (theme.palette.mode === 'dark' ? 'soft-light' : 'normal')
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
