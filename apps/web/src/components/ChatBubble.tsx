import { useState } from 'react';
import { Box, Paper, Typography, Badge, IconButton, Modal, Fade } from '@mui/material';
import { styled } from '@mui/material/styles';
import { reachabilityLabel } from '@skypier/network';
import type { ChatMessage } from '@skypier/protocol';
import { useDrag } from '@use-gesture/react';
import { animated, useSpring } from '@react-spring/web';
import ReplyIcon from '@mui/icons-material/Reply';
import CloseIcon from '@mui/icons-material/Close';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import { LinkPreviewCard } from './LinkPreviewCard';
import { extractFirstUrl } from '../hooks/useLinkPreview';

const BubbleContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isSelf',
})<{ isSelf?: boolean }>(({ theme, isSelf }) => ({
  display: 'flex',
  justifyContent: isSelf ? 'flex-end' : 'flex-start',
  padding: theme.spacing(0.5, 2),
  width: '100%',
  position: 'relative',
  alignItems: 'center',
  '&:hover .bubble-actions': {
    opacity: 1,
  }
}));

const BubbleActions = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isSelf',
})<{ isSelf?: boolean }>(({ theme, isSelf }) => ({
  display: 'flex',
  alignItems: 'center',
  opacity: 0,
  transition: 'opacity 0.2s',
  padding: theme.spacing(0, 1),
  order: isSelf ? -1 : 1, // Show before bubble if self, after bubble if not self
}));

const ReplyIndicator = styled(Box)({
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  display: 'flex',
  alignItems: 'center',
  paddingLeft: '20px',
});

const StyledBubble = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'isSelf',
})<{ isSelf?: boolean }>(({ theme, isSelf }) => ({
  padding: theme.spacing(1.2, 2),
  maxWidth: '100%',
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
  onRetryMessage?: (messageId: string) => void;
}

function deliveryIndicator(delivery: ChatMessage['delivery']): { label: string; color: string } {
  switch (delivery) {
    case 'delivered':
    case 'read':
      return { label: '✓✓', color: 'rgba(76,175,80,0.9)' };
    case 'sent':
      return { label: '✓', color: 'inherit' };
    case 'queued':
      return { label: '⏳', color: 'rgba(255,152,0,0.8)' };
    case 'local-only':
    default:
      return { label: '⊘', color: 'rgba(244,67,54,0.8)' };
  }
}

const EMOJI_REGEX = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})(\uFE0F|\u20E3|\uFE0F\u20E3)?([\u200D](\p{Emoji_Presentation}|\p{Extended_Pictographic})(\uFE0F|\u20E3)?)*$/u;

function isEmojiOnly(text: string): boolean {
  // Strip all emoji (including ZWJ sequences) and whitespace; if nothing remains it's emoji-only
  const stripped = text.replace(
    /(\p{Emoji_Presentation}|\p{Extended_Pictographic})[\uFE0F\u20E3]?(\u200D(\p{Emoji_Presentation}|\p{Extended_Pictographic})[\uFE0F\u20E3]?)*/gu,
    ''
  ).trim();
  return text.trim().length > 0 && stripped.length === 0;
}

