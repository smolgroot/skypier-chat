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
  } = props;

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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'transparent' }}>
      {isMobile && <Toolbar sx={{ pt: 'env(safe-area-inset-top)' }} />}
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <UserAvatar seed={peerId} size={40} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 'bold' }}>{userName}</Typography>
          <Typography
            variant="caption"
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
                activeView === 'chat' ? 'Skypier Chat' : 
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
