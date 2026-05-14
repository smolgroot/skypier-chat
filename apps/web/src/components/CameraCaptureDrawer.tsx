import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CameraswitchIcon from '@mui/icons-material/Cameraswitch';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import ReplayIcon from '@mui/icons-material/Replay';
import CheckIcon from '@mui/icons-material/Check';

type CameraFacingMode = 'user' | 'environment';

interface CameraCaptureDrawerProps {
  open: boolean;
  onClose: () => void;
  onSendImage: (file: File) => void;
}

function buildFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `skypier-camera-${stamp}.jpg`;
}

export function CameraCaptureDrawer(props: CameraCaptureDrawerProps) {
  const { open, onClose, onSendImage } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<CameraFacingMode>('environment');
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<{ file: File; previewUrl: string } | null>(null);

  const stopCamera = useCallback(() => {
    if (!streamRef.current) {
      return;
    }

    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const clearCaptured = useCallback(() => {
    setCaptured((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return null;
    });
  }, []);

  const startCamera = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not support in-app camera capture.');
      return;
    }

    setIsStartingCamera(true);
    setCameraError(null);

    try {
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      console.error('[skypier:camera] failed to start camera:', error);
      setCameraError('Camera access failed. Check permissions and try again.');
    } finally {
      setIsStartingCamera(false);
    }
  }, [facingMode, stopCamera]);

  const capturePhoto = useCallback(async () => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const width = videoElement.videoWidth;
    const height = videoElement.videoHeight;

    if (!width || !height) {
      setCameraError('Camera is still warming up. Try again in a moment.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      setCameraError('Could not read camera frame.');
      return;
    }

    context.drawImage(videoElement, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((nextBlob) => resolve(nextBlob), 'image/jpeg', 0.9);
    });

    if (!blob) {
      setCameraError('Capture failed. Please retry.');
      return;
    }

    clearCaptured();
    const file = new File([blob], buildFileName(), { type: 'image/jpeg' });
    const previewUrl = URL.createObjectURL(blob);
    setCaptured({ file, previewUrl });
    stopCamera();
  }, [clearCaptured, stopCamera]);

  const handleRetake = useCallback(() => {
    clearCaptured();
  }, [clearCaptured]);

  const handleSend = useCallback(() => {
    if (!captured) {
      return;
    }

    onSendImage(captured.file);
    clearCaptured();
    onClose();
  }, [captured, clearCaptured, onClose, onSendImage]);

  const handleClose = useCallback(() => {
    clearCaptured();
    onClose();
  }, [clearCaptured, onClose]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      clearCaptured();
      setCameraError(null);
      setIsStartingCamera(false);
    }
  }, [clearCaptured, open, stopCamera]);

  useEffect(() => {
    if (!open || captured) {
      return;
    }

    void startCamera();
  }, [captured, facingMode, open, startCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
      clearCaptured();
    };
  }, [clearCaptured, stopCamera]);

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: {
          width: '100%',
          maxWidth: 560,
          mx: 'auto',
          left: 0,
          right: 0,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? 'rgba(10, 5, 20, 0.62)'
              : 'rgba(255,255,255,0.88)',
          backdropFilter: (theme) => `blur(22px) saturate(180%) url(#liquid-glass-refraction-${theme.palette.mode})`,
          WebkitBackdropFilter: (theme) => `blur(22px) saturate(180%) url(#liquid-glass-refraction-${theme.palette.mode})`,
          filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
          borderTop: (theme) => theme.palette.mode === 'dark'
            ? '1px solid rgba(171, 110, 255, 0.2)'
            : '1px solid rgba(0,0,0,0.08)',
          pb: 'env(safe-area-inset-bottom, 0px)',
        },
      }}
    >
      <Box sx={{ pt: 1.25, display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'rgba(128,128,128,0.35)' }} />
      </Box>

      <Box sx={{ px: 2.5, pt: 1.5, pb: 2.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Camera
          </Typography>
          <IconButton onClick={handleClose} aria-label="Close camera">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Box
          sx={{
            position: 'relative',
            borderRadius: 3,
            overflow: 'hidden',
            bgcolor: 'black',
            aspectRatio: '3 / 4',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {!captured ? (
            <>
              <Box
                component="video"
                ref={videoRef}
                autoPlay
                muted
                playsInline
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                }}
              />
              {isStartingCamera && (
                <Stack
                  spacing={1}
                  alignItems="center"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    justifyContent: 'center',
                    bgcolor: 'rgba(0,0,0,0.4)',
                  }}
                >
                  <CircularProgress size={28} sx={{ color: 'white' }} />
                  <Typography variant="body2" sx={{ color: 'white' }}>
                    Opening camera...
                  </Typography>
                </Stack>
              )}
            </>
          ) : (
            <Box component="img" src={captured.previewUrl} alt="Captured preview" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
        </Box>

        {cameraError ? (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {cameraError}
          </Alert>
        ) : null}

        {cameraError && !captured ? (
          <Button sx={{ mt: 1.5 }} variant="outlined" onClick={() => void startCamera()}>
            Retry camera
          </Button>
        ) : null}

        {!captured ? (
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2 }}>
            <Button
              variant="outlined"
              startIcon={<CameraswitchIcon />}
              onClick={() => setFacingMode((current) => (current === 'environment' ? 'user' : 'environment'))}
              disabled={isStartingCamera}
            >
              Flip camera
            </Button>

            <IconButton
              aria-label="Take picture"
              onClick={() => void capturePhoto()}
              disabled={isStartingCamera}
              sx={{
                width: 72,
                height: 72,
                border: '4px solid rgba(255,255,255,0.85)',
                bgcolor: 'rgba(255,255,255,0.2)',
                color: 'white',
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                '&:hover': {
                  bgcolor: 'rgba(255,255,255,0.28)',
                },
              }}
            >
              <PhotoCameraIcon sx={{ fontSize: 30 }} />
            </IconButton>

            <Box sx={{ width: 116 }} />
          </Stack>
        ) : (
          <Stack direction="row" spacing={1.5} justifyContent="space-between" sx={{ mt: 2 }}>
            <Button variant="outlined" startIcon={<ReplayIcon />} onClick={handleRetake}>
              Redo
            </Button>
            <Button variant="contained" startIcon={<CheckIcon />} onClick={handleSend}>
              Use photo
            </Button>
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}