import { useEffect, useState } from 'react';
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
  Tooltip,
  SvgIcon,
  type StepIconProps,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import InstallMobileOutlinedIcon from '@mui/icons-material/InstallMobileOutlined';
import { generateNewIdentity, getPeerIdFromProtobuf } from '@skypier/network';
import type { LinkedEthAddress } from '@skypier/protocol';
import { connectAndLinkEthWallet } from '../walletLinking';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type BrowserProfile = {
  label: string;
  isChromium: boolean;
  isIOS: boolean;
  isSafari: boolean;
  isFirefox: boolean;
};

function detectBrowserProfile(): BrowserProfile {
  if (typeof navigator === 'undefined') {
    return {
      label: 'Unknown browser',
      isChromium: false,
      isIOS: false,
      isSafari: false,
      isFirefox: false,
    };
  }

  const ua = navigator.userAgent;
  const uaData = navigator as Navigator & {
    userAgentData?: {
      brands?: Array<{ brand: string; version: string }>;
    };
  };
  const brandText = (uaData.userAgentData?.brands ?? [])
    .map((entry) => entry.brand.toLowerCase())
    .join(' ');

  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isFirefox = /Firefox\//i.test(ua) || brandText.includes('firefox');
  const isEdg = /Edg\//i.test(ua) || brandText.includes('microsoft edge');
  const isOpera = /OPR\//i.test(ua) || brandText.includes('opera');
  const isChrome = /Chrome\//i.test(ua) || brandText.includes('google chrome') || brandText.includes('chromium');
  const isSafari = /Safari\//i.test(ua) && !isChrome && !isEdg && !isOpera && !isFirefox;
  const isChromium = isChrome || isEdg || isOpera;

  let label = 'Unknown browser';
  if (isEdg) label = 'Microsoft Edge';
  else if (isOpera) label = 'Opera';
  else if (isChrome) label = 'Google Chrome';
  else if (isFirefox) label = 'Firefox';
  else if (isSafari) label = 'Safari';

  return {
    label,
    isChromium,
    isIOS,
    isSafari,
    isFirefox,
  };
}

function isInstalledAsStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const iOSStandalone = 'standalone' in window.navigator
    ? Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
    : false;

  return window.matchMedia('(display-mode: standalone)').matches || iOSStandalone;
}

function EthereumLogoIcon() {
  return (
    <SvgIcon viewBox="0 0 256 417" aria-hidden>
      <path fill="currentColor" d="M127.6 0L124.8 9.5V279.2L127.6 282L255.2 207.2L127.6 0Z" />
      <path fill="currentColor" d="M127.6 0L0 207.2L127.6 282V150.9V0Z" />
      <path fill="currentColor" d="M127.6 306.1L126 308V404.1L127.6 417L255.3 231.3L127.6 306.1Z" />
      <path fill="currentColor" d="M127.6 417V306.1L0 231.3L127.6 417Z" />
      <path fill="currentColor" d="M127.6 282L255.2 207.2L127.6 150.9V282Z" />
      <path fill="currentColor" d="M0 207.2L127.6 282V150.9L0 207.2Z" />
    </SvgIcon>
  );
}

const ONBOARDING_STEPS = [
  { label: 'Choose a name', Icon: AccountCircleOutlinedIcon },
  { label: 'Identity', Icon: BadgeOutlinedIcon },
  { label: 'Wallet', Icon: EthereumLogoIcon },
  { label: 'PWA install', Icon: InstallMobileOutlinedIcon },
] as const;

