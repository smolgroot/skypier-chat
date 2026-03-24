import { useState } from 'react';
import { 
  Box, 
  Typography, 
  TextField, 
  Button, 
  Paper, 
  Stepper, 
  Step, 
  StepLabel,
  CircularProgress,
  Stack,
  IconButton,
  Tooltip
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import { generateNewIdentity, getPeerIdFromProtobuf } from '@skypier/network';
import type { LinkedEthAddress } from '@skypier/protocol';
import { connectAndLinkEthWallet } from '../walletLinking';

interface OnboardingWizardProps {
  onComplete: (data: {
    displayName: string;
    identityProtobuf: string;
    localPeerId: string;
    linkedWallet?: LinkedEthAddress;
  }) => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [identity, setIdentity] = useState<{ peerId: string; protobuf: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [importedProtobuf, setImportedProtobuf] = useState('');
  const [resolvedIdentity, setResolvedIdentity] = useState<{ peerId: string; protobuf: string } | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [linkedWalletAddress, setLinkedWalletAddress] = useState<string | null>(null);
  const [linkedWallet, setLinkedWallet] = useState<LinkedEthAddress | undefined>();

  const steps = ['Set Profile', 'Secure Identity', 'Optional ENS'];

  const handleNext = async () => {
    if (activeStep === 0 && displayName.trim()) {
      setActiveStep(1);
    } else if (activeStep === 1) {
      if (importMode && importedProtobuf.trim()) {
        try {
          const peerId = await getPeerIdFromProtobuf(importedProtobuf.trim());
          setResolvedIdentity({ peerId: peerId.toString(), protobuf: importedProtobuf.trim() });
          setWalletError(null);
          setActiveStep(2);
        } catch (e) {
          alert('Invalid identity secret. Please check your backup.');
        }
      } else if (identity) {
        setResolvedIdentity(identity);
        setWalletError(null);
        setActiveStep(2);
      }
    } else if (activeStep === 2 && resolvedIdentity) {
      onComplete({
        displayName,
        identityProtobuf: resolvedIdentity.protobuf,
        localPeerId: resolvedIdentity.peerId,
        linkedWallet,
      });
    }
  };

  const handleLinkWallet = async () => {
    if (!resolvedIdentity) {
      return;
    }

    try {
      setWalletBusy(true);
      setWalletError(null);
      const linked = await connectAndLinkEthWallet(resolvedIdentity.peerId);
      setLinkedWallet(linked.wallet);
      setLinkedWalletAddress(linked.wallet.address);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : 'Failed to link EVM wallet.');
    } finally {
      setWalletBusy(false);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const newIdentity = await generateNewIdentity();
      setIdentity(newIdentity);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <Box
      sx={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'transparent',
        p: 2
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: '100%',
          maxWidth: 500,
          p: 4,
          borderRadius: 4,
          bgcolor: (theme) => 
            theme.palette.mode === 'dark' 
              ? 'rgba(14, 8, 28, 0.4)' 
              : 'rgba(255, 255, 255, 0.2)',
          backdropFilter: (theme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
          WebkitBackdropFilter: (theme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
          filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
          border: (theme) => 
            theme.palette.mode === 'dark' 
              ? '1px solid rgba(171, 110, 255, 0.2)' 
              : '1px solid rgba(0, 0, 0, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          backgroundImage: 'none',
          boxShadow: (theme) => 
            theme.palette.mode === 'dark'
              ? '0 8px 32px 0 rgba(0, 0, 0, 0.8)'
              : '0 8px 32px 0 rgba(31, 38, 135, 0.1)'
        }}
      >
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1 }}>
            Welcome to Skypier
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Set up your decentralized identity
          </Typography>
        </Box>

        <Stepper activeStep={activeStep} alternativeLabel>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box sx={{ mt: 2, flexGrow: 1 }}>
          {activeStep === 0 && (
            <Stack gap={3}>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                Choose a display name. This will be visible to your peers.
              </Typography>
              <TextField
                autoFocus
                fullWidth
                label="Display Name"
                placeholder="e.g. Alice"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                variant="outlined"
              />
            </Stack>
          )}

          {activeStep === 1 && (
            <Stack gap={3}>
              {!importMode ? (
                <>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    Generate a new secure identity. Your Peer ID is derived from this unique key.
                  </Typography>
                  
                  {identity ? (
                    <Box sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.1)' }}>
                      <Typography variant="caption" display="block" sx={{ mb: 1, opacity: 0.5 }}>
                        Your Peer ID:
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 'bold', color: 'primary.main' }}>
                          {identity.peerId}
                        </Typography>
                        <Tooltip title="Copy Peer ID">
                          <IconButton size="small" onClick={() => copyToClipboard(identity.peerId)}>
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                      
                      <Typography variant="caption" display="block" sx={{ mt: 2, mb: 1, opacity: 0.5 }}>
                        Identity Backup (Keep this secure!):
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', maxWidth: 200, opacity: 0.8 }}>
                          {identity.protobuf}
                        </Typography>
                        <Tooltip title="Copy Identity Secret">
                          <IconButton size="small" onClick={() => copyToClipboard(identity.protobuf)}>
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                  ) : (
                    <Button 
                      variant="contained" 
                      onClick={handleGenerate} 
                      disabled={loading}
                      startIcon={loading ? <CircularProgress size={20} /> : <RefreshIcon />}
                    >
                      Generate New Identity
                    </Button>
                  )}
                  
                  <Button variant="text" size="small" onClick={() => setImportMode(true)}>
                    Already have an identity secret?
                  </Button>
                </>
              ) : (
                <>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    Paste your Base64 encoded identity secret below.
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    rows={4}
                    label="Identity Secret"
                    value={importedProtobuf}
                    onChange={(e) => setImportedProtobuf(e.target.value)}
                  />
                  <Button variant="text" size="small" onClick={() => setImportMode(false)}>
                    Go back to Generation
                  </Button>
                </>
              )}
            </Stack>
          )}

          {activeStep === 2 && (
            <Stack gap={2.5}>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                Optionally link an EVM wallet to resolve ENS names in chats and profile surfaces.
              </Typography>

              <Box sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.1)' }}>
                <Typography variant="caption" display="block" sx={{ mb: 1, opacity: 0.65 }}>
                  This step is optional and can be done later from your profile page.
                </Typography>

                {linkedWalletAddress ? (
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'success.main', wordBreak: 'break-all' }}>
                    Linked: {linkedWalletAddress}
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No wallet linked yet.
                  </Typography>
                )}
              </Box>

              {walletError ? (
                <Typography variant="caption" color="error.main">
                  {walletError}
                </Typography>
              ) : null}

              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="outlined"
                  onClick={handleLinkWallet}
                  disabled={walletBusy || !resolvedIdentity}
                  startIcon={walletBusy ? <CircularProgress size={16} /> : undefined}
                >
                  {linkedWalletAddress ? 'Re-link Wallet' : 'Link EVM Wallet'}
                </Button>
                <Button
                  variant="text"
                  onClick={() => {
                    setLinkedWallet(undefined);
                    setLinkedWalletAddress(null);
                    setWalletError(null);
                  }}
                  disabled={walletBusy || (!linkedWalletAddress && !walletError)}
                >
                  Skip for now
                </Button>
              </Stack>
            </Stack>
          )}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
          <Button 
            disabled={activeStep === 0} 
            onClick={() => setActiveStep((prev) => prev - 1)}
          >
            Back
          </Button>
          <Button
            variant="contained"
            disabled={
              (activeStep === 0 && !displayName.trim())
              || (activeStep === 1 && !identity && !importedProtobuf)
              || (activeStep === 2 && !resolvedIdentity)
            }
            onClick={handleNext}
          >
            {activeStep === steps.length - 1 ? 'Finish' : 'Next'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
