import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Box, Paper, Typography, Badge, IconButton, Modal, Fade, CircularProgress } from '@mui/material';
import { styled, useTheme } from '@mui/material/styles';
import { reachabilityLabel } from '@skypier/network';
import type { ChatMessage } from '@skypier/protocol';
import { loadAttachmentBlob } from '@skypier/storage';
import { useDrag } from '@use-gesture/react';
import { animated, useSpring } from '@react-spring/web';
import ReplyIcon from '@mui/icons-material/Reply';
import CloseIcon from '@mui/icons-material/Close';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import { LinkPreviewCard } from './LinkPreviewCard';
import { extractFirstUrl } from '../hooks/useLinkPreview';

const TRANSPARENT_PIXEL_DATA_URI = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function LazyAttachmentImage(props: {
  dataUri: string;
  width?: number;
  height?: number;
  onOpen: () => void;
}) {
  const { dataUri, width, height, onOpen } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    const node = containerRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        setIsNearViewport(first?.isIntersecting ?? false);
      },
      {
        root: null,
        rootMargin: '300px 0px',
        threshold: 0.01,
      },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  const ratioPadding = width && height ? `${Math.max(8, (height / width) * 100)}%` : '72%';
  const src = isNearViewport ? dataUri : TRANSPARENT_PIXEL_DATA_URI;

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        maxWidth: 280,
        position: 'relative',
        borderRadius: 1.5,
        overflow: 'hidden',
        mb: 0.5,
        bgcolor: 'rgba(0,0,0,0.12)',
      }}
    >
      <Box sx={{ width: '100%', pt: ratioPadding }} />
      <Box
        component="img"
        src={src}
        alt="Photo"
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        onClick={() => {
          if (isNearViewport) {
            onOpen();
          }
        }}
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          cursor: isNearViewport ? 'zoom-in' : 'default',
          opacity: isNearViewport ? 1 : 0.2,
          transition: 'opacity 0.2s ease',
        }}
      />
    </Box>
  );
}

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
        ? 'linear-gradient(135deg, #8e2de2, #4a00e0)' 
        : 'linear-gradient(135deg, #1f7cff, #42c6ff)')
    : (theme.palette.mode === 'dark' 
        ? '#1e1432' 
        : '#ffffff'),
  color: isSelf ? '#fff' : theme.palette.text.primary,
  backdropFilter: 'none',
  WebkitBackdropFilter: 'none',
  filter: 'none',
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

const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const DOUBLE_TAP_REACTION = '👍';
const DOUBLE_TAP_WINDOW_MS = 320;

