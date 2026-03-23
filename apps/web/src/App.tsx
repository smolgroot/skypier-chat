import { createKeyCustodyPlan, createSecuritySummary } from '@skypier/crypto';
import { createPresence, createRuntimePlan, SKYPIER_MEDIA_PREFIX, type DeliveryStatusEvent, type PeerReachabilityEvent, type DialLogEntry } from '@skypier/network';
import { getCurrentDevice } from '@skypier/storage';
import { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { ThemeProvider, CssBaseline, Snackbar, Alert, Drawer, Box as MuiBox } from '@mui/material';
import { useChatController } from './useChatController';
import { useLiveChatSession } from './useLiveChatSession';
import { useNetworkLog } from './useNetworkLog';
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
import { ContactsPage } from './components/ContactsPage';
import { useNotifications } from './hooks/useNotifications';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { MessageRetryDrawer } from './components/MessageRetryDrawer';
import type { ChatMessage } from '@skypier/protocol';

const PLACEHOLDER_LOCAL_PEER_ID = '12D3KooWLocalPeer';

function isPlaceholderLocalPeerId(peerId: string | undefined): boolean {
  if (!peerId) return true;
  return peerId === PLACEHOLDER_LOCAL_PEER_ID || peerId.includes('LocalPeer');
}

function findRemoteParticipant(
  participants: Array<{ peerId: string }>,
  localId: string,
): { peerId: string } | undefined {
  return participants.find((p) => p.peerId !== localId && !isPlaceholderLocalPeerId(p.peerId))
    ?? participants.find((p) => p.peerId !== localId)
    ?? participants[0];
}

const OFFLINE_ALERT_MESSAGE = "You're offline. Couldn't connect to send new messages.";

function sanitizeReturnToPath(value: unknown): string {
  if (typeof value !== 'string') {
    return '/chats';
  }

  if (!value.startsWith('/') || value.startsWith('//')) {
    return '/chats';
  }

  if (value === '/splash' || value === '/onboarding' || value === '/unlock') {
    return '/chats';
  }

  return value;
}

function pathForView(view: 'chat' | 'profile' | 'settings' | 'network' | 'contacts'): string {
  switch (view) {
    case 'profile':
      return '/profile';
    case 'settings':
      return '/settings';
    case 'network':
      return '/network';
    case 'contacts':
      return '/contacts';
    case 'chat':
    default:
      return '/chats';
  }
}

function resolveActiveView(pathname: string): 'chat' | 'profile' | 'settings' | 'network' | 'contacts' {
  if (pathname.startsWith('/profile')) return 'profile';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/network')) return 'network';
  if (pathname.startsWith('/contacts')) return 'contacts';
  return 'chat';
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();

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
    deleteConversation,
    sendMessage,
    sendImageMessage,
    replyTarget,
    clearReplyTarget,
    selectReplyTarget,
    toggleReaction,
    ingestIncomingEnvelope,
    updateMessageDeliveryStatus,
    getRecentMessagesForPeer,
    linkEthAddress,
    unlinkEthAddress,
    exportBackup,
    lastBackupChecksum,
    storageMode,
    isLoaded,
    updateAccount,
    identityProtobuf,
    localPeerId,
    contacts,
    saveContact,
    deleteContact,
  } = useChatController();

  const activeView = resolveActiveView(location.pathname);
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');
  const [peerIdInput, setPeerIdInput] = useState('');
  const [dialError, setDialError] = useState<string | undefined>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | undefined>();
  const [networkAlertDismissed, setNetworkAlertDismissed] = useState(false);
  const [biometricSessionUnlocked, setBiometricSessionUnlocked] = useState(false);
  const [contactDialBusy, setContactDialBusy] = useState(false);
  const [contactDialError, setContactDialError] = useState<string | undefined>();
  const [contactDialSuccess, setContactDialSuccess] = useState<string | undefined>();
  const [dialLogs, setDialLogs] = useState<DialLogEntry[]>([]);
  const [isBrowserOffline, setIsBrowserOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const [offlineAlertOpen, setOfflineAlertOpen] = useState(false);
  const [showRetryDetails, setShowRetryDetails] = useState(false);
  const deepLinkBaseInjectedRef = useRef(false);

  const chatContactMatch = matchPath('/chats/:conversationId/contact', location.pathname);
  const chatMatch = matchPath('/chats/:conversationId', location.pathname);
  const routeConversationId = chatContactMatch?.params.conversationId
    ?? (location.pathname.startsWith('/chats/') ? chatMatch?.params.conversationId : undefined);
  const isChatContactRoute = chatContactMatch != null;
  const isChatRoute = location.pathname === '/chats' || routeConversationId != null;

  const networkLog = useNetworkLog();
  const currentTheme = useMemo(() => theme(colorMode), [colorMode]);
  const { notifyIncomingMessage } = useNotifications();

  const showOfflineAlert = useCallback(() => {
    setOfflineAlertOpen(true);
  }, []);

  const handleInboundMessage = useCallback(async ({ fromPeerId, envelope }: { fromPeerId: string; envelope: { kind: 'message' | 'receipt' | 'presence' | 'sync'; conversationId: string; senderPeerId: string; sentAt: string; payload: string } }) => {
    console.log('[skypier:app] \u21d0 inbound message from', fromPeerId, '\u2014 kind:', envelope.kind, 'conv:', envelope.conversationId, 'payload:', envelope.payload.slice(0, 80));
    await ingestIncomingEnvelope(envelope, fromPeerId);

    // Sound + OS notification for actual chat messages
    if (envelope.kind === 'message') {
      notifyIncomingMessage({
        senderName: `Peer ${fromPeerId.slice(0, 10)}…`,
        messagePreview: envelope.payload.startsWith(SKYPIER_MEDIA_PREFIX) ? '📷 Photo' : envelope.payload,
      });
    }
  }, [ingestIncomingEnvelope, notifyIncomingMessage]);

  const handlePeerReachabilityChange = useCallback(({ peerId, reachability }: PeerReachabilityEvent) => {
    void updateConversationConnection(peerId, { reachability });
  }, [updateConversationConnection]);

  const handleDeliveryStatus = useCallback(({ messageId, status }: DeliveryStatusEvent) => {
    const deliveryMap: Record<string, 'sent' | 'delivered' | 'local-only'> = {
      sent: 'sent',
      delivered: 'delivered',
      failed: 'local-only', // revert to local-only so the user knows it failed
    };
    const delivery = deliveryMap[status] ?? 'local-only';
    console.log('[skypier:app] delivery status:', messageId, '→', delivery);
    void updateMessageDeliveryStatus(messageId, delivery);
  }, [updateMessageDeliveryStatus]);

  const {
    state: liveState,
    connectedPeers,
    startSession,
    stopSession,
    recoverConnectivity,
    dialPeer,
    dialPeerById,
    broadcastChatMessage,
    sendChatMessageToPeer,
    retryMessage,
    getDebugInfo,
  } = useLiveChatSession({
    onInboundMessage: handleInboundMessage,
    onPeerReachabilityChange: handlePeerReachabilityChange,
    onDeliveryStatus: handleDeliveryStatus,
    onDialLog: (log) => setDialLogs(prev => [...prev, log]),
    onSyncRequest: getRecentMessagesForPeer,
    identityProtobuf
  });

  const lastRecoveryAtRef = useRef(0);

  useEffect(() => {
    if (!liveState.localPeerId) return;
    if (account.localPeerId === liveState.localPeerId) return;
    void updateAccount({ localPeerId: liveState.localPeerId });
  }, [account.localPeerId, liveState.localPeerId, updateAccount]);

  // Automatically start the session once the app is loaded
  useEffect(() => {
    if (isLoaded && liveState.status === 'idle') {
      void startSession().catch(console.error);
    }
  }, [isLoaded, liveState.status, startSession]);

  // Resume-driven connectivity recovery (no background libp2p daemon in SW).
  useEffect(() => {
    if (!isLoaded || !account.displayName || !identityProtobuf) {
      return;
    }

    const runRecovery = (reason: Parameters<typeof recoverConnectivity>[0]) => {
      const now = Date.now();
      if (now - lastRecoveryAtRef.current < 4_000) {
        return;
      }
      lastRecoveryAtRef.current = now;
      void recoverConnectivity(reason).catch((error) => {
        console.warn('[skypier:app] recoverConnectivity failed:', error instanceof Error ? error.message : error);
      });
    };

    const handleOnline = () => runRecovery('online');
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runRecovery('visibility');
      }
    };
    const handlePageShow = () => runRecovery('resume');
    const handleFocus = () => runRecovery('resume');
    const handleSwRecovery = () => runRecovery('service-worker');

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('skypier:recover-connectivity', handleSwRecovery as EventListener);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('skypier:recover-connectivity', handleSwRecovery as EventListener);
    };
  }, [isLoaded, account.displayName, identityProtobuf, recoverConnectivity]);

  useEffect(() => {
    const handleOffline = () => {
      setIsBrowserOffline(true);
      showOfflineAlert();
    };

    const handleOnline = () => {
      setIsBrowserOffline(false);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [showOfflineAlert]);

  useEffect(() => {
    const nextId = routeConversationId ?? '';
    if (selectedConversationId !== nextId) {
      setSelectedConversationId(nextId);
    }
  }, [routeConversationId, selectedConversationId, setSelectedConversationId]);

  useEffect(() => {
    if (!isLoaded) {
      if (location.pathname !== '/splash') {
        navigate('/splash', {
          replace: true,
          state: {
            returnTo: sanitizeReturnToPath(location.pathname),
          },
        });
      }
      return;
    }

    const needsOnboarding = !account.displayName || !identityProtobuf;
    if (needsOnboarding) {
      if (location.pathname !== '/onboarding') {
        navigate('/onboarding', {
          replace: true,
          state: {
            returnTo: sanitizeReturnToPath(location.pathname),
          },
        });
      }
      return;
    }

    const needsUnlock = account.biometricUnlockEnabled && !biometricSessionUnlocked;
    if (needsUnlock) {
      if (location.pathname !== '/unlock') {
        navigate('/unlock', {
          replace: true,
          state: {
            returnTo: sanitizeReturnToPath(location.pathname),
          },
        });
      }
      return;
    }

    if (location.pathname === '/' || location.pathname === '/splash' || location.pathname === '/onboarding' || location.pathname === '/unlock') {
      const fromState = (location.state as { returnTo?: string } | null)?.returnTo;
      const returnTo = sanitizeReturnToPath(fromState);
      navigate(returnTo === '/splash' ? '/chats' : returnTo, { replace: true });
    }
  }, [
    account.biometricUnlockEnabled,
    account.displayName,
    biometricSessionUnlocked,
    identityProtobuf,
    isLoaded,
    location.pathname,
    location.state,
    navigate,
  ]);

  useEffect(() => {
    if (!routeConversationId || deepLinkBaseInjectedRef.current) {
      return;
    }

    const state = location.state as { __baseInjected?: boolean } | null;
    if (state?.__baseInjected) {
      return;
    }

    if (window.history.length > 1) {
      return;
    }

    deepLinkBaseInjectedRef.current = true;
    const targetPath = location.pathname;
    navigate('/chats', { replace: true, state: { __baseInjected: true } });
    setTimeout(() => {
      navigate(targetPath, { replace: false, state: { __fromBaseInjection: true } });
    }, 0);
  }, [location.pathname, location.state, navigate, routeConversationId]);

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
      setBiometricSessionUnlocked(false);
    }
  }, [updateAccount]);

  const handleBiometricUnlocked = useCallback(() => {
    setBiometricSessionUnlocked(true);
  }, []);

  const handleCreateChat = useCallback(async (peerId: string, displayName?: string) => {
    const conversationId = await createConversationWithPeer(peerId, displayName);
    navigate(`/chats/${conversationId}`);

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
  }, [createConversationWithPeer, dialPeerById, liveState.status, navigate, updateConversationConnection]);

  const openSelectedContact = useCallback(() => {
    if (!selectedConversationId) {
      return;
    }
    setContactDialError(undefined);
    setContactDialSuccess(undefined);
    navigate(`/chats/${selectedConversationId}/contact`);
  }, [navigate, selectedConversationId]);

  const handleContactDial = useCallback(async (peerId: string) => {
    setContactDialBusy(true);
    setContactDialError(undefined);
    setContactDialSuccess(undefined);
    setDialLogs([]);

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

  // Auto-dial: whenever the user opens a conversation (or the session finishes starting),
  // attempt a background connection to the remote peer if not already connected.
  // dialPeerById already does DHT/relay routing, so this is fully async peer-finding.
  useEffect(() => {
    if (!selectedConversationId || liveState.status !== 'running') return;
    const localId = liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId;
    const conv = conversations.find((c) => c.id === selectedConversationId);
    const remotePeer = conv?.participants.find((p) => p.peerId !== localId);
    if (!remotePeer) return;
    const remotePeerId = remotePeer.peerId;
    // Skip if already live
    if (connectedPeers.includes(remotePeerId)) return;
    console.log('[skypier:app] auto-dial: opening conversation with', remotePeerId);
    void dialPeerById(remotePeerId)
      .then(() => void updateConversationConnection(remotePeerId, { reachability: 'direct' }))
      .catch((err) => console.warn('[skypier:app] auto-dial failed:', err instanceof Error ? err.message : err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId, liveState.status]);

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

  const unsentMessages = useMemo(
    () => messages
      .filter((message) => ['sending', 'queued', 'local-only'].includes(message.delivery))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [messages],
  );

  useEffect(() => {
    setShowRetryDetails(false);
  }, [selectedConversationId]);

  const retryConversationMessage = useCallback(async (message: ChatMessage) => {
    if (!selectedConversation) {
      return false;
    }

    if (!navigator.onLine || isBrowserOffline) {
      await updateMessageDeliveryStatus(message.id, 'local-only');
      showOfflineAlert();
      return false;
    }

    const remotePeer = findRemoteParticipant(
      selectedConversation.participants,
      liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId,
    );

    if (!remotePeer) {
      await updateMessageDeliveryStatus(message.id, 'local-only');
      return false;
    }

    await updateMessageDeliveryStatus(message.id, 'sending');

    if (message.delivery === 'queued') {
      const retriedQueuedMessage = await retryMessage(message.id);
      if (retriedQueuedMessage) {
        return true;
      }
    }

    const sent = await sendChatMessageToPeer(message, remotePeer.peerId);
    await updateMessageDeliveryStatus(message.id, sent ? 'sent' : 'queued');
    return sent;
  }, [
    isBrowserOffline,
    liveState.localPeerId,
    localPeerId,
    retryMessage,
    selectedConversation,
    sendChatMessageToPeer,
    showOfflineAlert,
    updateMessageDeliveryStatus,
  ]);

  const renderContent = () => {
    if (location.pathname === '/contacts') {
      return (
        <ContactsPage
          contacts={contacts}
          onSaveContact={saveContact}
          onDeleteContact={deleteContact}
          onStartChat={async (peerId, displayName) => {
            const convId = await createConversationWithPeer(peerId, displayName);
            navigate(`/chats/${convId}`);
          }}
        />
      );
    }

    if (location.pathname === '/profile') {
      return (
        <ProfilePage 
          peerId={liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId} 
          displayName={account.displayName}
          linkedWallets={account.linkedEthAddresses} 
        />
      );
    }

    if (location.pathname === '/settings') {
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
          dialPeer={dialPeer}
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

    if (location.pathname === '/network') {
      return (
        <NetworkStatusPage sessionState={liveState} networkLog={networkLog} getDebugInfo={getDebugInfo} />
      );
    }

    if (routeConversationId && !selectedConversation) {
      return (
        <MuiBox sx={{ height: '100%', display: 'grid', placeItems: 'center', px: 3 }}>
          <MuiBox sx={{ textAlign: 'center', maxWidth: 420 }}>
            <Alert severity="warning" sx={{ mb: 2 }}>This chat was not found.</Alert>
            <MuiBox sx={{ display: 'flex', justifyContent: 'center', gap: 1.5 }}>
              <button
                type="button"
                onClick={() => navigate('/chats')}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Back to chats
              </button>
            </MuiBox>
          </MuiBox>
        </MuiBox>
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
          onOpenRetryDetails={() => setShowRetryDetails(true)}
          onSendMessage={() => {
            void (async () => {
              const message = await sendMessage();
              if (message && selectedConversation) {
                if (!navigator.onLine || isBrowserOffline) {
                  await updateMessageDeliveryStatus(message.id, 'local-only');
                  showOfflineAlert();
                  return;
                }

                // Find the remote peer in the conversation to send targeted
                const remotePeer = findRemoteParticipant(
                  selectedConversation.participants,
                  liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId,
                );
                if (remotePeer) {
                  console.log('[skypier:app] \u21d2 sending message to peer', remotePeer.peerId, 'conv:', message.conversationId);
                  const sent = await sendChatMessageToPeer(message, remotePeer.peerId);
                  if (!sent) {
                    // Not sent immediately (likely dialing / transient network): keep queued.
                    await updateMessageDeliveryStatus(message.id, 'queued');
                    if (!navigator.onLine) {
                      showOfflineAlert();
                    }
                  }
                } else {
                  await updateMessageDeliveryStatus(message.id, 'local-only');
                }
              }
            })();
          }}
          onRetryMessage={(messageId) => {
            const retryTarget = messages.find((message) => message.id === messageId);
            if (!retryTarget) {
              return;
            }
            void retryConversationMessage(retryTarget);
          }}
          onReplySelect={selectReplyTarget}
          onSendImage={(file) => {
            void (async () => {
              try {
                const message = await sendImageMessage(file);
                if (message && selectedConversation) {
                  if (!navigator.onLine || isBrowserOffline) {
                    await updateMessageDeliveryStatus(message.id, 'local-only');
                    showOfflineAlert();
                    return;
                  }

                  const remotePeer = findRemoteParticipant(
                    selectedConversation.participants,
                    liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId,
                  );
                  if (remotePeer) {
                    const sent = await sendChatMessageToPeer(message, remotePeer.peerId);
                    if (!sent) {
                      await updateMessageDeliveryStatus(message.id, 'queued');
                      if (!navigator.onLine) {
                        showOfflineAlert();
                      }
                    }
                  } else {
                    await updateMessageDeliveryStatus(message.id, 'local-only');
                  }
                }
              } catch (err) {
                console.error('[skypier:app] image send failed:', err instanceof Error ? err.message : err);
              }
            })();
          }}
        />
      );
    }

    if (location.pathname !== '/chats') {
      return (
        <MuiBox sx={{ height: '100%', display: 'grid', placeItems: 'center', px: 3 }}>
          <Alert severity="info">Page not found. Redirecting to chats is available from the menu.</Alert>
        </MuiBox>
      );
    }

    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
        <h3>Select a chat to start messaging</h3>
      </div>
    );
  };

  const isSplashRoute = location.pathname === '/splash';
  const isOnboardingRoute = location.pathname === '/onboarding';
  const isUnlockRoute = location.pathname === '/unlock';
  const showContactDetail = isChatContactRoute && !!selectedConversation;

  return (
    <ThemeProvider theme={currentTheme}>
      <CssBaseline />

      {isSplashRoute ? <SplashScreen /> : null}

      {isOnboardingRoute ? (
        <OnboardingWizard
          onComplete={(data) => {
            void updateAccount(data);
            const returnTo = sanitizeReturnToPath((location.state as { returnTo?: string } | null)?.returnTo);
            navigate(returnTo, { replace: true });
          }}
        />
      ) : null}

      {isUnlockRoute ? (
        <>
          <BiometricUnlock
            open
            passkeyCredentialId={account.biometricCredentialId}
            userDisplayName={account.displayName}
            onPasskeyCreated={(credentialId) => {
              void updateAccount({ biometricCredentialId: credentialId });
            }}
            onUnlocked={() => {
              handleBiometricUnlocked();
              const returnTo = sanitizeReturnToPath((location.state as { returnTo?: string } | null)?.returnTo);
              navigate(returnTo, { replace: true });
            }}
            onCancel={() => {
              handleBiometricUnlocked();
              navigate('/chats', { replace: true });
            }}
          />
          <MuiBox sx={{ height: '100dvh' }} />
        </>
      ) : null}

      {!isSplashRoute && !isOnboardingRoute && !isUnlockRoute ? (
        <>
          <Drawer
        anchor="bottom"
        open={showContactDetail}
        onClose={() => {
          if (window.history.length > 1) {
            navigate(-1);
          } else if (selectedConversationId) {
            navigate(`/chats/${selectedConversationId}`, { replace: true });
          } else {
            navigate('/chats', { replace: true });
          }
        }}
        slotProps={{
          backdrop: {
            sx: {
              backdropFilter: 'blur(12px) saturate(160%)',
              WebkitBackdropFilter: 'blur(12px) saturate(160%)',
              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)',
            }
          }
        }}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(14, 8, 28, 0.4)' : 'rgba(255, 255, 255, 0.2)',
            backdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
            WebkitBackdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
            filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
            border: (theme) => 
               theme.palette.mode === 'dark' 
                ? '1px solid rgba(171, 110, 255, 0.25)' 
                : '1px solid rgba(0, 0, 0, 0.08)',
            boxShadow: '0 -8px 32px rgba(0,0,0,0.3)',
            maxHeight: '85vh'
          }
        }}
      >
        {selectedConversation && (
          <ContactDetailPage
            conversation={selectedConversation}
            localPeerId={liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId}
            isDialing={contactDialBusy}
            dialError={contactDialError}
            dialSuccess={contactDialSuccess}
            dialLogs={dialLogs}
            onDialPeer={(peerId) => { void handleContactDial(peerId); }}
            onOpenChat={() => {
              navigate(`/chats/${selectedConversation.id}`);
            }}
          />
        )}
      </Drawer>

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
      <Snackbar
        open={offlineAlertOpen}
        autoHideDuration={4500}
        onClose={() => setOfflineAlertOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setOfflineAlertOpen(false)}
          severity="warning"
          sx={{ width: '100%' }}
        >
          {OFFLINE_ALERT_MESSAGE}
        </Alert>
      </Snackbar>
      <MessageRetryDrawer
        open={showRetryDetails}
        onClose={() => setShowRetryDetails(false)}
        conversationTitle={selectedConversation?.title ?? 'Delivery details'}
        messages={unsentMessages}
        sessionState={liveState}
        onRetryMessage={(message) => {
          void retryConversationMessage(message);
        }}
      />
      <MainLayout
        conversations={conversations}
        selectedConversationId={selectedConversationId}
        onSelectConversation={(id) => {
          setSelectedConversationId(id);
          navigate(`/chats/${id}`);
        }}
        activeView={activeView}
        setActiveView={(view) => {
          navigate(pathForView(view));
        }}
        mode={colorMode}
        toggleColorMode={toggleColorMode}
        peerId={liveState.localPeerId ?? localPeerId ?? getCurrentDevice().peerId}
        userName={account.displayName}
        localPeerStatus={localPeerStatus}
        linkedWallets={account.linkedEthAddresses}
        onCreateChat={handleCreateChat}
        onDeleteConversation={(id) => void deleteConversation(id)}
        onOpenSelectedContact={openSelectedContact}
        onBack={() => {
          if (window.history.length > 1) {
            navigate(-1);
            return;
          }
          navigate('/chats', { replace: true });
        }}
      >
        {renderContent()}
      </MainLayout>
        </>
      ) : null}
    </ThemeProvider>
  );
}
