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

interface OnboardingWizardProps {
  onComplete: (data: { displayName: string; identityProtobuf: string; localPeerId: string }) => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [identity, setIdentity] = useState<{ peerId: string; protobuf: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [importedProtobuf, setImportedProtobuf] = useState('');

  const steps = ['Set Profile', 'Secure Identity', 'Finalize'];

  const handleNext = async () => {
    if (activeStep === 0 && displayName.trim()) {
      setActiveStep(1);
    } else if (activeStep === 1) {
      if (importMode && importedProtobuf.trim()) {
        try {
          const peerId = await getPeerIdFromProtobuf(importedProtobuf.trim());
          onComplete({ displayName, identityProtobuf: importedProtobuf.trim(), localPeerId: peerId.toString() });
        } catch (e) {
          alert('Invalid identity secret. Please check your backup.');
        }
      } else if (identity) {
        onComplete({ displayName, identityProtobuf: identity.protobuf, localPeerId: identity.peerId });
      }
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
        bgcolor: '#050308',
        p: 2
      }}
    >
      <Paper
        elevation={24}
        sx={{
          width: '100%',
          maxWidth: 500,
          p: 4,
          borderRadius: 4,
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
          gap: 3
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
            disabled={(activeStep === 0 && !displayName.trim()) || (activeStep === 1 && !identity && !importedProtobuf)}
            onClick={handleNext}
          >
            {activeStep === steps.length - 1 ? 'Finish' : 'Next'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
