import { createKeyCustodyPlan, createSecuritySummary } from '@skypier/crypto';
import { createPresence, createRuntimePlan, type PeerReachabilityEvent } from '@skypier/network';
import { getCurrentDevice } from '@skypier/storage';
import { useCallback, useState, useMemo } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { useChatController } from './useChatController';
import { useLiveChatSession } from './useLiveChatSession';
import { connectAndLinkEthWallet } from './walletLinking';
import { theme } from './theme';
import { MainLayout } from './components/MainLayout';
import { ChatThread } from './components/ChatThread';
import { ProfilePage } from './components/ProfilePage';
import { SettingsPage } from './components/SettingsPage';

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
  } = useChatController();

  const [activeView, setActiveView] = useState<'chat' | 'profile' | 'settings'>('chat');
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark');
  const [peerIdInput, setPeerIdInput] = useState('');
  const [dialError, setDialError] = useState<string | undefined>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | undefined>();

  const currentTheme = useMemo(() => theme(colorMode), [colorMode]);

  const handleInboundMessage = useCallback(async ({ fromPeerId, envelope }: { fromPeerId: string; envelope: { kind: 'message' | 'receipt' | 'presence' | 'sync'; conversationId: string; senderPeerId: string; sentAt: string; payload: string } }) => {
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
  } = useLiveChatSession({ onInboundMessage: handleInboundMessage, onPeerReachabilityChange: handlePeerReachabilityChange });

  const handleLinkWallet = useCallback(() => {
    void (async () => {
      try {
        setWalletBusy(true);
        setWalletError(undefined);
        const linked = await connectAndLinkEthWallet(liveState.localPeerId ?? getCurrentDevice().peerId);
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

  const renderContent = () => {
    if (activeView === 'profile') {
      return (
        <ProfilePage 
          peerId={liveState.localPeerId ?? getCurrentDevice().peerId} 
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
        />
      );
    }

    if (selectedConversation) {
      return (
        <ChatThread 
          conversation={selectedConversation}
          messages={messages}
          composerValue={composerValue}
          replyTarget={replyTarget}
          onComposerChange={setComposerValue}
          onReplyClear={clearReplyTarget}
          onToggleReaction={toggleReaction}
          onSendMessage={() => {
            void (async () => {
              const message = await sendMessage();
              if (message) {
                await broadcastChatMessage(message);
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

  return (
    <ThemeProvider theme={currentTheme}>
      <CssBaseline />
      <MainLayout
        conversations={conversations}
        selectedConversationId={selectedConversationId}
        onSelectConversation={setSelectedConversationId}
        activeView={activeView}
        setActiveView={setActiveView}
        mode={colorMode}
        toggleColorMode={toggleColorMode}
        peerId={liveState.localPeerId ?? getCurrentDevice().peerId}
        userName={account.displayName}
        onCreateChat={handleCreateChat}
        onBack={() => setSelectedConversationId('')}
      >
        {renderContent()}
      </MainLayout>
    </ThemeProvider>
  );
}
