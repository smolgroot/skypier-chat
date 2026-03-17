import { 
  Box, 
  Drawer, 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText, 
  Typography, 
  Avatar, 
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
  useTheme,
  useMediaQuery
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import SettingsIcon from '@mui/icons-material/Settings';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import MenuIcon from '@mui/icons-material/Menu';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useState } from 'react';
import type { Conversation } from '@skypier/protocol';
import { reachabilityColor, reachabilityLabel } from '@skypier/network';
import { UserAvatar } from './UserAvatar';
import { useENS } from '../hooks/useENS';
import { ChatList } from './ChatList';

const SIDEBAR_WIDTH = 320;

interface MainLayoutProps {
  conversations: Conversation[];
  selectedConversationId?: string;
  onSelectConversation: (id: string) => void;
  activeView: 'chat' | 'profile' | 'settings' | 'network';
  setActiveView: (view: 'chat' | 'profile' | 'settings' | 'network') => void;
  children: React.ReactNode;
  mode: 'light' | 'dark';
  toggleColorMode: () => void;
  peerId: string;
  userName: string;
  localPeerStatus: 'online' | 'connecting' | 'offline';
  onCreateChat: (peerId: string, displayName?: string) => Promise<void> | void;
  onDeleteConversation?: (conversationId: string) => void;
  onBack?: () => void; // New prop for mobile navigation back
  onOpenSelectedContact?: () => void;
  linkedWallets?: { address: string; chainId: number }[];
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
    onDeleteConversation,
    onBack,
    onOpenSelectedContact,
    linkedWallets = []
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

