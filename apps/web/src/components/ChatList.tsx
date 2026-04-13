import { 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText, 
  Typography, 
  Box,
  Divider,
  Button,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon as MenuItemIcon,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import { reachabilityColor } from '@skypier/network';
import type { Conversation } from '@skypier/protocol';
import { useState } from 'react';
import { UserAvatar } from './UserAvatar';

type NewChatMode = 'direct' | 'group';

interface ChatListProps {
  conversations: Conversation[];
  selectedConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewChat: (mode: NewChatMode) => void;
  onDeleteConversation?: (conversationId: string) => void;
  localPeerId?: string;
  dense?: boolean;
  avatarByPeerId?: Record<string, string | undefined>;
}

export function ChatList({ conversations, selectedConversationId, onSelectConversation, onNewChat, onDeleteConversation, localPeerId, dense = false, avatarByPeerId = {} }: ChatListProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuConvId, setMenuConvId] = useState<string | null>(null);
  const [newChatMenuAnchor, setNewChatMenuAnchor] = useState<HTMLElement | null>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, conversationId: string) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setMenuConvId(conversationId);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuConvId(null);
  };

  const handleDelete = () => {
    if (menuConvId && onDeleteConversation) {
      onDeleteConversation(menuConvId);
    }
    handleMenuClose();
  };

  const openNewChatMenu = (event: React.MouseEvent<HTMLElement>) => {
    setNewChatMenuAnchor(event.currentTarget);
  };

  const closeNewChatMenu = () => {
    setNewChatMenuAnchor(null);
  };

  const selectNewChatMode = (mode: NewChatMode) => {
    onNewChat(mode);
    closeNewChatMenu();
  };

  return (
    <Box sx={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: dense ? 1.25 : 2, py: dense ? 0.75 : 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'bold', letterSpacing: '0.05em' }}>
          RECENT CHATS
        </Typography>
        <Button size="small" sx={{ borderRadius: 4, minWidth: dense ? 84 : 96, py: dense ? 0.2 : 0.5 }} onClick={openNewChatMenu}>New Chat</Button>
      </Box>
      <Divider />
      <List sx={{ px: dense ? 0.5 : 1, py: dense ? 0.25 : 1 }}>
        {conversations.map((conv) => {
          const remotePeer = conv.participants.find((participant) => participant.peerId !== localPeerId)
            ?? conv.participants[0];
          const avatarSeed = remotePeer?.peerId || conv.id;
          const avatarSrc = remotePeer?.peerId ? avatarByPeerId[remotePeer.peerId] : undefined;
          const isGroupConversation = conv.kind === 'group' || conv.participants.length > 2;
          const title = isGroupConversation ? `# ${conv.title}` : conv.title;
          const subtitle = isGroupConversation
            ? `${conv.participants.length} members · ${conv.lastMessagePreview}`
            : conv.lastMessagePreview;
          return (
          <ListItem
            key={conv.id}
            disablePadding
            sx={{ mb: dense ? 0.125 : 0.5 }}
            secondaryAction={
              onDeleteConversation ? (
                <IconButton
                  edge="end"
                  size="small"
                  onClick={(e) => handleMenuOpen(e, conv.id)}
                  sx={{ opacity: 0, '.MuiListItem-root:hover &': { opacity: 1 }, transition: 'opacity 0.2s' }}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              ) : undefined
            }
          >
            <ListItemButton 
              selected={selectedConversationId === conv.id}
              onClick={() => onSelectConversation(conv.id)}
              sx={{ 
                borderRadius: 3, 
                minHeight: dense ? 58 : 76,
                py: dense ? 0.625 : 1.5,
                px: dense ? 1 : 1.5,
                pr: onDeleteConversation ? 5 : 2,
                transition: 'all 0.2s',
                '&.Mui-selected': {
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(171, 110, 255, 0.15)' : 'rgba(142, 45, 226, 0.08)',
                  '&:hover': {
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(171, 110, 255, 0.25)' : 'rgba(142, 45, 226, 0.12)',
                  }
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: dense ? 50 : 64 }}>
                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                  <UserAvatar seed={avatarSeed} size={dense ? 42 : 48} src={avatarSrc} />
                  {reachabilityColor(conv.reachability) != null && (
                    <Box
                      sx={{
                        position: 'absolute',
                        bottom: 1,
                        right: 1,
                        width: dense ? 11 : 12,
                        height: dense ? 11 : 12,
                        borderRadius: '50%',
                        bgcolor: reachabilityColor(conv.reachability),
                        border: '2px solid',
                        borderColor: 'background.paper',
                        boxShadow: '0 0 4px rgba(0,0,0,0.4)',
                      }}
                    />
                  )}
                </Box>
              </ListItemIcon>
              <ListItemText 
                primary={title} 
                secondary={subtitle}
                primaryTypographyProps={{ variant: 'subtitle2', noWrap: true, fontWeight: 'bold', lineHeight: dense ? 1.25 : 1.35 }}
                secondaryTypographyProps={{ variant: 'caption', noWrap: true, sx: { opacity: 0.7, lineHeight: dense ? 1.25 : 1.3 } }}
              />
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', ml: dense ? 0.5 : 1 }}>
                <Typography variant="caption" sx={{ fontSize: dense ? '0.68rem' : '0.7rem', opacity: 0.6 }}>
                  {new Date(conv.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Typography>
                {conv.unreadCount > 0 && (
                   <Box sx={{ 
                     bgcolor: 'secondary.main', 
                     color: 'white', 
                     borderRadius: '10px', 
                     minWidth: dense ? 19 : 20, 
                     height: dense ? 19 : 20, 
                     display: 'flex', 
                     alignItems: 'center', 
                     justifyContent: 'center',
                     fontSize: dense ? '0.62rem' : '0.65rem',
                     mt: dense ? 0.25 : 0.5,
                     px: 0.5,
                     fontWeight: 'bold'
                   }}>
                     {conv.unreadCount}
                   </Box>
                )}
              </Box>
            </ListItemButton>
          </ListItem>
          );
        })}
      </List>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 160 } } }}
      >
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>
          <MenuItemIcon sx={{ color: 'inherit' }}>
            <DeleteOutlineIcon fontSize="small" />
          </MenuItemIcon>
          Delete chat
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={newChatMenuAnchor}
        open={Boolean(newChatMenuAnchor)}
        onClose={closeNewChatMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 190 } } }}
      >
        <MenuItem onClick={() => selectNewChatMode('direct')}>
          <MenuItemIcon>
            <PersonAddAlt1Icon fontSize="small" />
          </MenuItemIcon>
          New Direct Chat
        </MenuItem>
        <MenuItem onClick={() => selectNewChatMode('group')}>
          <MenuItemIcon>
            <GroupAddIcon fontSize="small" />
          </MenuItemIcon>
          New Group Chat
        </MenuItem>
      </Menu>
    </Box>
  );
}
