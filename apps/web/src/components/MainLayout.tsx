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
  activeView: 'chat' | 'profile' | 'settings';
  setActiveView: (view: 'chat' | 'profile' | 'settings') => void;
  children: React.ReactNode;
  mode: 'light' | 'dark';
  toggleColorMode: () => void;
  peerId: string;
  userName: string;
  onCreateChat: (peerId: string, displayName?: string) => Promise<void> | void;
  onBack?: () => void; // New prop for mobile navigation back
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
    onCreateChat,
    onBack
  } = props;
  
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
  const showBackButton = isMobile && activeView === 'chat' && !!selectedConversationId;

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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.paper' }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <UserAvatar seed={peerId} size={40} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 'bold' }}>{userName}</Typography>
          <Typography variant="caption" color="text.secondary">Online</Typography>
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
      </List>
      <Divider />
      {!isMobile && (
        <ChatList 
          conversations={conversations}
          selectedConversationId={selectedConversationId}
          onSelectConversation={onSelectConversation}
          onNewChat={() => setNewChatOpen(true)}
          dense
        />
      )}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Dialog open={newChatOpen} onClose={() => setNewChatOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Start New Chat</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'grid', gap: 2 }}>
          <TextField
            label="Peer ID"
            placeholder="12D3KooW..."
            value={newChatPeerId}
            onChange={(event) => setNewChatPeerId(event.target.value)}
            fullWidth
            autoFocus
          />
          <TextField
            label="Display Name (optional)"
            placeholder="Alice"
            value={newChatDisplayName}
            onChange={(event) => setNewChatDisplayName(event.target.value)}
            fullWidth
          />
          {newChatError ? <Typography color="error" variant="caption">{newChatError}</Typography> : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewChatOpen(false)}>Cancel</Button>
          <Button onClick={() => { void handleCreateChat(); }} variant="contained" disabled={creatingChat}>
            {creatingChat ? 'Creating…' : 'Create Chat'}
          </Button>
        </DialogActions>
      </Dialog>

      {isMobile && (
        <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, bgcolor: 'background.paper', color: 'text.primary' }}>
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
                  <UserAvatar seed={selectedConversationId} size={32} />
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                      {conversations.find(c => c.id === selectedConversationId)?.title}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.8, lineHeight: 1 }}>
                      {reachabilityLabel(conversations.find(c => c.id === selectedConversationId)?.reachability ?? 'unknown')}
                    </Typography>
                  </Box>
                </Box>
              ) : (
                activeView === 'chat' ? 'Skypier Chat' : activeView.charAt(0).toUpperCase() + activeView.slice(1)
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
              '& .MuiDrawer-paper': { boxSizing: 'border-box', width: SIDEBAR_WIDTH, height: '100%', position: 'static' },
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
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: SIDEBAR_WIDTH },
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
          pt: isMobile ? '64px' : 0,
          position: 'relative',
          bgcolor: mode === 'dark' ? '#070d18' : '#f0f2f5',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {isMobile && activeView === 'chat' && !selectedConversationId ? (
          <ChatList 
            conversations={conversations}
            onSelectConversation={onSelectConversation}
            onNewChat={() => setNewChatOpen(true)}
          />
        ) : children}
      </Box>
    </Box>
  );
}
