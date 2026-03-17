import { Box, Paper, Typography, Badge, IconButton } from '@mui/material';
import { styled } from '@mui/material/styles';
import { reachabilityLabel } from '@skypier/network';
import type { ChatMessage } from '@skypier/protocol';

const BubbleContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isSelf',
})<{ isSelf?: boolean }>(({ theme, isSelf }) => ({
  display: 'flex',
  justifyContent: isSelf ? 'flex-end' : 'flex-start',
  padding: theme.spacing(0.5, 2),
  width: '100%',
}));

const StyledBubble = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'isSelf',
})<{ isSelf?: boolean }>(({ theme, isSelf }) => ({
  padding: theme.spacing(1, 1.5),
  maxWidth: '70%',
  position: 'relative',
  borderRadius: isSelf ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
  background: isSelf 
    ? (theme.palette.mode === 'dark' 
        ? 'linear-gradient(135deg, #8e2de2, #4a00e0)' 
        : theme.palette.primary.main)
    : (theme.palette.mode === 'dark' 
        ? '#1a1325' 
        : '#ffffff'),
  color: isSelf && theme.palette.mode === 'light' ? '#fff' : theme.palette.text.primary,
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  '&::after': {
    content: '""',
    position: 'absolute',
    bottom: 0,
    width: 0,
    height: 0,
    border: '10px solid transparent',
    ...(isSelf 
      ? {
          right: -10,
          borderLeftColor: theme.palette.mode === 'dark' ? '#4a00e0' : theme.palette.primary.main,
          borderBottom: 0,
        }
      : {
          left: -10,
          borderRightColor: theme.palette.mode === 'dark' ? '#1a1325' : '#ffffff',
          borderBottom: 0,
        })
  }
}));

const ReplyBox = styled(Box)(({ theme }) => ({
  borderLeft: `3px solid ${theme.palette.secondary.main}`,
  padding: theme.spacing(0.5, 1),
  marginBottom: theme.spacing(0.5),
  backgroundColor: 'rgba(0, 0, 0, 0.05)',
  borderRadius: '4px',
  cursor: 'pointer',
}));

interface ChatBubbleProps {
  message: ChatMessage;
  isSelf: boolean;
  onReplySelect?: (message: ChatMessage) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
}

export function ChatBubble({ message, isSelf, onReplySelect, onToggleReaction }: ChatBubbleProps) {
  
  return (
    <BubbleContainer isSelf={isSelf}>
      <StyledBubble isSelf={isSelf} elevation={1}>
        {!isSelf && (
          <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'secondary.main', display: 'block', mb: 0.5 }}>
            {message.senderDisplayName}
          </Typography>
        )}
        
        {message.replyTo && (
          <ReplyBox onClick={() => {/* Scroll to reply logic could be here */}}>
            <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
              {message.replyTo.authorDisplayName}
            </Typography>
            <Typography variant="body2" noWrap sx={{ opacity: 0.8 }}>
              {message.replyTo.excerpt}
            </Typography>
          </ReplyBox>
        )}

        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {message.previewText}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, mt: 0.5 }}>
          <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.7rem' }}>
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Typography>
          {isSelf && (
             <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.7rem' }}>
              {message.delivery === 'delivered' ? '✓✓' : '✓'}
            </Typography>
          )}
        </Box>

        {message.reactions.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            {message.reactions.map((reaction) => (
              <Box
                key={reaction.emoji}
                onClick={() => onToggleReaction?.(message.id, reaction.emoji)}
                sx={{
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(171, 110, 255, 0.15)' : 'rgba(142, 45, 226, 0.1)',
                  color: (theme) => theme.palette.mode === 'dark' ? '#d4b3ff' : '#8e2de2',
                  borderRadius: '12px',
                  px: 0.8,
                  py: 0.2,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'rgba(66, 198, 255, 0.24)' }
                }}
              >
                {reaction.emoji} {reaction.authors.length}
              </Box>
            ))}
          </Box>
        )}
      </StyledBubble>
    </BubbleContainer>
  );
}