function WizardStepIcon(props: StepIconProps) {
  const { active, completed, icon } = props;
  const index = Number(icon) - 1;
  const MetaIcon = ONBOARDING_STEPS[index]?.Icon;

  return (
    <Box
      sx={{
        width: 38,
        height: 38,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        color: 'text.secondary',
        border: '1px solid',
        borderColor: active || completed ? 'primary.main' : 'divider',
        bgcolor: active ? 'action.selected' : 'transparent',
      }}
    >
      {MetaIcon ? <MetaIcon sx={{ fontSize: 22 }} /> : null}
    </Box>
  );
}

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
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installStatus, setInstallStatus] = useState<'idle' | 'installed' | 'dismissed'>(
    isInstalledAsStandalone() ? 'installed' : 'idle',
  );
  const browserProfile = detectBrowserProfile();

  const steps = ONBOARDING_STEPS.map((step) => step.label);

  const canPromptInstall = browserProfile.isChromium && deferredInstallPrompt != null && installStatus !== 'installed';

  const CurrentStepIcon = ONBOARDING_STEPS[activeStep]?.Icon;

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
      setActiveStep(3);
    } else if (activeStep === 3 && resolvedIdentity) {
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

  const handleInstall = async () => {
    if (!deferredInstallPrompt) {
      return;
    }

    try {
      setInstallBusy(true);
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      setInstallStatus(choice.outcome === 'accepted' ? 'installed' : 'dismissed');
    } finally {
      setInstallBusy(false);
      setDeferredInstallPrompt(null);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setInstallStatus('installed');
      setDeferredInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  return (
    <Box
      sx={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#f8f5ff',
        backgroundImage:
          'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 28 28\' width=\'28\' height=\'28\'%3E%3Ccircle cx=\'2\' cy=\'2\' r=\'1\' fill=\'%23ffffff\' fill-opacity=\'0.42\'/%3E%3Ccircle cx=\'14\' cy=\'14\' r=\'1\' fill=\'%23ffffff\' fill-opacity=\'0.28\'/%3E%3Ccircle cx=\'26\' cy=\'26\' r=\'1\' fill=\'%23ffffff\' fill-opacity=\'0.36\'/%3E%3C/svg%3E"), radial-gradient(circle at 15% 20%, rgba(255, 182, 193, 0.38), transparent 38%), radial-gradient(circle at 85% 18%, rgba(255, 223, 128, 0.35), transparent 36%), radial-gradient(circle at 72% 78%, rgba(173, 216, 230, 0.34), transparent 34%), linear-gradient(135deg, #fff8f2 0%, #f8f5ff 52%, #f2fbff 100%)',
        backgroundRepeat: 'repeat, no-repeat, no-repeat, no-repeat, no-repeat',
        backgroundSize: '28px 28px, auto, auto, auto, auto',
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
              ? 'rgba(14, 8, 28, 0.5)' 
              : 'rgba(255, 255, 255, 0.25)',
          backdropFilter: (theme) => `blur(15px) saturate(190%)`,
          WebkitBackdropFilter: (theme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
          filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
          border: (theme) => 
            theme.palette.mode === 'dark' 
              ? '1px solid rgba(171, 110, 255, 0.25)' 
              : '1px solid rgba(0, 0, 0, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          backgroundImage: 'none',
          boxShadow: (theme) => 
            theme.palette.mode === 'dark'
              ? '0 8px 32px 0 rgba(0, 0, 0, 0.4)'
              : '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
        }}
      >
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1 }}>
            Welcome to Skypier dMessenger
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Set up your decentralized identity
          </Typography>
        </Box>

        <Stepper activeStep={activeStep} alternativeLabel>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel StepIconComponent={WizardStepIcon}>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box sx={{ mt: 2, flexGrow: 1 }}>
          <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ mb: 2.75, textAlign: 'center' }}>
            {CurrentStepIcon ? <CurrentStepIcon sx={{ color: 'text.secondary', fontSize: 48 }} /> : null}
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {steps[activeStep]}
            </Typography>
          </Stack>

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

          {activeStep === 3 && (
            <Stack gap={2.5}>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                Install Skypier as an app for a faster startup, offline shell, and a native-like experience.
              </Typography>

              <Typography variant="caption" color="text.secondary">
                Browser detected: {browserProfile.label}
              </Typography>

              <Box sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.1)' }}>
                {installStatus === 'installed' ? (
                  <Typography variant="body2" color="success.main">
                    Skypier is already installed on this device.
                  </Typography>
                ) : canPromptInstall ? (
                  <Typography variant="body2" color="text.secondary">
                    Installation is available. Tap Install App and accept the browser prompt.
                  </Typography>
                ) : browserProfile.isChromium ? (
                  <Typography variant="body2" color="text.secondary">
                    This Chromium browser did not expose the install prompt yet. Open the browser menu and choose Install app / Add to desktop.
                  </Typography>
                ) : browserProfile.isSafari || browserProfile.isIOS ? (
                  <Typography variant="body2" color="text.secondary">
                    Safari install steps: open Share, then choose Add to Home Screen.
                  </Typography>
                ) : browserProfile.isFirefox ? (
                  <Typography variant="body2" color="text.secondary">
                    Firefox has limited PWA install support. Use a Chromium browser (Chrome, Edge, Brave, Opera) for one-click install.
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    This browser is not Chromium-based. Install support may be limited; use the browser menu or switch to a Chromium browser for full PWA install.
                  </Typography>
                )}
              </Box>

              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="outlined"
                  onClick={handleInstall}
                  disabled={!canPromptInstall || installBusy}
                  startIcon={installBusy ? <CircularProgress size={16} /> : undefined}
                >
                  Install App
                </Button>
                <Button
                  variant="text"
                  onClick={() => setInstallStatus('dismissed')}
                  disabled={installBusy || installStatus === 'installed'}
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
              || ((activeStep === 2 || activeStep === 3) && !resolvedIdentity)
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
