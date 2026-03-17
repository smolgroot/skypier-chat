import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Typography, Stack } from '@mui/material';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import { useEffect, useState } from 'react';

interface BiometricUnlockProps {
  open: boolean;
  passkeyCredentialId?: string;
  userDisplayName?: string;
  onPasskeyCreated?: (credentialId: string) => void;
  onUnlocked: () => void;
  onCancel: () => void;
}

export function BiometricUnlock(props: BiometricUnlockProps) {
  const { open, passkeyCredentialId, userDisplayName, onPasskeyCreated, onUnlocked, onCancel } = props;
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
      if (!passkeyCredentialId) {
        const createdCredentialId = await createPasskey(userDisplayName);
        onPasskeyCreated?.(createdCredentialId);
      }

      const result = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          timeout: 30000,
          userVerification: 'required',
          rpId: window.location.hostname,
          ...(passkeyCredentialId ? {
            allowCredentials: [{
              id: toArrayBuffer(base64ToBytes(passkeyCredentialId)),
              type: 'public-key',
            }],
          } : {}),
        },
      });

      if (result && result.type === 'public-key') {
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
              ? 'rgba(14, 8, 28, 0.4)' 
              : 'rgba(255, 255, 255, 0.4)',
          backdropFilter: 'blur(30px) saturate(190%)',
          WebkitBackdropFilter: 'blur(30px) saturate(190%)',
          border: (theme) => 
            theme.palette.mode === 'dark' 
              ? '1px solid rgba(171, 110, 255, 0.2)' 
              : '1px solid rgba(0, 0, 0, 0.08)',
          borderRadius: 4,
          backgroundImage: 'none',
          boxShadow: (theme) => 
            theme.palette.mode === 'dark'
              ? '0 8px 32px 0 rgba(0, 0, 0, 0.8)'
              : '0 8px 32px 0 rgba(31, 38, 135, 0.15)'
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
              ? passkeyCredentialId
                ? 'Skypier is locked. Please use your passkey (biometrics) to continue.'
                : 'No passkey found for this device. Create one to enable biometric unlock.'
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
            {isAttempting ? 'Processing…' : passkeyCredentialId ? 'Unlock Now' : 'Create Passkey'}
          </Button>
          <Button variant="text" onClick={handleManualUnlock} disabled={isAttempting} fullWidth>
            Manual Skip
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

async function createPasskey(userDisplayName?: string): Promise<string> {
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        id: window.location.hostname,
        name: 'Skypier Chat',
      },
      user: {
        id: toArrayBuffer(userId),
        name: `skypier-${window.location.hostname}`,
        displayName: userDisplayName?.trim() || 'Skypier User',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      timeout: 60_000,
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
      attestation: 'none',
    },
  });

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('Passkey creation failed.');
  }

  return bytesToBase64(new Uint8Array(credential.rawId));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
