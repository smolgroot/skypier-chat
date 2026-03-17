import { createKeyCustodyPlan, createSecuritySummary } from '@skypier/crypto';
import { createPresence, createRuntimePlan, type PeerReachabilityEvent } from '@skypier/network';
import { getCurrentDevice } from '@skypier/storage';
import { useCallback, useState, useMemo, useEffect } from 'react';
import { ThemeProvider, CssBaseline, Snackbar, Alert } from '@mui/material';
import { useChatController } from './useChatController';
import { useLiveChatSession } from './useLiveChatSession';
import { connectAndLinkEthWallet } from './walletLinking';
import { theme } from './theme';
import { MainLayout } from './components/MainLayout';
import { ChatThread } from './components/ChatThread';
import { ProfilePage } from './components/ProfilePage';
import { SettingsPage } from './components/SettingsPage';
import { NetworkStatusPage } from './components/NetworkStatusPage';
import { SplashScreen } from './components/SplashScreen';
import { OnboardingWizard } from './components/OnboardingWizard';
import { BiometricUnlock } from './components/BiometricUnlock';
import { ContactDetailPage } from './components/ContactDetailPage';

export function App() {
  const {
    account,
    conversations,
    selectedConversation,
    selectedConversationId,
    setSelectedConversationId,
    messages,
    composerValue,
    setComposerValue,
    createConversationWithPeer,
    updateConversationConnection,
    sendMessage,
    replyTarget,
    clearReplyTarget,
    toggleReaction,
    ingestIncomingEnvelope,
    linkEthAddress,
    unlinkEthAddress,
    exportBackup,
    lastBackupChecksum,
    storageMode,
    isLoaded,
    updateAccount,
    identityProtobuf,
    localPeerId,
  } = useChatController();

  const [activeView, setActiveView] = useState<'chat' | 'profile' | 'settings' | 'contact' | 'network'>('chat');
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark');
  const [peerIdInput, setPeerIdInput] = useState('');
  const [dialError, setDialError] = useState<string | undefined>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | undefined>();
  const [networkAlertDismissed, setNetworkAlertDismissed] = useState(false);
  const [showBiometricUnlock, setShowBiometricUnlock] = useState(false);
  const [biometricSessionUnlocked, setBiometricSessionUnlocked] = useState(false);
  const [contactDialBusy, setContactDialBusy] = useState(false);
  const [contactDialError, setContactDialError] = useState<string | undefined>();
  const [contactDialSuccess, setContactDialSuccess] = useState<string | undefined>();

  const currentTheme = useMemo(() => theme(colorMode), [colorMode]);

  const handleInboundMessage = useCallback(async ({ fromPeerId, envelope }: { fromPeerId: string; envelope: { kind: 'message' | 'receipt' | 'presence' | 'sync'; conversationId: string; senderPeerId: string; sentAt: string; payload: string } }) => {
    console.log('[skypier:app] \u21d0 inbound message from', fromPeerId, '\u2014 kind:', envelope.kind, 'conv:', envelope.conversationId, 'payload:', envelope.payload.slice(0, 80));
    await ingestIncomingEnvelope(envelope, fromPeerId);
  }, [ingestIncomingEnvelope]);

  const handlePeerReachabilityChange = useCallback(({ peerId, reachability }: PeerReachabilityEvent) => {
    void updateConversationConnection(peerId, { reachability });
  }, [updateConversationConnection]);

  const {
    state: liveState,
    connectedPeers,
    startSession,
    stopSession,
    dialPeerById,
    broadcastChatMessage,
    sendChatMessageToPeer,
  } = useLiveChatSession({
    onInboundMessage: handleInboundMessage,
    onPeerReachabilityChange: handlePeerReachabilityChange,
    identityProtobuf
  });

  // Automatically start the session once the app is loaded
  useEffect(() => {
    if (isLoaded && liveState.status === 'idle') {
      void startSession().catch(console.error);
    }
  }, [isLoaded, liveState.status, startSession]);

  const handleLinkWallet = useCallback(() => {
    void (async () => {
      try {
        setWalletBusy(true);
        setWalletError(undefined);
        const linked = await connectAndLinkEthWallet(liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId);
        await linkEthAddress(linked.wallet);
      } catch (error) {
        setWalletError(error instanceof Error ? error.message : 'Failed to link wallet');
      } finally {
        setWalletBusy(false);
      }
    })();
  }, [linkEthAddress, liveState.localPeerId]);

  const securitySummary = createSecuritySummary();
  const runtimePlan = createRuntimePlan();
  const presence = createPresence();
  const keyCustodyPlan = createKeyCustodyPlan(getCurrentDevice(), {
    biometricsAvailable: true,
    secureHardwareAvailable: false,
    canPersistWrappedKey: true,
  });

  const toggleColorMode = () => {
    setColorMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleBiometricUnlockToggle = useCallback((enabled: boolean) => {
    void updateAccount({ biometricUnlockEnabled: enabled });

    if (!enabled) {
      setShowBiometricUnlock(false);
      setBiometricSessionUnlocked(false);
    }
  }, [updateAccount]);

  const handleBiometricUnlocked = useCallback(() => {
    setBiometricSessionUnlocked(true);
    setShowBiometricUnlock(false);
  }, []);

  const handleCreateChat = useCallback(async (peerId: string, displayName?: string) => {
    await createConversationWithPeer(peerId, displayName);
    setActiveView('chat');

    if (liveState.status !== 'running') {
      await updateConversationConnection(peerId, {
        reachability: 'unknown',
        lastMessagePreview: 'Chat created. Start live session to connect.',
      });
      return;
    }

    try {
      setDialError(undefined);
      await updateConversationConnection(peerId, {
        reachability: 'unknown',
        lastMessagePreview: 'Connecting securely…',
      });

      await dialPeerById(peerId);
      await updateConversationConnection(peerId, {
        reachability: 'direct',
        lastMessagePreview: 'Secure channel established.',
      });
    } catch (error) {
      await updateConversationConnection(peerId, {
        reachability: 'offline',
        lastMessagePreview: 'Connection failed. Retry from Settings.',
      });
      setDialError(error instanceof Error ? error.message : 'Unable to dial peer right now.');
    }
  }, [createConversationWithPeer, dialPeerById, liveState.status, updateConversationConnection]);

  const openSelectedContact = useCallback(() => {
    if (!selectedConversation) {
      return;
    }
    setContactDialError(undefined);
    setContactDialSuccess(undefined);
    setActiveView('contact');
  }, [selectedConversation]);

  const handleContactDial = useCallback(async (peerId: string) => {
    setContactDialBusy(true);
    setContactDialError(undefined);
    setContactDialSuccess(undefined);

    try {
      if (liveState.status !== 'running') {
        await startSession();
      }

      const connectedPeerId = await dialPeerById(peerId);
      setContactDialSuccess(`Dial succeeded: ${connectedPeerId.slice(0, 14)}…`);
      await updateConversationConnection(peerId, {
        reachability: 'direct',
        lastMessagePreview: 'Peer reachable from contact page.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dial failed';
      setContactDialError(message);
      await updateConversationConnection(peerId, {
        reachability: 'offline',
        lastMessagePreview: 'Dial test failed from contact page.',
      });
    } finally {
      setContactDialBusy(false);
    }
  }, [dialPeerById, liveState.status, startSession, updateConversationConnection]);

  // Reset network alert when status changes to avoid persistent dismissals blocking important info
  useEffect(() => {
    if (liveState.status !== 'idle' && liveState.status !== 'error') {
      setNetworkAlertDismissed(false);
    }
  }, [liveState.status]);

  // Show biometric unlock on app load if enabled (after onboarding is complete)
  useEffect(() => {
    if (isLoaded && !account.displayName) return; // Still in onboarding
    if (
      isLoaded
      && account.biometricUnlockEnabled
      && !biometricSessionUnlocked
      && !showBiometricUnlock
    ) {
      setShowBiometricUnlock(true);
    }
  }, [
    isLoaded,
    account.biometricUnlockEnabled,
    account.displayName,
    biometricSessionUnlocked,
    showBiometricUnlock,
  ]);

  const showNetworkAlert =
    !networkAlertDismissed &&
    (liveState.status === 'error' || liveState.status === 'stopped' || (liveState.status === 'idle' && isLoaded));
  const networkAlertMessage =
    liveState.status === 'error'
      ? `P2P network error: ${liveState.lastError || 'Unknown error'}`
      : liveState.status === 'stopped'
        ? 'P2P network is offline. Your messages will be stored locally.'
        : 'P2P network is not yet connected. Connecting…';
  const networkAlertSeverity =
    liveState.status === 'error'
      ? 'error'
      : liveState.status === 'stopped'
        ? 'warning'
        : 'info';

  const localPeerStatus: 'online' | 'connecting' | 'offline' =
    liveState.status === 'running' && !!liveState.localPeerId
      ? 'online'
      : liveState.status === 'starting' || liveState.status === 'idle'
        ? 'connecting'
        : 'offline';

  const renderContent = () => {
    if (activeView === 'profile') {
      return (
        <ProfilePage 
          peerId={liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId} 
          displayName={account.displayName}
          linkedWallets={account.linkedEthAddresses} 
        />
      );
    }

    if (activeView === 'settings') {
      return (
        <SettingsPage 
          keyCustodyPlan={keyCustodyPlan}
          runtimePlan={runtimePlan}
          securitySummary={securitySummary}
          isLoaded={isLoaded}
          storageMode={storageMode}
          liveState={liveState}
          connectedPeers={connectedPeers}
          presence={presence}
          peerMultiaddr={peerIdInput}
          setPeerMultiaddr={setPeerIdInput}
          dialPeer={dialPeerById}
          startSession={startSession}
          stopSession={stopSession}
          exportBackup={exportBackup}
          lastBackupChecksum={lastBackupChecksum}
          account={account}
          handleLinkWallet={handleLinkWallet}
          unlinkEthAddress={unlinkEthAddress}
          walletBusy={walletBusy}
          walletError={walletError}
          dialError={dialError}
          onBiometricUnlockToggle={handleBiometricUnlockToggle}
        />
      );
    }

    if (activeView === 'network') {
      return (
        <NetworkStatusPage sessionState={liveState} />
      );
    }

    if (activeView === 'contact' && selectedConversation) {
      return (
        <ContactDetailPage
          conversation={selectedConversation}
          localPeerId={liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId}
          isDialing={contactDialBusy}
          dialError={contactDialError}
          dialSuccess={contactDialSuccess}
          onDialPeer={(peerId) => { void handleContactDial(peerId); }}
          onOpenChat={() => setActiveView('chat')}
        />
      );
    }

    if (selectedConversation) {
      return (
        <ChatThread 
          conversation={selectedConversation}
          messages={messages}
          currentUserDisplayName={account.displayName}
          composerValue={composerValue}
          replyTarget={replyTarget}
          onOpenContact={openSelectedContact}
          onComposerChange={setComposerValue}
          onReplyClear={clearReplyTarget}
          onToggleReaction={toggleReaction}
          onSendMessage={() => {
            void (async () => {
              const message = await sendMessage();
              if (message && selectedConversation) {
                // Find the remote peer in the conversation to send targeted
                const remotePeer = selectedConversation.participants.find(
                  (p) => p.peerId !== (liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId)
                );
                if (remotePeer) {
                  console.log('[skypier:app] \u21d2 sending message to peer', remotePeer.peerId, 'conv:', message.conversationId);
                  const sent = await sendChatMessageToPeer(message, remotePeer.peerId);
                  if (!sent) {
                    console.warn('[skypier:app] targeted send failed/queued, falling back to broadcast');
                    await broadcastChatMessage(message);
                  }
                } else {
                  await broadcastChatMessage(message);
                }
              }
            })();
          }}
        />
      );
    }

    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
        <h3>Select a chat to start messaging</h3>
      </div>
    );
  };

  if (!isLoaded) {
    return (
      <ThemeProvider theme={currentTheme}>
        <CssBaseline />
        <SplashScreen />
      </ThemeProvider>
    );
  }

  const needsOnboarding = !account.displayName || !identityProtobuf;

  if (needsOnboarding) {
    return (
      <ThemeProvider theme={currentTheme}>
        <CssBaseline />
        <OnboardingWizard 
          onComplete={(data) => {
            void updateAccount(data);
          }} 
        />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={currentTheme}>
      <CssBaseline />
      <BiometricUnlock
        open={showBiometricUnlock}
        passkeyCredentialId={account.biometricCredentialId}
        userDisplayName={account.displayName}
        onPasskeyCreated={(credentialId) => {
          void updateAccount({ biometricCredentialId: credentialId });
        }}
        onUnlocked={handleBiometricUnlocked}
        onCancel={handleBiometricUnlocked}
      />
      <Snackbar
        open={showNetworkAlert}
        autoHideDuration={liveState.status === 'error' ? 0 : 6000}
        onClose={() => setNetworkAlertDismissed(true)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert
          onClose={() => setNetworkAlertDismissed(true)}
          severity={networkAlertSeverity}
          sx={{ width: '100%' }}
        >
          {networkAlertMessage}
        </Alert>
      </Snackbar>
      <MainLayout
        conversations={conversations}
        selectedConversationId={selectedConversationId}
        onSelectConversation={setSelectedConversationId}
        activeView={activeView}
        setActiveView={setActiveView}
        mode={colorMode}
        toggleColorMode={toggleColorMode}
        peerId={liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId}
        userName={account.displayName}
        localPeerStatus={localPeerStatus}
        onCreateChat={handleCreateChat}
        onOpenSelectedContact={openSelectedContact}
        onBack={() => {
          if (activeView === 'contact') {
            setActiveView('chat');
            return;
          }
          setSelectedConversationId('');
        }}
      >
        {renderContent()}
      </MainLayout>
    </ThemeProvider>
  );
}
