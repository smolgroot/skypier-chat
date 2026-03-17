import { Box, Typography, TextField, IconButton, Paper, Divider, Stack, useTheme, useMediaQuery } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import { useRef, useEffect } from 'react';
import type { ChatMessage, Conversation } from '@skypier/protocol';
import { reachabilityLabel, reachabilityColor } from '@skypier/network';
import { ChatBubble } from './ChatBubble';
import { UserAvatar } from './UserAvatar';

interface ChatThreadProps {
  conversation: Conversation;
  messages: ChatMessage[];
  composerValue: string;
  replyTarget?: ChatMessage;
  currentUserDisplayName: string;
  onOpenContact: () => void;
  onComposerChange: (val: string) => void;
  onReplyClear: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onSendMessage: () => void;
}

export function ChatThread(props: ChatThreadProps) {
  const {
    conversation,
    messages,
    composerValue,
    replyTarget,
    currentUserDisplayName,
    onOpenContact,
    onComposerChange,
    onReplyClear,
    onToggleReaction,
    onSendMessage,
  } = props;

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
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
            <UserAvatar seed={conversation.id} size={40} />
          </IconButton>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{conversation.title}</Typography>
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
            </Box>
          </Box>
        </Box>
      )}

      {/* Messages */}
      <Box
        ref={scrollRef}
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          px: 2,
          pb: 2,
          // On mobile, extend scroll area behind the glass AppBar
          pt: isMobile ? 'calc(env(safe-area-inset-top) + 80px)' : 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          bgcolor: 'transparent'
        }}
      >
        <Box sx={{ flexGrow: 1 }} /> {/* Push messages to bottom */}
        {messages.map((msg, index) => {
          const showDate = index === 0 ||
            new Date(msg.createdAt).toDateString() !== new Date(messages[index - 1].createdAt).toDateString();

          return (
            <Box key={msg.id}>
              {showDate && (
                <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                  <Paper sx={{ px: 2, py: 0.5, borderRadius: 4, bgcolor: 'rgba(0,0,0,0.2)', color: 'white' }}>
                    <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                      {new Date(msg.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric' })}
                    </Typography>
                  </Paper>
                </Box>
              )}
              <ChatBubble
                message={msg}
                isSelf={msg.senderDisplayName === currentUserDisplayName}
                onToggleReaction={onToggleReaction}
              />
            </Box>
          );
        })}
      </Box>

      {/* Composer */}
      <Box sx={{ p: 2, bgcolor: 'background.paper' }}>
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
          <IconButton size="small">
            <EmojiEmotionsIcon color="action" />
          </IconButton>
          <IconButton size="small">
            <AttachFileIcon color="action" />
          </IconButton>
          <TextField
            fullWidth
            multiline
            maxRows={10}
            placeholder="Write a message..."
            value={composerValue}
            onChange={(e) => onComposerChange(e.target.value)}
            onKeyPress={handleKeyPress}
            variant="standard"
            InputProps={{
              disableUnderline: true,
              sx: {
                py: 1.5,
                px: 1.5,
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
            onClick={onSendMessage}
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
    </Box>
  );
}
