import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Stepper,
  Step,
  StepLabel,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Stack,
  IconButton,
  Tooltip,
  SvgIcon,
  type StepIconProps,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import InstallMobileOutlinedIcon from '@mui/icons-material/InstallMobileOutlined';
import { InvalidIdentityError, generateNewIdentity, resolveIdentityFromProtobuf } from '@skypier/network';
import type { LinkedEthAddress } from '@skypier/protocol';
import { connectAndLinkEthWallet } from '../walletLinking';
import { patternBackgroundSx } from '../backgrounds';

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

type ResolvedIdentity = { peerId: string; protobuf: string };

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

const insetPanelSx = {
  p: 2,
  borderRadius: 2,
  bgcolor: 'action.hover',
  border: '1px solid',
  borderColor: 'divider',
} as const;

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
        color: active || completed ? 'primary.main' : 'text.secondary',
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
  }) => void | Promise<void>;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [identity, setIdentity] = useState<ResolvedIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [importedProtobuf, setImportedProtobuf] = useState('');
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [savedKeyAcknowledged, setSavedKeyAcknowledged] = useState(false);
  const [copiedField, setCopiedField] = useState<'peerId' | 'secret' | null>(null);
  const [resolvedIdentity, setResolvedIdentity] = useState<ResolvedIdentity | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [linkedWalletAddress, setLinkedWalletAddress] = useState<string | null>(null);
  const [linkedWallet, setLinkedWallet] = useState<LinkedEthAddress | undefined>();
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<'idle' | 'installed' | 'dismissed'>(
    () => (isInstalledAsStandalone() ? 'installed' : 'idle'),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const copyResetRef = useRef<number | undefined>(undefined);
  const browserProfile = useMemo(() => detectBrowserProfile(), []);

  const steps = ONBOARDING_STEPS.map((step) => step.label);

  const canPromptInstall = browserProfile.isChromium && deferredInstallPrompt != null && installStatus !== 'installed';

  const CurrentStepIcon = ONBOARDING_STEPS[activeStep]?.Icon;

  // The wallet proof is signed over the peer ID, so a different identity
  // invalidates any link made earlier in the wizard.
  const applyResolvedIdentity = (next: ResolvedIdentity) => {
    if (resolvedIdentity && resolvedIdentity.peerId !== next.peerId) {
      setLinkedWallet(undefined);
      setLinkedWalletAddress(null);
    }

    setResolvedIdentity(next);
    setWalletError(null);
    setActiveStep(2);
  };

  const handleNext = async () => {
    if (activeStep === 0) {
      if (displayName.trim()) {
        setActiveStep(1);
      }
      return;
    }

    if (activeStep === 1) {
      setIdentityError(null);

      // Import mode is authoritative: never silently fall back to a previously
      // generated identity just because the paste box is empty.
      if (importMode) {
        if (!importedProtobuf.trim()) {
          setIdentityError('Paste your identity secret, or go back to generation.');
          return;
        }

        try {
          applyResolvedIdentity(await resolveIdentityFromProtobuf(importedProtobuf));
        } catch (error) {
          setIdentityError(
            error instanceof InvalidIdentityError
              ? error.message
              : 'Could not read that identity secret. Please check your backup.',
          );
        }
        return;
      }

      if (identity && savedKeyAcknowledged) {
        applyResolvedIdentity(identity);
      }
      return;
    }

    if (activeStep === 2 && resolvedIdentity) {
      setActiveStep(3);
      return;
    }

    if (activeStep === 3 && resolvedIdentity) {
      setSubmitting(true);
      setSubmitError(null);
      try {
        await onComplete({
          displayName: displayName.trim(),
          identityProtobuf: resolvedIdentity.protobuf,
          localPeerId: resolvedIdentity.peerId,
          linkedWallet,
        });
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? `Could not save your profile: ${error.message}`
            : 'Could not save your profile. Please try again.',
        );
      } finally {
        setSubmitting(false);
      }
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
    setIdentityError(null);
    try {
      const newIdentity = await generateNewIdentity();
      setIdentity(newIdentity);
      setSavedKeyAcknowledged(false);
    } catch (error) {
      setIdentityError(
        error instanceof Error
          ? `Could not generate an identity: ${error.message}`
          : 'Could not generate an identity in this browser.',
      );
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, field: 'peerId' | 'secret') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      window.clearTimeout(copyResetRef.current);
      copyResetRef.current = window.setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setIdentityError('Could not copy to the clipboard. Select the value and copy it manually.');
    }
  };

  const handleDownloadKey = () => {
    if (!identity) {
      return;
    }

    // Plain text, secret only, so the file can be pasted straight back into the
    // import box on a future device.
    const blob = new Blob([identity.protobuf], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `skypier-identity-${identity.peerId.slice(-8)}.txt`;
    anchor.click();
    // Revoking synchronously can cancel the download in some browsers, and
    // losing this file means losing the account.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const handleInstall = async () => {
    if (!deferredInstallPrompt) {
      return;
    }

    try {
      setInstallBusy(true);
      setInstallError(null);
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      setInstallStatus(choice.outcome === 'accepted' ? 'installed' : 'dismissed');
      // The event is single-use once it has actually been shown.
      setDeferredInstallPrompt(null);
    } catch (error) {
      // Deliberately keep the deferred prompt so a failed attempt does not
      // disable the button for the rest of the session.
      setInstallError(
        error instanceof Error ? error.message : 'The browser could not show the install prompt.',
      );
    } finally {
      setInstallBusy(false);
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

  useEffect(() => () => window.clearTimeout(copyResetRef.current), []);

  const nextDisabled = submitting
    || (activeStep === 0 && !displayName.trim())
    || (activeStep === 1 && (importMode ? !importedProtobuf.trim() : !identity || !savedKeyAcknowledged))
    || ((activeStep === 2 || activeStep === 3) && !resolvedIdentity);

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        overflowY: 'auto',
        py: 4,
        px: 2,
        ...patternBackgroundSx,
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          width: '100%',
          maxWidth: 500,
          // Centres the card when there is room, without clipping it when there isn't.
          my: 'auto',
          p: { xs: 3, sm: 4 },
          borderRadius: 3,
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
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
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleNext();
              }}
            >
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
                <button type="submit" hidden aria-hidden />
              </Stack>
            </form>
          )}

          {activeStep === 1 && (
            <Stack gap={3}>
              {!importMode ? (
                <>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    Generate a new secure identity. Your Peer ID is derived from this unique key.
                  </Typography>

                  {identityError ? <Alert severity="error">{identityError}</Alert> : null}

                  {identity ? (
                    <>
                      <Box sx={insetPanelSx}>
                        <Typography variant="caption" display="block" sx={{ mb: 1, opacity: 0.65 }}>
                          Your Peer ID:
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 'bold', color: 'primary.main' }}>
                            {identity.peerId}
                          </Typography>
                          <Tooltip title={copiedField === 'peerId' ? 'Copied' : 'Copy Peer ID'}>
                            <IconButton size="small" onClick={() => { void copyToClipboard(identity.peerId, 'peerId'); }}>
                              {copiedField === 'peerId'
                                ? <CheckIcon fontSize="small" color="success" />
                                : <ContentCopyIcon fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                        </Box>

                        <Typography variant="caption" display="block" sx={{ mt: 2, mb: 1, opacity: 0.65 }}>
                          Identity Backup (Keep this secure!):
                        </Typography>
                        <Typography
                          variant="caption"
                          component="p"
                          sx={{ fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.8 }}
                        >
                          {identity.protobuf}
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={copiedField === 'secret' ? <CheckIcon /> : <ContentCopyIcon />}
                            onClick={() => { void copyToClipboard(identity.protobuf, 'secret'); }}
                          >
                            {copiedField === 'secret' ? 'Copied' : 'Copy'}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<DownloadIcon />}
                            onClick={handleDownloadKey}
                          >
                            Download key file
                          </Button>
                        </Stack>
                      </Box>

                      <Alert severity="warning" sx={{ py: 0.5 }}>
                        This key is shown once and cannot be recovered. Without it you lose access to
                        this account.
                      </Alert>

                      <FormControlLabel
                        control={(
                          <Checkbox
                            checked={savedKeyAcknowledged}
                            onChange={(event) => setSavedKeyAcknowledged(event.target.checked)}
                          />
                        )}
                        label={<Typography variant="body2">I have saved my recovery key</Typography>}
                      />
                    </>
                  ) : (
                    <Button
                      variant="contained"
                      onClick={() => { void handleGenerate(); }}
                      disabled={loading}
                      startIcon={loading ? <CircularProgress size={20} /> : <RefreshIcon />}
                    >
                      Generate New Identity
                    </Button>
                  )}

                  <Button
                    variant="text"
                    size="small"
                    onClick={() => {
                      setImportMode(true);
                      setIdentityError(null);
                    }}
                  >
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
                    error={Boolean(identityError)}
                    helperText={identityError ?? ' '}
                    onChange={(e) => {
                      setImportedProtobuf(e.target.value);
                      setIdentityError(null);
                    }}
                  />
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => {
                      setImportMode(false);
                      setIdentityError(null);
                    }}
                  >
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

              <Box sx={insetPanelSx}>
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

              {walletError ? <Alert severity="error">{walletError}</Alert> : null}

              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="outlined"
                  onClick={() => { void handleLinkWallet(); }}
                  disabled={walletBusy || !resolvedIdentity}
                  startIcon={walletBusy ? <CircularProgress size={16} /> : undefined}
                >
                  {linkedWalletAddress ? 'Re-link Wallet' : 'Link EVM Wallet'}
                </Button>
                {linkedWalletAddress || walletError ? (
                  <Button
                    variant="text"
                    onClick={() => {
                      setLinkedWallet(undefined);
                      setLinkedWalletAddress(null);
                      setWalletError(null);
                    }}
                    disabled={walletBusy}
                  >
                    Clear link
                  </Button>
                ) : null}
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

              <Box sx={insetPanelSx}>
                {installStatus === 'installed' ? (
                  <Typography variant="body2" color="success.main">
                    Skypier is already installed on this device.
                  </Typography>
                ) : installStatus === 'dismissed' ? (
                  <Typography variant="body2" color="text.secondary">
                    Skipped. You can install Skypier later from your browser menu.
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

              {installError ? <Alert severity="error">{installError}</Alert> : null}

              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="outlined"
                  onClick={() => { void handleInstall(); }}
                  disabled={!canPromptInstall || installBusy}
                  startIcon={installBusy ? <CircularProgress size={16} /> : undefined}
                >
                  Install App
                </Button>
                <Button
                  variant="text"
                  onClick={() => setInstallStatus('dismissed')}
                  disabled={installBusy || installStatus !== 'idle'}
                >
                  Skip for now
                </Button>
              </Stack>
            </Stack>
          )}
        </Box>

        {submitError ? <Alert severity="error">{submitError}</Alert> : null}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
          <Button
            disabled={activeStep === 0 || submitting}
            onClick={() => setActiveStep((prev) => prev - 1)}
          >
            Back
          </Button>
          <Button
            variant="contained"
            disabled={nextDisabled}
            onClick={() => { void handleNext(); }}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {activeStep === steps.length - 1 ? 'Finish' : 'Next'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
