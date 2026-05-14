import { 
  Box, 
  Drawer, 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText, 
  Typography, 
  IconButton, 
  Divider,
  AppBar,
  Toolbar,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Badge,
  Chip,
  Checkbox,
  useTheme,
  useMediaQuery
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import SettingsIcon from '@mui/icons-material/Settings';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import PeopleIcon from '@mui/icons-material/People';
import MenuIcon from '@mui/icons-material/Menu';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import CallIcon from '@mui/icons-material/Call';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import { useState } from 'react';
import type { Conversation } from '@skypier/protocol';
import type { Contact } from '@skypier/storage';
import { reachabilityColor, reachabilityLabel } from '@skypier/network';
import { UserAvatar } from './UserAvatar';
import { useENS } from '../hooks/useENS';
import { ChatList } from './ChatList';

const SIDEBAR_WIDTH = 320;

interface MainLayoutProps {
  conversations: Conversation[];
  selectedConversationId?: string;
  onSelectConversation: (id: string) => void;
  activeView: 'chat' | 'profile' | 'settings' | 'network' | 'contacts';
  setActiveView: (view: 'chat' | 'profile' | 'settings' | 'network' | 'contacts') => void;
  children: React.ReactNode;
  mode: 'light' | 'dark';
  toggleColorMode: () => void;
  peerId: string;
  userName: string;
  localPeerStatus: 'online' | 'connecting' | 'offline';
  onCreateChat: (peerId: string, displayName?: string) => Promise<void> | void;
  onCreateGroupChat?: (peerIds: string[], title?: string) => Promise<void> | void;
  onDeleteConversation?: (conversationId: string) => void;
  onBack?: () => void; // New prop for mobile navigation back
  onOpenSelectedContact?: () => void;
  linkedWallets?: { address: string; chainId: number }[];
  localAvatarUrl?: string;
  avatarByPeerId?: Record<string, string | undefined>;
  onOpenRetryDetails?: () => void;
  retryBadgeCount?: number;
  onStartCall?: () => void;
  callButtonDisabled?: boolean;
  contacts?: Contact[];
}

export function MainLayout(props: MainLayoutProps) {
  const { 
    conversations, 
    selectedConversationId, 
    onSelectConversation, 
    activeView, 
    setActiveView, 
    children, 
    mode, 
    toggleColorMode,
    peerId,
    userName, 
    localPeerStatus, 
    onCreateChat, 
    onCreateGroupChat,
    onDeleteConversation,
    onBack,
    onOpenSelectedContact,
    linkedWallets = [],
    localAvatarUrl,
    avatarByPeerId = {},
    onOpenRetryDetails,
    retryBadgeCount = 0,
    onStartCall,
    callButtonDisabled,
    contacts = [],
  } = props;

  const firstWallet = linkedWallets[0]?.address;
  const { name: ensName, avatar: ensAvatar } = useENS(firstWallet);

  const localPeerStatusLabel =
    localPeerStatus === 'online'
      ? 'Local peer online'
      : localPeerStatus === 'connecting'
        ? 'Local peer connecting…'
        : 'Local peer offline';
  
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatPeerId, setNewChatPeerId] = useState('');
  const [newChatDisplayName, setNewChatDisplayName] = useState('');
  const [newChatError, setNewChatError] = useState<string | undefined>();
  const [creatingChat, setCreatingChat] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupSelection, setNewGroupSelection] = useState<Record<string, boolean>>({});
  const [newGroupError, setNewGroupError] = useState<string | undefined>();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId);
  const selectedConversationParticipants = selectedConversation?.participants.filter((participant) => participant.peerId !== peerId) ?? [];
  const selectedIsGroupConversation = Boolean(selectedConversation && ((selectedConversation.kind === 'group') || selectedConversationParticipants.length > 1));
  const selectedGroupSummary = selectedIsGroupConversation
    ? `${selectedConversationParticipants.length + 1} members · ${selectedConversationParticipants.slice(0, 2).map((participant) => participant.displayName).join(', ')}${selectedConversationParticipants.length > 2 ? ` +${selectedConversationParticipants.length - 2}` : ''}`
    : undefined;
  const selectedRemotePeer = selectedConversation?.participants.find((participant) => participant.peerId !== peerId)
    ?? selectedConversation?.participants[0];
  const selectedRemoteAvatarUrl = selectedRemotePeer?.peerId ? avatarByPeerId[selectedRemotePeer.peerId] : undefined;

  // Determine if we should show the back button on mobile.
  // We show it if we're on mobile and a conversation is selected while in chat view.
  const showBackButton = isMobile && (activeView === 'chat' && !!selectedConversationId);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleCreateChat = async () => {
    try {
      if (!newChatPeerId.trim()) {
        setNewChatError('Peer ID is required.');
        return;
      }

      setCreatingChat(true);
      setNewChatError(undefined);
      await onCreateChat(newChatPeerId, newChatDisplayName);
      setNewChatOpen(false);
      setNewChatPeerId('');
      setNewChatDisplayName('');
    } catch (error) {
      setNewChatError(error instanceof Error ? error.message : 'Failed to create chat');
    } finally {
      setCreatingChat(false);
    }
  };

  const handleNewChatMode = (mode: 'direct' | 'group') => {
    if (mode === 'group') {
      setNewGroupOpen(true);
      return;
    }

    setNewChatOpen(true);
  };

  const handleToggleGroupContact = (peerIdToToggle: string) => {
    setNewGroupSelection((prev) => ({
      ...prev,
      [peerIdToToggle]: !prev[peerIdToToggle],
    }));
  };

  const selectedGroupContacts = contacts.filter((contact) => newGroupSelection[contact.peerId]);

  const handleCreateGroup = async () => {
    if (!onCreateGroupChat) {
      setNewGroupError('Group chat is not available yet.');
      return;
    }

    const peerIds = selectedGroupContacts.map((contact) => contact.peerId);
    if (peerIds.length < 2) {
      setNewGroupError('Select at least two contacts.');
      return;
    }

    try {
      setCreatingGroup(true);
      setNewGroupError(undefined);
      await onCreateGroupChat(peerIds, newGroupName.trim() || undefined);
      setNewGroupOpen(false);
      setNewGroupSelection({});
      setNewGroupName('');
    } catch (error) {
      setNewGroupError(error instanceof Error ? error.message : 'Failed to create group chat');
    } finally {
      setCreatingGroup(false);
    }
  };

  const drawerContent = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: 'transparent',
      }}
    >
      {isMobile && <Toolbar sx={{ pt: 'env(safe-area-inset-top)' }} />}
      <Box 
        sx={{ 
          p: 2, 
          display: 'flex', 
          alignItems: 'center', 
          gap: 2,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' }
        }}
        onClick={() => { setActiveView('profile'); if(isMobile) setMobileOpen(false); }}
      >
        <UserAvatar seed={peerId} size={40} src={localAvatarUrl ?? ensAvatar} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 'bold' }}>
            {ensName || userName}
          </Typography>
          {ensName && (
            <Typography variant="caption" noWrap sx={{ display: 'block', mt: -0.5, opacity: 0.7 }}>
              {userName}
            </Typography>
          )}
          <Typography
            variant="caption"
            noWrap
            sx={{ display: 'block' }}
            color={localPeerStatus === 'online' ? 'success.main' : localPeerStatus === 'connecting' ? 'warning.main' : 'error.main'}
          >
            {localPeerStatusLabel}
          </Typography>
        </Box>
        <IconButton 
          onClick={(e) => { 
            e.stopPropagation(); 
            toggleColorMode(); 
          }}
        >
          {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
      </Box>
      <Divider />
      <List sx={{ px: 1 }}>
        {isMobile && (
          <ListItem disablePadding>
            <ListItemButton 
              selected={activeView === 'chat'} 
              onClick={() => { setActiveView('chat'); if(isMobile) setMobileOpen(false); }}
              sx={{ borderRadius: 2 }}
            >
              <ListItemIcon><ChatIcon color={activeView === 'chat' ? 'primary' : 'inherit'} /></ListItemIcon>
              <ListItemText primary="All Chats" />
            </ListItemButton>
          </ListItem>
        )}
        <ListItem disablePadding>
          <ListItemButton 
            selected={activeView === 'contacts'} 
            onClick={() => { setActiveView('contacts'); if(isMobile) setMobileOpen(false); }}
            sx={{ borderRadius: 2 }}
          >
            <ListItemIcon><PeopleIcon color={activeView === 'contacts' ? 'primary' : 'inherit'} /></ListItemIcon>
            <ListItemText primary="Contacts" />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton 
            selected={activeView === 'network'} 
            onClick={() => { setActiveView('network'); if(isMobile) setMobileOpen(false); }}
            sx={{ borderRadius: 2 }}
          >
            <ListItemIcon><SettingsInputAntennaIcon color={activeView === 'network' ? 'primary' : 'inherit'} /></ListItemIcon>
            <ListItemText primary="P2P Status" />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding>
          <ListItemButton 
            selected={activeView === 'settings'} 
            onClick={() => { setActiveView('settings'); if(isMobile) setMobileOpen(false); }}
            sx={{ borderRadius: 2 }}
          >
            <ListItemIcon><SettingsIcon color={activeView === 'settings' ? 'primary' : 'inherit'} /></ListItemIcon>
            <ListItemText primary="Settings" />
          </ListItemButton>
        </ListItem>
      </List>
      <Divider />
      {!isMobile && (
        <ChatList 
          conversations={conversations}
          selectedConversationId={selectedConversationId}
          onSelectConversation={onSelectConversation}
          onNewChat={handleNewChatMode}
          onDeleteConversation={onDeleteConversation}
          localPeerId={peerId}
          avatarByPeerId={avatarByPeerId}
          dense
        />
      )}
    </Box>
  );

  return (
    <Box 
      sx={{ 
        display: 'flex', 
        height: '100dvh', 
        overflow: 'hidden',
        bgcolor: mode === 'dark' 
          ? '#030105' 
          : (activeView === 'chat' && !isMobile ? '#EEE' : (activeView === 'chat' && isMobile && selectedConversationId ? '#EEE' : '#ffffff')),
        backgroundImage: mode === 'dark'
          ? 'linear-gradient(to bottom, #030105, transparent, #030105), radial-gradient(circle, #281f3ab6 0%, #000 100%)'
          : (activeView === 'chat' 
              ? 'none' 
              : 'linear-gradient(to bottom, #ffffff, transparent, #ffffff), radial-gradient(circle, transparent 0%, #ffffff 70%)'),
        backgroundSize: '100% 100%, cover',
        backgroundRepeat: 'no-repeat, no-repeat',
        backgroundPosition: 'center'
      }}
    >
      <Dialog 
        open={newChatOpen} 
        onClose={() => setNewChatOpen(false)} 
        fullWidth 
        maxWidth="sm"
        PaperProps={{
          sx: {
            bgcolor: (theme) => 
              theme.palette.mode === 'dark' 
                ? 'rgba(14, 8, 28, 0.3)' 
                : 'rgba(255, 255, 255, 0.2)',
            backdropFilter: (theme) => `blur(15px) saturate(190%)`,
            WebkitBackdropFilter: (theme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
            filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
            border: (theme) => 
              theme.palette.mode === 'dark' 
                ? '1px solid rgba(171, 110, 255, 0.25)' 
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
        <DialogTitle sx={{ fontWeight: 'bold' }}>Start New Chat</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'grid', gap: 2 }}>
          <TextField
            label="Peer ID"
            placeholder="12D3KooW..."
            value={newChatPeerId}
            onChange={(event) => setNewChatPeerId(event.target.value)}
            fullWidth
            autoFocus
            variant="outlined"
            size="small"
          />
          <TextField
            label="Display Name (optional)"
            placeholder="Alice"
            value={newChatDisplayName}
            onChange={(event) => setNewChatDisplayName(event.target.value)}
            fullWidth
            variant="outlined"
            size="small"
          />
          {newChatError ? <Typography color="error" variant="caption">{newChatError}</Typography> : null}
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button onClick={() => setNewChatOpen(false)}>Cancel</Button>
          <Button onClick={() => { void handleCreateChat(); }} variant="contained" disabled={creatingChat}>
            {creatingChat ? 'Creating…' : 'Create Chat'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        fullWidth
        maxWidth="sm"
        PaperProps={{
          sx: {
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? 'rgba(14, 8, 28, 0.3)'
                : 'rgba(255, 255, 255, 0.2)',
            backdropFilter: (theme) => `blur(15px) saturate(190%)`,
            WebkitBackdropFilter: (theme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
            filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
            border: (theme) =>
              theme.palette.mode === 'dark'
                ? '1px solid rgba(171, 110, 255, 0.25)'
                : '1px solid rgba(0, 0, 0, 0.08)',
            borderRadius: 4,
            backgroundImage: 'none',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 'bold' }}>Create New Group</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'grid', gap: 2 }}>
          <TextField
            label="Group Name (optional)"
            placeholder="Weekend Crew"
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.target.value)}
            fullWidth
            size="small"
          />

          <Box sx={{ maxHeight: 280, overflowY: 'auto', borderRadius: 2, bgcolor: 'rgba(0,0,0,0.03)' }}>
            <List dense>
              {contacts.map((contact) => (
                <ListItemButton key={`new-group-${contact.id}`} onClick={() => handleToggleGroupContact(contact.peerId)}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <Checkbox edge="start" checked={Boolean(newGroupSelection[contact.peerId])} tabIndex={-1} disableRipple />
                  </ListItemIcon>
                  <ListItemIcon sx={{ minWidth: 42 }}>
                    <UserAvatar seed={contact.peerId} size={28} src={contact.avatarUrl ?? undefined} />
                  </ListItemIcon>
                  <ListItemText
                    primary={contact.displayName}
                    secondary={contact.peerId.slice(0, 16) + '…'}
                    secondaryTypographyProps={{ sx: { fontFamily: 'monospace' } }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>

          {newGroupError ? <Typography color="error" variant="caption">{newGroupError}</Typography> : null}
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button onClick={() => setNewGroupOpen(false)}>Cancel</Button>
          <Button onClick={() => { void handleCreateGroup(); }} variant="contained" disabled={creatingGroup || selectedGroupContacts.length < 2}>
            {creatingGroup ? 'Creating…' : `Create Group (${selectedGroupContacts.length})`}
          </Button>
        </DialogActions>
      </Dialog>

      {isMobile && (
        <AppBar 
          position="fixed" 
          elevation={0}
          sx={{ 
            bgcolor: (theme) => 
               theme.palette.mode === 'dark' 
                ? 'rgba(14, 8, 28, 0.3)' 
                : 'rgba(255, 255, 255, 0.3)',
            backdropFilter: (theme) => `blur(15px) saturate(190%)`,
            WebkitBackdropFilter: (theme) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
            filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
            border: (theme) => 
               theme.palette.mode === 'dark' 
                ? '1px solid rgba(171, 110, 255, 0.25)' 
                : '1px solid rgba(0, 0, 0, 0.08)',
            color: 'text.primary',
            borderRadius: 100, 
            left: 12,
            right: 12,
            mt: 'calc(env(safe-area-inset-top) + 12px)',
            width: 'auto',
            zIndex: (theme) => theme.zIndex.drawer - 1,
            boxShadow: (theme) => 
              theme.palette.mode === 'dark'
                ? '0 8px 32px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.05)'
                : '0 8px 32px rgba(31, 38, 135, 0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.2)',
            backgroundImage: (theme) => 
              theme.palette.mode === 'dark'
                ? 'linear-gradient(135deg, rgba(142, 45, 226, 0.05) 0%, rgba(74, 0, 224, 0.05) 100%)'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)'
          }}
        >
          <Toolbar>
            {showBackButton ? (
              <IconButton edge="start" onClick={onBack} sx={{ mr: 2 }}>
                <ArrowBackIcon />
              </IconButton>
            ) : (
              <IconButton edge="start" onClick={handleDrawerToggle} sx={{ mr: 2 }}>
                <MenuIcon />
              </IconButton>
            )}
            <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
              {activeView === 'chat' && selectedConversationId ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <IconButton
                    onClick={onOpenSelectedContact}
                    size="small"
                    sx={{ p: 0 }}
                    aria-label="Open contact details"
                  >
                    <UserAvatar seed={selectedRemotePeer?.peerId ?? selectedConversationId} size={32} src={selectedRemoteAvatarUrl} />
                  </IconButton>
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                        {selectedConversation?.title || 'Chat'}
                      </Typography>
                      {selectedIsGroupConversation ? (
                        <Chip label={`${selectedConversationParticipants.length + 1}`} size="small" variant="outlined" sx={{ height: 18 }} />
                      ) : null}
                    </Box>
                    <Typography variant="caption" sx={{ opacity: 0.8, lineHeight: 1 }}>
                      {selectedGroupSummary ?? reachabilityLabel(selectedConversation?.reachability ?? 'unknown')}
                    </Typography>
                  </Box>
                </Box>
              ) : (
                activeView === 'chat' ? 'Skypier dM' : 
                activeView === 'network' ? 'P2P Status' :
                activeView.charAt(0).toUpperCase() + activeView.slice(1)
              )}
            </Typography>
            {isMobile && activeView === 'chat' && selectedConversationId ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <IconButton
                  onClick={onStartCall}
                  aria-label="Start audio call"
                  disabled={callButtonDisabled || !onStartCall}
                  size="small"
                >
                  <CallIcon fontSize="small" />
                </IconButton>
                <IconButton
                  onClick={onOpenRetryDetails}
                  aria-label="Open delivery details"
                  size="small"
                >
                  <Badge badgeContent={retryBadgeCount} color="warning" invisible={retryBadgeCount === 0}>
                    <AutorenewIcon fontSize="small" />
                  </Badge>
                </IconButton>
              </Box>
            ) : null}
          </Toolbar>
        </AppBar>
      )}

      {/* Navigation Sidebar (Desktop) */}
      {!isMobile && (
        <Box
          component="nav"
          sx={{ width: SIDEBAR_WIDTH, flexShrink: 0 }}
        >
          <Drawer
            variant="permanent"
            sx={{
              height: '100%',
              '& .MuiDrawer-paper': { 
                boxSizing: 'border-box', 
                width: SIDEBAR_WIDTH, 
                height: '100%', 
                position: 'static',
                bgcolor: (theme) => 
                  theme.palette.mode === 'dark' 
                    ? 'rgba(10, 5, 20, 0.2)' 
                    : 'rgba(255, 255, 255, 0.65)',
                backdropFilter: 'blur(15px) saturate(190%)',
                WebkitBackdropFilter: 'blur(15px) saturate(190%)',
                '@supports (backdrop-filter: url(#test)) or (-webkit-backdrop-filter: url(#test))': {
                  backdropFilter: (theme: any) => `blur(15px) saturate(190%)`,
                  WebkitBackdropFilter: (theme: any) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
                  filter: (theme: any) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
                },
                borderRight: (theme) => 
                  theme.palette.mode === 'dark' 
                    ? '1px solid rgba(171, 110, 255, 0.15)' 
                    : '1px solid rgba(255, 255, 255, 0.6)',
              },
            }}
            open
          >
            {drawerContent}
          </Drawer>
        </Box>
      )}

      {/* Navigation Drawer (Mobile) */}
      {isMobile && (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': { 
              boxSizing: 'border-box', 
              width: SIDEBAR_WIDTH, 
              zIndex: 1201,
              bgcolor: (theme) => 
                theme.palette.mode === 'dark' 
                  ? 'rgba(10, 5, 20, 0.2)' 
                  : 'rgba(255, 255, 255, 0.65)',
              backdropFilter: 'blur(15px) saturate(190%)',
              WebkitBackdropFilter: 'blur(15px) saturate(190%)',
              '@supports (backdrop-filter: url(#test)) or (-webkit-backdrop-filter: url(#test))': {
                backdropFilter: (theme: any) => `blur(15px) saturate(190%)`,
                WebkitBackdropFilter: (theme: any) => `blur(15px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
                filter: (theme: any) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
              },
              borderRight: (theme) => 
                theme.palette.mode === 'dark' 
                  ? '1px solid rgba(171, 110, 255, 0.15)' 
                  : '1px solid rgba(255, 255, 255, 0.6)',
            },
            zIndex: 1201
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      {/* Main Content Area */}
      <Box
        component="main"
        sx={{ 
          flexGrow: 1, 
          height: '100%', 
          overflow: 'hidden', 
          position: 'relative',
          bgcolor: 'transparent',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {isMobile && activeView === 'chat' && !selectedConversationId ? (
          <Box sx={{ pt: 'calc(env(safe-area-inset-top) + 68px)', height: '100%', display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
            <ChatList 
              conversations={conversations}
              onSelectConversation={onSelectConversation}
              onNewChat={handleNewChatMode}
              onDeleteConversation={onDeleteConversation}
              localPeerId={peerId}
              avatarByPeerId={avatarByPeerId}
              dense
            />
          </Box>
        ) : (
          <Box
            sx={{
              pt: isMobile && !(activeView === 'chat' && !!selectedConversationId)
                ? 'calc(env(safe-area-inset-top) + 68px)'
                : 0,
              minHeight: 0,
              height: '100%',
            }}
          >
            {children}
          </Box>
        )}
      </Box>
    </Box>
  );
}
