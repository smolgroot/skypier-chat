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
  padding: theme.spacing(1.2, 2),
  maxWidth: '75%',
  position: 'relative',
  borderRadius: isSelf ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
  background: isSelf 
    ? (theme.palette.mode === 'dark' 
        ? 'linear-gradient(135deg, rgba(142, 45, 226, 0.4), rgba(74, 0, 224, 0.4))' 
        : 'linear-gradient(135deg, #1f7cff, #42c6ff)')
    : (theme.palette.mode === 'dark' 
        ? 'rgba(30, 20, 50, 0.3)' 
        : '#ffffff'),
  color: isSelf ? '#fff' : theme.palette.text.primary,
  backdropFilter: theme.palette.mode === 'dark' 
    ? `blur(20px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`
    : 'none',
  WebkitBackdropFilter: theme.palette.mode === 'dark' 
    ? `blur(20px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`
    : 'none',
  filter: theme.palette.mode === 'dark'
    ? `url(#liquid-glass-gloss-${theme.palette.mode})`
    : 'none',
  border: (theme.palette.mode === 'dark' 
      ? '1px solid rgba(171, 110, 255, 0.2)' 
      : '1px solid rgba(0, 0, 0, 0.05)'),
  boxShadow: theme.palette.mode === 'dark'
    ? '0 4px 15px rgba(0,0,0,0.3)'
    : '0 4px 15px rgba(31, 38, 135, 0.07)',
  transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  '&:active': {
    transform: 'scale(0.98)',
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
