import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Typography, Stack } from '@mui/material';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import { useEffect, useState } from 'react';

interface BiometricUnlockProps {
  open: boolean;
  onUnlocked: () => void;
  onCancel: () => void;
}

export function BiometricUnlock(props: BiometricUnlockProps) {
  const { open, onUnlocked, onCancel } = props;
  const [isAttempting, setIsAttempting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    // Check if WebAuthn/Biometric is available
    if (!open) return;

    const checkBiometric = async () => {
      try {
        // Check if the browser supports PublicKeyCredential (WebAuthn)
        if (
          !window.PublicKeyCredential ||
          !(await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
        ) {
          setBiometricAvailable(false);
          return;
        }
        setBiometricAvailable(true);
      } catch (err) {
        console.warn('Biometric check failed:', err);
        setBiometricAvailable(false);
      }
    };

    void checkBiometric();
  }, [open]);

  const handleBiometricAuth = async () => {
    if (!biometricAvailable) {
      setError('Biometric authentication is not available on this device.');
      return;
    }

    setIsAttempting(true);
    setError(undefined);

    try {
      // Use WebAuthn to verify biometric (simplified: just verify presence)
      const result = await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array(32),
          timeout: 30000,
          userVerification: 'preferred',
          rpId: window.location.hostname,
        },
      });

      if (result && result.type === 'public-key') {
        // Successfully authenticated
        onUnlocked();
      } else {
        setError('Biometric authentication was not completed.');
      }
    } catch (err) {
      // NotAllowedError is a normal cancellation by user
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Biometric authentication was cancelled.');
      } else {
        setError(err instanceof Error ? err.message : 'Biometric authentication failed.');
      }
    } finally {
      setIsAttempting(false);
    }
  };

  const handleManualUnlock = () => {
    // Allow skipping biometric (e.g., if device doesn't have it or user forgets)
    // In a production system, this might require a passphrase fallback
    onUnlocked();
  };

  return (
    <Dialog 
      open={open} 
      onClose={onCancel} 
      fullWidth 
      maxWidth="xs"
      PaperProps={{
        sx: {
          bgcolor: (theme) => 
            theme.palette.mode === 'dark' 
              ? 'rgba(14, 8, 28, 0.7)' 
              : 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: (theme) => 
            theme.palette.mode === 'dark' 
              ? '1px solid rgba(171, 110, 255, 0.15)' 
              : '1px solid rgba(0, 0, 0, 0.05)',
          borderRadius: 4,
          backgroundImage: 'none'
        }
      }}
    >
      <DialogTitle sx={{ textAlign: 'center', fontWeight: 'bold' }}>Unlock Skypier</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 2, pb: 4 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <Box sx={{ 
            p: 2, 
            borderRadius: '50%', 
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(142, 45, 226, 0.1)' : 'rgba(142, 45, 226, 0.05)',
            border: '1px solid rgba(142, 45, 226, 0.2)'
          }}>
            <FingerprintIcon sx={{ fontSize: 64, color: 'primary.main' }} />
          </Box>
          <Typography variant="body1" align="center" sx={{ opacity: 0.9 }}>
            {biometricAvailable
              ? 'Skypier is locked. Please use biometrics to continue.'
              : 'Biometric authentication is not available on this device.'}
          </Typography>
        </Box>

        {error && (
          <Typography variant="body2" color="error" align="center" sx={{ bgcolor: 'rgba(244, 67, 54, 0.1)', p: 1, borderRadius: 1 }}>
            {error}
          </Typography>
        )}

        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            fullWidth
            startIcon={isAttempting ? <CircularProgress size={20} color="inherit" /> : <FingerprintIcon />}
            onClick={handleBiometricAuth}
            disabled={!biometricAvailable || isAttempting}
            size="large"
          >
            {isAttempting ? 'Unlocking…' : 'Unlock Now'}
          </Button>
          <Button variant="text" onClick={handleManualUnlock} disabled={isAttempting} fullWidth>
            Manual Skip
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