function deliveryIndicator(
  delivery: ChatMessage['delivery'],
  options?: { useHighContrastDeliveredColor?: boolean },
): { label: string; color: string } {
  const deliveredColor = options?.useHighContrastDeliveredColor
    ? 'rgba(255,255,255,0.95)'
    : 'rgba(76,175,80,0.9)';

  switch (delivery) {
    case 'sending':
      return { label: '···', color: 'rgba(255,255,255,0.4)' };
    case 'delivered':
    case 'read':
      return { label: '✓✓', color: deliveredColor };
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
  const theme = useTheme();
  const [{ x }, api] = useSpring(() => ({ x: 0 }));
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxLoading, setLightboxLoading] = useState(false);
  const lightboxObjectUrlRef = useRef<string | null>(null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const lastTapAtRef = useRef(0);

  useEffect(() => {
    return () => {
      if (lightboxObjectUrlRef.current) {
        URL.revokeObjectURL(lightboxObjectUrlRef.current);
        lightboxObjectUrlRef.current = null;
      }
    };
  }, []);

  const closeLightbox = () => {
    setLightboxSrc(null);
    setLightboxLoading(false);
    if (lightboxObjectUrlRef.current) {
      URL.revokeObjectURL(lightboxObjectUrlRef.current);
      lightboxObjectUrlRef.current = null;
    }
  };

  const openLightbox = async () => {
    const attachment = message.attachments?.[0];
    if (!attachment) {
      return;
    }

    setLightboxLoading(true);
    try {
      if (attachment.storageKey) {
        const blob = await loadAttachmentBlob(attachment.storageKey);
        if (blob) {
          const objectUrl = URL.createObjectURL(blob);
          if (lightboxObjectUrlRef.current) {
            URL.revokeObjectURL(lightboxObjectUrlRef.current);
          }
          lightboxObjectUrlRef.current = objectUrl;
          setLightboxSrc(objectUrl);
          return;
        }
      }

      setLightboxSrc(attachment.dataUri);
    } finally {
      setLightboxLoading(false);
    }
  };

  const handleBubblePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!onToggleReaction || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('button,a,input,textarea,img,[role="button"],[data-skip-double-tap="true"]')) {
      return;
    }

    const now = Date.now();
    if (now - lastTapAtRef.current <= DOUBLE_TAP_WINDOW_MS) {
      lastTapAtRef.current = 0;
      onToggleReaction(message.id, DOUBLE_TAP_REACTION);
      return;
    }

    lastTapAtRef.current = now;
  };

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
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: isSelf ? 'flex-end' : 'flex-start' }}>
        {showReactionPicker && onToggleReaction && (
          <Paper
            elevation={2}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.25,
              px: 0.5,
              py: 0.3,
              mb: 0.5,
              borderRadius: 999,
            }}
          >
            {QUICK_REACTION_EMOJIS.map((emoji) => (
              <IconButton
                key={emoji}
                size="small"
                onClick={() => {
                  onToggleReaction(message.id, emoji);
                  setShowReactionPicker(false);
                }}
                sx={{ fontSize: '1.05rem', width: 30, height: 30 }}
              >
                <span>{emoji}</span>
              </IconButton>
            ))}
          </Paper>
        )}
        {isEmojiOnly(message.previewText) ? (
          // ── Sticker layout ──────────────────────────────────────────────
          <Box onPointerUp={handleBubblePointerUp}>
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
                const isSending = message.delivery === 'sending';
                const { label, color } = deliveryIndicator(message.delivery, {
                  useHighContrastDeliveredColor: isSelf && theme.palette.mode === 'light',
                });
                return isSending
                  ? <CircularProgress size={10} thickness={5} sx={{ color: 'rgba(255,255,255,0.45)' }} />
                  : <Typography variant="caption" sx={{ color, fontSize: '0.7rem', fontWeight: 600 }}>{label}</Typography>;
              })()}
            </Box>
            {message.reactions.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {message.reactions.map((reaction) => (
                  <Box
                    key={reaction.emoji}
                    data-skip-double-tap="true"
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
          <StyledBubble isSelf={isSelf} elevation={1} onPointerUp={handleBubblePointerUp}>
            {!isSelf && (
              <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'secondary.main', display: 'block', mb: 0.5 }}>
                {message.senderDisplayName}
              </Typography>
            )}

            {message.replyTo && (
              <ReplyBox data-skip-double-tap="true" onClick={() => {/* Scroll to reply logic could be here */}}>
                <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                  {message.replyTo.authorDisplayName}
                </Typography>
                <Typography variant="body2" noWrap sx={{ opacity: 0.8 }}>
                  {message.replyTo.excerpt}
                </Typography>
              </ReplyBox>
            )}

            {message.attachments?.[0] && (
              <LazyAttachmentImage
                dataUri={message.attachments[0].dataUri}
                width={message.attachments[0].width}
                height={message.attachments[0].height}
                onOpen={() => {
                  void openLightbox();
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
                const isSending = message.delivery === 'sending';
                const { label, color } = deliveryIndicator(message.delivery, {
                  useHighContrastDeliveredColor: isSelf && theme.palette.mode === 'light',
                });
                const isFailed = message.delivery === 'local-only';
                return (
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {isSending
                      ? <CircularProgress size={10} thickness={5} sx={{ color: 'rgba(255,255,255,0.45)' }} />
                      : <Typography variant="caption" sx={{ color, fontSize: '0.7rem', fontWeight: 600 }}>{label}</Typography>
                    }
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
                    data-skip-double-tap="true"
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
        </Box>
      </animated.div>
      {(onReplySelect || onToggleReaction) && (
        <BubbleActions className="bubble-actions" isSelf={isSelf}>
          {onToggleReaction && (
            <IconButton
              size="small"
              onClick={() => setShowReactionPicker((current) => !current)}
              title="React"
              sx={{
                color: 'text.secondary',
                '&:hover': { color: 'primary.main', bgcolor: 'rgba(0,0,0,0.05)' }
              }}
            >
              <EmojiEmotionsIcon fontSize="small" />
            </IconButton>
          )}
          {onReplySelect && (
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
          )}
        </BubbleActions>
      )}

      {/* ── Fullscreen image lightbox ─────────────────────────────── */}
      <Modal
        open={lightboxSrc !== null || lightboxLoading}
        onClose={closeLightbox}
        closeAfterTransition
        slotProps={{ backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.88)' } } }}
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Fade in={lightboxSrc !== null || lightboxLoading}>
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
              onClick={closeLightbox}
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
            {lightboxLoading && (
              <CircularProgress size={28} sx={{ color: 'white' }} />
            )}
            {lightboxSrc && <Box
              component="img"
              src={lightboxSrc}
              alt="Full size photo"
              sx={{
                maxWidth: '90vw',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: 2,
                boxShadow: '0 8px 48px rgba(0,0,0,0.85)',
                display: 'block',
              }}
            />}

            {/* Save button */}
            <IconButton
              onClick={() => {
                if (!lightboxSrc) {
                  return;
                }
                const a = document.createElement('a');
                a.href = lightboxSrc;
                a.download = 'skypier-photo.jpg';
                a.click();
              }}
              disabled={!lightboxSrc}
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
