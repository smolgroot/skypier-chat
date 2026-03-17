import { 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText, 
  Typography, 
  Box,
  Divider,
  Button
} from '@mui/material';
import { reachabilityColor } from '@skypier/network';
import type { Conversation } from '@skypier/protocol';
import { UserAvatar } from './UserAvatar';

interface ChatListProps {
  conversations: Conversation[];
  selectedConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  dense?: boolean;
}

export function ChatList({ conversations, selectedConversationId, onSelectConversation, onNewChat, dense = false }: ChatListProps) {
  return (
    <Box sx={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'bold', letterSpacing: '0.05em' }}>
          RECENT CHATS
        </Typography>
        <Button size="small" sx={{ borderRadius: 4 }} onClick={onNewChat}>New Chat</Button>
      </Box>
      <Divider />
      <List sx={{ px: 1, py: 1 }}>
        {conversations.map((conv) => (
          <ListItem key={conv.id} disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton 
              selected={selectedConversationId === conv.id}
              onClick={() => onSelectConversation(conv.id)}
              sx={{ 
                borderRadius: 3, 
                py: dense ? 1 : 1.5,
                transition: 'all 0.2s',
                '&.Mui-selected': {
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(31, 124, 255, 0.15)' : 'rgba(31, 124, 255, 0.08)',
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: dense ? 48 : 64 }}>
                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                  <UserAvatar seed={conv.id} size={dense ? 40 : 48} />
                  {reachabilityColor(conv.reachability) != null && (
                    <Box
                      sx={{
                        position: 'absolute',
                        bottom: 1,
                        right: 1,
                        width: 12,
                        height: 12,
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
                primary={conv.title} 
                secondary={conv.lastMessagePreview}
                primaryTypographyProps={{ variant: 'subtitle2', noWrap: true, fontWeight: 'bold' }}
                secondaryTypographyProps={{ variant: 'caption', noWrap: true, sx: { opacity: 0.7 } }}
              />
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', ml: 1 }}>
                <Typography variant="caption" sx={{ fontSize: '0.7rem', opacity: 0.6 }}>
                  {new Date(conv.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Typography>
                {conv.unreadCount > 0 && (
                   <Box sx={{ 
                     bgcolor: 'secondary.main', 
                     color: 'white', 
                     borderRadius: '10px', 
                     minWidth: 20, 
                     height: 20, 
                     display: 'flex', 
                     alignItems: 'center', 
                     justifyContent: 'center',
                     fontSize: '0.65rem',
                     mt: 0.5,
                     px: 0.5,
                     fontWeight: 'bold'
                   }}>
                     {conv.unreadCount}
                   </Box>
                )}
              </Box>
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
