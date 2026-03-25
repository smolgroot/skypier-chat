import { Box, Typography, useTheme } from '@mui/material';
import { useEffect, useRef } from 'react';

// One AudioContext + AnalyserNode per MediaStream so we never create duplicates
// when the component re-renders or re-mounts.
const streamAnalyserCache = new WeakMap<
  MediaStream,
  { audioCtx: AudioContext; analyser: AnalyserNode }
>();

function getOrCreateAnalyser(
  stream: MediaStream,
): { audioCtx: AudioContext; analyser: AnalyserNode } | null {
  const cached = streamAnalyserCache.get(stream);
  if (cached) {
    return cached;
  }

  try {
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024; // 512 frequency bins — fine enough for a nice waveform
    analyser.smoothingTimeConstant = 0.55;

    const source = audioCtx.createMediaStreamSource(stream);
    // Connect source → analyser only (no destination) so we don't echo local mic
    source.connect(analyser);

    const entry = { audioCtx, analyser };
    streamAnalyserCache.set(stream, entry);
    return entry;
  } catch {
    return null;
  }
}

interface CallAudioMeterProps {
  stream: MediaStream | null;
  isMuted: boolean;
  label?: string;
  /** Canvas height in CSS pixels, default 64 */
  height?: number;
}

/**
 * Audacity-style waveform meter drawn on a <canvas>.
 * Shows the time-domain signal of the supplied MediaStream using a filled
 * polygon above & below the centre line, matching Audacity's default track view.
 */
export function CallAudioMeter({
  stream,
  isMuted,
  label = 'Mic',
  height = 128,
}: CallAudioMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  // Keep isMuted accessible inside the rAF closure without re-running the effect
  const isMutedRef = useRef(isMuted);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Colours derived from the app theme
  const colors = {
    bg: isDark ? '#0c0816' : '#f0f4ff',
    centerLine: isDark ? '#1e1434' : '#c8d4f8',
    fill: isDark ? '#8e2de2cc' : '#1f7cffbb',      // semi-transparent wave fill
    fillMuted: isDark ? '#2e1e4a88' : '#b0c4ff66',
    line: isDark ? '#ab6eff' : '#1f7cff',           // wave outline
    lineMuted: isDark ? '#4a3368' : '#90aaee',
    rms: isDark ? '#c87affcc' : '#5ba3ffcc',        // brighter RMS overlay
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stream) {
      return;
    }

    const entry = getOrCreateAnalyser(stream);
    if (!entry) {
      return;
    }

    const { audioCtx, analyser } = entry;

    // Resume the AudioContext if it was suspended (autoplay policy)
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }

    const bufferLength = analyser.frequencyBinCount; // fftSize / 2 = 512
    const dataArray = new Uint8Array(bufferLength);

    let dpr = window.devicePixelRatio || 1;

    function resizeCanvas() {
      if (!canvas) return;
      dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    resizeCanvas();

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      if (!canvas) return;

      analyser.getByteTimeDomainData(dataArray);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      const mid = H / 2;
      const muted = isMutedRef.current;

      // ── Background ─────────────────────────────────────────────
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, W, H);

      // ── Grid lines (Audacity-style horizontal guides) ──────────
      ctx.strokeStyle = colors.centerLine;
      ctx.lineWidth = 1 * dpr;

      // centre
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(W, mid);
      ctx.stroke();

      // +50% / -50% guides
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(0, mid - H * 0.35);
      ctx.lineTo(W, mid - H * 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, mid + H * 0.35);
      ctx.lineTo(W, mid + H * 0.35);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // ── Waveform ────────────────────────────────────────────────
      // Build the waveform path once, reuse for fill and stroke.
      const sliceW = W / bufferLength;

      ctx.beginPath();
      for (let i = 0; i < bufferLength; i++) {
        // 128 = silence → maps to 0; 0 = −1 amplitude; 255 = +1 amplitude
        const normalised = (dataArray[i] - 128) / 128; // −1 … +1
        const y = mid - normalised * mid;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceW, y);
      }

      // Closed polygon: trace back along the centre line
      ctx.lineTo(W, mid);
      ctx.lineTo(0, mid);
      ctx.closePath();

      ctx.fillStyle = muted ? colors.fillMuted : colors.fill;
      ctx.fill();

      // Waveform outline (drawn open, no fill)
      ctx.beginPath();
      for (let i = 0; i < bufferLength; i++) {
        const normalised = (dataArray[i] - 128) / 128;
        const y = mid - normalised * mid;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceW, y);
      }
      ctx.strokeStyle = muted ? colors.lineMuted : colors.line;
      ctx.lineWidth = 1.5 * dpr;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // ── RMS power bar (right edge, like Audacity's gain strip) ─
      let sumSq = 0;
      for (let i = 0; i < bufferLength; i++) {
        const n = (dataArray[i] - 128) / 128;
        sumSq += n * n;
      }
      const rms = Math.sqrt(sumSq / bufferLength);
      const barH = Math.min(rms * H * 3.5, H); // scale up so it's visible
      const barW = 4 * dpr;

      ctx.fillStyle = muted ? colors.lineMuted : colors.rms;
      ctx.fillRect(W - barW - 2 * dpr, mid - barH / 2, barW, barH);
    }

    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
    };
  // Deliberately omit `colors` from deps — restarting the rAF loop on every
  // theme token change is unnecessary; colour updates take effect on next frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  const isActive = stream != null;

  return (
    <Box
      sx={{
        borderRadius: 2,
        overflow: 'hidden',
        border: (t) =>
          t.palette.mode === 'dark'
            ? '1px solid rgba(171,110,255,0.22)'
            : '1px solid rgba(31,124,255,0.18)',
        bgcolor: isDark ? '#0c0816' : '#f0f4ff',
        position: 'relative',
      }}
    >
      {/* Label strip — mimics Audacity's left-side track header */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.25,
          bgcolor: isDark ? 'rgba(10,5,20,0.75)' : 'rgba(255,255,255,0.7)',
          borderRight: isDark
            ? '1px solid rgba(171,110,255,0.18)'
            : '1px solid rgba(31,124,255,0.14)',
          zIndex: 1,
          userSelect: 'none',
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.6rem',
            fontWeight: 700,
            color: isMuted
              ? 'text.disabled'
              : isDark
              ? '#ab6eff'
              : '#1f7cff',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
          }}
        >
          {label}
        </Typography>
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: isMuted
              ? 'text.disabled'
              : isActive
              ? 'success.main'
              : 'text.disabled',
            boxShadow: !isMuted && isActive
              ? isDark
                ? '0 0 6px #4ade80'
                : '0 0 6px #22c55e'
              : 'none',
          }}
        />
      </Box>

      {/* Canvas — fills the width to the right of the label strip */}
      <Box sx={{ ml: '44px' }}>
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            height: `${height}px`,
          }}
        />
      </Box>

      {/* No-stream placeholder */}
      {!isActive && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            ml: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography variant="caption" color="text.disabled" sx={{ fontFamily: 'monospace' }}>
            no signal
          </Typography>
        </Box>
      )}
    </Box>
  );
}