  const drawerContent = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: (theme) => (theme.palette.mode === 'light' ? '#e2e2e2' : 'transparent'),
        backgroundImage: (theme) =>
          theme.palette.mode === 'light'
            ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 304 304\' width=\'304\' height=\'304\'%3E%3Cpath fill=\'%23ffffff\' fill-opacity=\'0.4\' d=\'M44.1 224a5 5 0 1 1 0 2H0v-2h44.1zm160 48a5 5 0 1 1 0 2H82v-2h122.1zm57.8-46a5 5 0 1 1 0-2H304v2h-42.1zm0 16a5 5 0 1 1 0-2H304v2h-42.1zm6.2-114a5 5 0 1 1 0 2h-86.2a5 5 0 1 1 0-2h86.2zm-256-48a5 5 0 1 1 0 2H0v-2h12.1zm185.8 34a5 5 0 1 1 0-2h86.2a5 5 0 1 1 0 2h-86.2zM258 12.1a5 5 0 1 1-2 0V0h2v12.1zm-64 208a5 5 0 1 1-2 0v-54.2a5 5 0 1 1 2 0v54.2zm48-198.2V80h62v2h-64V21.9a5 5 0 1 1 2 0zm16 16V64h46v2h-48V37.9a5 5 0 1 1 2 0zm-128 96V208h16v12.1a5 5 0 1 1-2 0V210h-16v-76.1a5 5 0 1 1 2 0zm-5.9-21.9a5 5 0 1 1 0 2H114v48H85.9a5 5 0 1 1 0-2H112v-48h12.1zm-6.2 130a5 5 0 1 1 0-2H176v-74.1a5 5 0 1 1 2 0V242h-60.1zm-16-64a5 5 0 1 1 0-2H114v48h10.1a5 5 0 1 1 0 2H112v-48h-10.1zM66 284.1a5 5 0 1 1-2 0V274H50v30h-2v-32h18v12.1zM236.1 176a5 5 0 1 1 0 2H226v94h48v32h-2v-30h-48v-98h12.1zm25.8-30a5 5 0 1 1 0-2H274v44.1a5 5 0 1 1-2 0V146h-10.1zm-64 96a5 5 0 1 1 0-2H208v-80h16v-14h-42.1a5 5 0 1 1 0-2H226v18h-16v80h-12.1zm86.2-210a5 5 0 1 1 0 2H272V0h2v32h10.1zM98 101.9V146H53.9a5 5 0 1 1 0-2H96v-42.1a5 5 0 1 1 2 0zM53.9 34a5 5 0 1 1 0-2H80V0h2v34H53.9zm60.1 3.9V66H82v64H69.9a5 5 0 1 1 0-2H80V64h32V37.9a5 5 0 1 1 2 0zM101.9 82a5 5 0 1 1 0-2H128V37.9a5 5 0 1 1 2 0V82h-28.1zm16-64a5 5 0 1 1 0-2H146v44.1a5 5 0 1 1-2 0V18h-26.1zm102.2 270a5 5 0 1 1 0 2H98v14h-2v-16h124.1zM242 149.9V160h16v34h-16v62h48v48h-2v-46h-48v-66h16v-30h-16v-12.1a5 5 0 1 1 2 0zM53.9 18a5 5 0 1 1 0-2H64V2H48V0h18v18H53.9zm112 32a5 5 0 1 1 0-2H192V0h50v2h-48v48h-28.1zm-48-48a5 5 0 0 1-9.8-2h2.07a3 3 0 1 0 5.66 0H178v34h-18V21.9a5 5 0 1 1 2 0V32h14V2h-58.1zm0 96a5 5 0 1 1 0-2H137l32-32h39V21.9a5 5 0 1 1 2 0V66h-40.17l-32 32H117.9zm28.1 90.1a5 5 0 1 1-2 0v-76.51L175.59 80H224V21.9a5 5 0 1 1 2 0V82h-49.59L146 112.41v75.69zm16 32a5 5 0 1 1-2 0v-99.51L184.59 96H300.1a5 5 0 0 1 3.9-3.9v2.07a3 3 0 0 0 0 5.66v2.07a5 5 0 0 1-3.9-3.9H185.41L162 121.41v98.69zm-144-64a5 5 0 1 1-2 0v-3.51l48-48V48h32V0h2v50H66v55.41l-48 48v2.69zM50 53.9v43.51l-48 48V208h26.1a5 5 0 1 1 0 2H0v-65.41l48-48V53.9a5 5 0 1 1 2 0zm-16 16V89.41l-34 34v-2.82l32-32V69.9a5 5 0 1 1 2 0zM12.1 32a5 5 0 1 1 0 2H9.41L0 43.41V40.6L8.59 32h3.51zm265.8 18a5 5 0 1 1 0-2h18.69l7.41-7.41v2.82L297.41 50H277.9zm-16 160a5 5 0 1 1 0-2H288v-71.41l16-16v2.82l-14 14V210h-28.1zm-208 32a5 5 0 1 1 0-2H64v-22.59L40.59 194H21.9a5 5 0 1 1 0-2H41.41L66 216.59V242H53.9zm150.2 14a5 5 0 1 1 0 2H96v-56.6L56.6 162H37.9a5 5 0 1 1 0-2h19.5L98 200.6V256h106.1zm-150.2 2a5 5 0 1 1 0-2H80v-46.59L48.59 178H21.9a5 5 0 1 1 0-2H49.41L82 208.59V258H53.9zM34 39.8v1.61L9.41 66H0v-2h8.59L32 40.59V0h2v39.8zM2 300.1a5 5 0 0 1 3.9 3.9H3.83A3 3 0 0 0 0 302.17V256h18v48h-2v-46H2v42.1zM34 241v63h-2v-62H0v-2h34v1zM17 18H0v-2h16V0h2v18h-1zm273-2h14v2h-16V0h2v16zm-32 273v15h-2v-14h-14v14h-2v-16h18v1zM0 92.1A5.02 5.02 0 0 1 6 97a5 5 0 0 1-6 4.9v-2.07a3 3 0 1 0 0-5.66V92.1zM80 272h2v32h-2v-32zm37.9 32h-2.07a3 3 0 0 0-5.66 0h-2.07a5 5 0 0 1 9.8 0zM5.9 0A5.02 5.02 0 0 1 0 5.9V3.83A3 3 0 0 0 3.83 0H5.9zm294.2 0h2.07A3 3 0 0 0 304 3.83V5.9a5 5 0 0 1-3.9-5.9zm3.9 300.1v2.07a3 3 0 0 0-1.83 1.83h-2.07a5 5 0 0 1 3.9-3.9zM97 100a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-48 32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32 48a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16-64a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 96a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-144a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-96 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm96 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16-64a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-32 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM49 36a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-32 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM33 68a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-48a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 240a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16-64a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm80-176a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32 48a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm112 176a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-16 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 180a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-32a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 84a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm32 64a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm16-16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z\'%3E%3C/path%3E%3C/svg%3E")'
            : 'none',
        backgroundRepeat: (theme) => (theme.palette.mode === 'light' ? 'repeat' : 'no-repeat'),
      }}
    >
      {isMobile && <Toolbar sx={{ pt: 'env(safe-area-inset-top)' }} />}
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <UserAvatar seed={peerId} size={40} src={ensAvatar} />
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
        <IconButton onClick={toggleColorMode}>
          {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
      </Box>
      <Divider />
      <List sx={{ px: 1 }}>
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
        <ListItem disablePadding>
          <ListItemButton 
            selected={activeView === 'profile'} 
            onClick={() => { setActiveView('profile'); if(isMobile) setMobileOpen(false); }}
            sx={{ borderRadius: 2 }}
          >
            <ListItemIcon><AccountCircleIcon color={activeView === 'profile' ? 'primary' : 'inherit'} /></ListItemIcon>
            <ListItemText primary="My Profile" />
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
      </List>
      <Divider />
      {!isMobile && (
        <ChatList 
          conversations={conversations}
          selectedConversationId={selectedConversationId}
          onSelectConversation={onSelectConversation}
          onNewChat={() => setNewChatOpen(true)}
          onDeleteConversation={onDeleteConversation}
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
          : (activeView === 'chat' && !isMobile ? '#cad7b8' : (activeView === 'chat' && isMobile && selectedConversationId ? '#cad7b8' : '#ffffff')),
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
            backdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
            WebkitBackdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
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

      {isMobile && (
        <AppBar 
          position="fixed" 
          elevation={0}
          sx={{ 
            bgcolor: (theme) => 
               theme.palette.mode === 'dark' 
                ? 'rgba(14, 8, 28, 0.3)' 
                : 'rgba(255, 255, 255, 0.3)',
            backdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
            WebkitBackdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
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
                    <UserAvatar seed={selectedConversationId} size={32} />
                  </IconButton>
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                      {conversations.find(c => c.id === selectedConversationId)?.title || 'Chat'}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.8, lineHeight: 1 }}>
                      {reachabilityLabel(conversations.find(c => c.id === selectedConversationId)?.reachability ?? 'unknown')}
                    </Typography>
                  </Box>
                </Box>
              ) : (
                activeView === 'chat' ? 'Skypier dM' : 
                activeView === 'network' ? 'P2P Status' :
                activeView.charAt(0).toUpperCase() + activeView.slice(1)
              )}
            </Typography>
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
                    : 'rgba(255, 255, 255, 0.2)',
                backdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
                WebkitBackdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
                filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
                borderRight: (theme) => 
                  theme.palette.mode === 'dark' 
                    ? '1px solid rgba(171, 110, 255, 0.15)' 
                    : '1px solid rgba(0, 0, 0, 0.05)',
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
                  : 'rgba(255, 255, 255, 0.2)',
              backdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
              WebkitBackdropFilter: (theme) => `blur(30px) saturate(190%) url(#liquid-glass-refraction-${theme.palette.mode})`,
              filter: (theme) => `url(#liquid-glass-gloss-${theme.palette.mode})`,
              borderRight: (theme) => 
                theme.palette.mode === 'dark' 
                  ? '1px solid rgba(171, 110, 255, 0.15)' 
                  : '1px solid rgba(0, 0, 0, 0.05)',
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
          <Box sx={{ pt: 'calc(env(safe-area-inset-top) + 68px)' }}>
            <ChatList 
              conversations={conversations}
              onSelectConversation={onSelectConversation}
              onNewChat={() => setNewChatOpen(true)}
              onDeleteConversation={onDeleteConversation}
            />
          </Box>
        ) : children}
      </Box>
    </Box>
  );
}