export function ChatBubble({ message, isSelf, onReplySelect, onToggleReaction, onRetryMessage }: ChatBubbleProps) {
  const [{ x }, api] = useSpring(() => ({ x: 0 }));
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const bind = useDrag(({ down, movement: [mx], cancel, active }) => {
    if (!onReplySelect) return;

    // Only allow right-swipe
    if (mx < 0) mx = 0;

    if (active && mx > 80) {
      cancel();
      onReplySelect(message);
      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }
    
    api.start({ x: down ? mx : 0, immediate: down });
  }, {
    axis: 'x',
    from: () => [x.get(), 0],
    rubberband: true,
    pointer: { touch: true },
  });

  return (
    <BubbleContainer isSelf={isSelf}>
      {!isSelf && onReplySelect && (
        <ReplyIndicator>
          <ReplyIcon sx={{ opacity: 0.5 }} />
        </ReplyIndicator>
      )}
      <animated.div {...(isSelf ? {} : bind())} style={{ x, touchAction: 'pan-y', display: 'flex', maxWidth: '60%' }}>
        {isEmojiOnly(message.previewText) ? (
          // ── Sticker layout ──────────────────────────────────────────────
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: isSelf ? 'flex-end' : 'flex-start' }}>
            {!isSelf && (
              <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'secondary.main', mb: 0.25 }}>
                {message.senderDisplayName}
              </Typography>
            )}
            <Typography
              sx={{
                fontSize: '3.5rem',
                lineHeight: 1.15,
                userSelect: 'none',
                filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.25))',
                transition: 'transform 0.15s ease',
                '&:hover': { transform: 'scale(1.12)' },
              }}
            >
              {message.previewText}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
              <Typography variant="caption" sx={{ opacity: 0.5, fontSize: '0.7rem' }}>
                {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Typography>
              {isSelf && (() => {
                const { label, color } = deliveryIndicator(message.delivery);
                return (
                  <Typography variant="caption" sx={{ color, fontSize: '0.7rem', fontWeight: 600 }}>
                    {label}
                  </Typography>
                );
              })()}
            </Box>
            {message.reactions.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {message.reactions.map((reaction) => (
                  <Box
                    key={reaction.emoji}
                    onClick={() => onToggleReaction?.(message.id, reaction.emoji)}
                    sx={{
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(171, 110, 255, 0.15)' : 'rgba(142, 45, 226, 0.1)',
                      color: (theme) => theme.palette.mode === 'dark' ? '#d4b3ff' : '#8e2de2',
                      borderRadius: '12px',
                      px: 0.8, py: 0.2,
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
          </Box>
        ) : (
          // ── Normal bubble layout ─────────────────────────────────────────
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

            {message.attachments?.[0] && (
              <Box
                component="img"
                src={message.attachments[0].dataUri}
                alt="Photo"
                onClick={() => setLightboxSrc(message.attachments![0].dataUri)}
                sx={{
                  display: 'block',
                  width: '100%',
                  maxWidth: 280,
                  borderRadius: 1.5,
                  mb: message.previewText !== '📷 Photo' ? 1 : 0.5,
                  cursor: 'zoom-in',
                }}
              />
            )}
            {(!message.attachments?.length || message.previewText !== '📷 Photo') && (
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {message.previewText}
              </Typography>
            )}

            {/* Link preview — only when the message contains a URL */}
            {extractFirstUrl(message.previewText) && (
              <LinkPreviewCard text={message.previewText} isSelf={isSelf} />
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, mt: 0.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.7rem' }}>
                {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Typography>
              {isSelf && (() => {
                const { label, color } = deliveryIndicator(message.delivery);
                const isFailed = message.delivery === 'local-only';
                return (
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" sx={{ color, fontSize: '0.7rem', fontWeight: 600 }}>
                      {label}
                    </Typography>
                    {isFailed && onRetryMessage && (
                      <Typography
                        variant="caption"
                        onClick={() => onRetryMessage(message.id)}
                        sx={{
                          color: 'error.main',
                          fontSize: '0.65rem',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          '&:hover': { opacity: 0.8 },
                        }}
                      >
                        Retry
                      </Typography>
                    )}
                  </Box>
                );
              })()}
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
        )}
      </animated.div>
      {onReplySelect && (
        <BubbleActions className="bubble-actions" isSelf={isSelf}>
          <IconButton
            size="small"
            onClick={() => onReplySelect(message)}
            title="Reply"
            sx={{
              color: 'text.secondary',
              '&:hover': { color: 'primary.main', bgcolor: 'rgba(0,0,0,0.05)' }
            }}
          >
            <ReplyIcon fontSize="small" />
          </IconButton>
        </BubbleActions>
      )}

      {/* ── Fullscreen image lightbox ─────────────────────────────── */}
      <Modal
        open={lightboxSrc !== null}
        onClose={() => setLightboxSrc(null)}
        closeAfterTransition
        slotProps={{ backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.88)' } } }}
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Fade in={lightboxSrc !== null}>
          <Box
            sx={{
              position: 'relative',
              outline: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {/* Close button */}
            <IconButton
              onClick={() => setLightboxSrc(null)}
              size="large"
              sx={{
                position: 'absolute',
                top: -56,
                right: -8,
                color: 'white',
                bgcolor: 'rgba(0,0,0,0.45)',
                backdropFilter: 'blur(6px)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.72)' },
              }}
            >
              <CloseIcon />
            </IconButton>

            {/* Full-size image */}
            <Box
              component="img"
              src={lightboxSrc ?? ''}
              alt="Full size photo"
              sx={{
                maxWidth: '90vw',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: 2,
                boxShadow: '0 8px 48px rgba(0,0,0,0.85)',
                display: 'block',
              }}
            />

            {/* Save button */}
            <IconButton
              onClick={() => {
                const a = document.createElement('a');
                a.href = lightboxSrc!;
                a.download = 'skypier-photo.jpg';
                a.click();
              }}
              sx={{
                color: 'white',
                bgcolor: 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(6px)',
                borderRadius: 6,
                px: 3,
                py: 1,
                gap: 1,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.24)' },
              }}
            >
              <SaveAltIcon />
              <Typography variant="button" sx={{ color: 'white', ml: 0.5 }}>
                Save
              </Typography>
            </IconButton>
          </Box>
        </Fade>
      </Modal>
    </BubbleContainer>
  );
}
