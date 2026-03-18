import { Box, Typography, Paper, Skeleton } from '@mui/material';
import LaunchIcon from '@mui/icons-material/Launch';
import type { LinkPreviewData } from '../hooks/useLinkPreview';
import { useLinkPreview } from '../hooks/useLinkPreview';

interface LinkPreviewCardProps {
  text: string;
  isSelf: boolean;
}

function PreviewContent({ preview, isSelf }: { preview: LinkPreviewData; isSelf: boolean }) {
  return (
    <Paper
      component="a"
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      elevation={0}
      sx={{
        display: 'block',
        mt: 1.5,
        borderRadius: '12px',
        overflow: 'hidden',
        textDecoration: 'none',
        cursor: 'pointer',
        maxWidth: 340,
        border: (theme) =>
          theme.palette.mode === 'dark'
            ? '1px solid rgba(171, 110, 255, 0.18)'
            : '1px solid rgba(0, 0, 0, 0.08)',
        bgcolor: (theme) =>
          theme.palette.mode === 'dark'
            ? 'rgba(255,255,255,0.04)'
            : 'rgba(0,0,0,0.03)',
        backdropFilter: 'blur(12px)',
        transition: 'transform 0.15s, box-shadow 0.15s',
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: (theme) =>
            theme.palette.mode === 'dark'
              ? '0 6px 24px rgba(0,0,0,0.5)'
              : '0 6px 24px rgba(0,0,0,0.12)',
        },
      }}
    >
      {/* Hero image */}
      {preview.image && (
        <Box
          component="img"
          src={preview.image}
          alt={preview.title ?? ''}
          sx={{
            width: '100%',
            height: 160,
            objectFit: 'cover',
            display: 'block',
            bgcolor: 'rgba(0,0,0,0.05)',
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      {/* Text content */}
      <Box sx={{ p: 1.5 }}>
        {/* Publisher row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          {preview.logo && (
            <Box
              component="img"
              src={preview.logo}
              alt=""
              sx={{ width: 14, height: 14, borderRadius: '2px', objectFit: 'contain', flexShrink: 0 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <Typography
            variant="caption"
            sx={{
              color: isSelf ? 'rgba(255,255,255,0.6)' : 'text.secondary',
              fontWeight: 500,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
              fontSize: '0.65rem',
            }}
          >
            {preview.publisher ?? preview.hostname}
          </Typography>
          <LaunchIcon sx={{ fontSize: 10, opacity: 0.4, ml: 'auto', flexShrink: 0 }} />
        </Box>

        {/* Title */}
        {preview.title && (
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              lineHeight: 1.3,
              mb: 0.5,
              color: isSelf ? '#fff' : 'text.primary',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {preview.title}
          </Typography>
        )}

        {/* Description */}
        {preview.description && (
          <Typography
            variant="caption"
            sx={{
              color: isSelf ? 'rgba(255,255,255,0.65)' : 'text.secondary',
              lineHeight: 1.4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {preview.description}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

export function LinkPreviewCard({ text, isSelf }: LinkPreviewCardProps) {
  const { preview, loading } = useLinkPreview(text);

  if (loading) {
    return (
      <Box sx={{ mt: 1.5, maxWidth: 340 }}>
        <Skeleton variant="rectangular" height={100} sx={{ borderRadius: '12px 12px 0 0' }} />
        <Skeleton variant="rectangular" height={60} sx={{ borderRadius: '0 0 12px 12px', mt: '1px' }} />
      </Box>
    );
  }

  if (!preview || (!preview.title && !preview.description && !preview.image)) {
    return null;
  }

  return <PreviewContent preview={preview} isSelf={isSelf} />;
}
