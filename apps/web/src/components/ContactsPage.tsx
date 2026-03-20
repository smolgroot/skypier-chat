import {
  Box,
  Typography,
  Paper,
  Avatar,
  IconButton,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemButton,
  Divider,
  Chip,
  Tooltip,
  InputAdornment,
  useTheme,
  Menu,
  MenuItem,
  ListItemIcon,
  alpha,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ChatIcon from '@mui/icons-material/Chat';
import SearchIcon from '@mui/icons-material/Search';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useState, useMemo } from 'react';
import type { Contact } from '@skypier/storage';
import { UserAvatar } from './UserAvatar';

interface ContactsPageProps {
  contacts: Contact[];
  onSaveContact: (id: string, peerId: string, displayName: string, avatarUrl?: string) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  onStartChat: (peerId: string, displayName: string) => Promise<void>;
}

const emptyForm = { peerId: '', displayName: '', avatarUrl: '' };

export function ContactsPage({ contacts, onSaveContact, onDeleteContact, onStartChat }: ContactsPageProps) {
  const theme = useTheme();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; contact: Contact } | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.peerId.toLowerCase().includes(q),
    );
  }, [contacts, searchQuery]);

  const openAddDialog = () => {
    setEditingContact(null);
    setForm(emptyForm);
    setFormError('');
    setDialogOpen(true);
  };

  const openEditDialog = (contact: Contact) => {
    setEditingContact(contact);
    setForm({ peerId: contact.peerId, displayName: contact.displayName, avatarUrl: contact.avatarUrl ?? '' });
    setFormError('');
    setDialogOpen(true);
    setMenuAnchor(null);
  };

  const handleSave = async () => {
    if (!form.peerId.trim()) { setFormError('Peer ID is required'); return; }
    if (!form.displayName.trim()) { setFormError('Nickname is required'); return; }
    setSaving(true);
    try {
      const id = editingContact?.id ?? form.peerId.trim();
      await onSaveContact(id, form.peerId.trim(), form.displayName.trim(), form.avatarUrl.trim() || undefined);
      setDialogOpen(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, contact: Contact) => {
    event.stopPropagation();
    setMenuAnchor({ el: event.currentTarget, contact });
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleContactClick = (contact: Contact) => {
    setSelectedContact(contact);
  };

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left panel - Contact list */}
      <Box
        sx={{
          width: selectedContact ? { xs: '0%', md: '40%' } : '100%',
          maxWidth: selectedContact ? 480 : 'none',
          minWidth: selectedContact ? { xs: 0, md: 360 } : 'auto',
          display: selectedContact ? { xs: 'none', md: 'flex' } : 'flex',
          flexDirection: 'column',
          borderRight: (theme) =>
            theme.palette.mode === 'dark'
              ? '1px solid rgba(171, 110, 255, 0.1)'
              : '1px solid rgba(0, 0, 0, 0.08)',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? 'rgba(14, 8, 28, 0.2)'
              : 'rgba(255, 255, 255, 0.4)',
        }}
      >
        {/* Header with search and add button */}
        <Box sx={{ p: 2, pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h5" fontWeight={700}>
              Contacts
            </Typography>
            <IconButton
              color="primary"
              onClick={openAddDialog}
              sx={{
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(142, 45, 226, 0.15)'
                    : 'rgba(31, 124, 255, 0.1)',
              }}
            >
              <PersonAddIcon />
            </IconButton>
          </Box>

          {/* Search bar */}
          <TextField
            fullWidth
            placeholder="Search contacts…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            size="small"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
              sx: {
                borderRadius: 3,
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(255, 255, 255, 0.05)'
                    : 'rgba(0, 0, 0, 0.03)',
              },
            }}
          />
        </Box>

        {/* Contact count */}
        <Box sx={{ px: 2, pb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''}
          </Typography>
        </Box>

        {/* Contact list */}
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {filteredContacts.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
              <PersonAddIcon sx={{ fontSize: 64, opacity: 0.15, mb: 2 }} />
              <Typography variant="body1" color="text.secondary" gutterBottom>
                {contacts.length === 0 ? 'No contacts yet' : 'No results found'}
              </Typography>
              {contacts.length === 0 && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3, opacity: 0.7 }}>
                    Add contacts to quickly start conversations
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={openAddDialog}
                    sx={{
                      borderRadius: 3,
                      textTransform: 'none',
                      background: (theme) =>
                        theme.palette.mode === 'dark'
                          ? 'linear-gradient(135deg, #8e2de2, #4a00e0)'
                          : 'linear-gradient(135deg, #1f7cff, #42c6ff)',
                    }}
                  >
                    Add Contact
                  </Button>
                </>
              )}
            </Box>
          ) : (
            <List disablePadding>
              {filteredContacts.map((contact) => (
                <ListItemButton
                  key={contact.id}
                  selected={selectedContact?.id === contact.id}
                  onClick={() => handleContactClick(contact)}
                  sx={{
                    py: 2,
                    px: 2,
                    '&.Mui-selected': {
                      bgcolor: (theme) =>
                        theme.palette.mode === 'dark'
                          ? 'rgba(142, 45, 226, 0.15)'
                          : 'rgba(31, 124, 255, 0.08)',
                    },
                  }}
                >
                  <ListItemAvatar>
                    <UserAvatar seed={contact.peerId} size={48} />
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Typography fontWeight={600} variant="body1">
                        {contact.displayName}
                      </Typography>
                    }
                    secondary={
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        sx={{ fontFamily: 'monospace', display: 'block' }}
                      >
                        {contact.peerId.slice(0, 24)}…
                      </Typography>
                    }
                  />
                  <IconButton
                    size="small"
                    onClick={(e) => handleMenuOpen(e, contact)}
                    sx={{ ml: 1 }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </Box>

      {/* Right panel - Contact details */}
      {selectedContact && (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Contact header */}
          <Box
            sx={{
              p: 4,
              textAlign: 'center',
              borderBottom: (theme) =>
                theme.palette.mode === 'dark'
                  ? '1px solid rgba(171, 110, 255, 0.1)'
                  : '1px solid rgba(0, 0, 0, 0.08)',
              bgcolor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'rgba(142, 45, 226, 0.05)'
                  : 'rgba(31, 124, 255, 0.03)',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <UserAvatar seed={selectedContact.peerId} size={96} />
            </Box>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              {selectedContact.displayName}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontFamily: 'monospace' }}
              >
                {selectedContact.peerId.slice(0, 20)}…
              </Typography>
              <Tooltip title={copied === selectedContact.peerId ? 'Copied!' : 'Copy full peer ID'}>
                <IconButton
                  size="small"
                  onClick={() => handleCopy(selectedContact.peerId)}
                  sx={{ ml: 0.5 }}
                >
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Actions */}
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
              <Button
                fullWidth
                variant="contained"
                size="large"
                startIcon={<ChatIcon />}
                onClick={() => void onStartChat(selectedContact.peerId, selectedContact.displayName)}
                sx={{
                  borderRadius: 3,
                  textTransform: 'none',
                  fontWeight: 600,
                  py: 1.5,
                  background: (theme) =>
                    theme.palette.mode === 'dark'
                      ? 'linear-gradient(135deg, #8e2de2, #4a00e0)'
                      : 'linear-gradient(135deg, #1f7cff, #42c6ff)',
                }}
              >
                Start Chat
              </Button>
            </Box>

            {/* Contact info sections */}
            <Paper
              elevation={0}
              sx={{
                p: 0,
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(255, 255, 255, 0.03)'
                    : 'rgba(0, 0, 0, 0.02)',
                borderRadius: 2,
              }}
            >
              <List disablePadding>
                <ListItem>
                  <ListItemText
                    primary={
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                        Full Peer ID
                      </Typography>
                    }
                    secondary={
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: 'monospace',
                          wordBreak: 'break-all',
                          mt: 0.5,
                        }}
                      >
                        {selectedContact.peerId}
                      </Typography>
                    }
                  />
                </ListItem>
                <Divider />
                <ListItem>
                  <ListItemText
                    primary={
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                        Added
                      </Typography>
                    }
                    secondary={
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {new Date(selectedContact.addedAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </Typography>
                    }
                  />
                </ListItem>
              </List>
            </Paper>

            {/* Edit and delete buttons */}
            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={() => openEditDialog(selectedContact)}
                sx={{
                  borderRadius: 3,
                  textTransform: 'none',
                  py: 1.25,
                }}
              >
                Edit
              </Button>
              <Button
                fullWidth
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => setDeleteConfirmId(selectedContact.id)}
                sx={{
                  borderRadius: 3,
                  textTransform: 'none',
                  py: 1.25,
                }}
              >
                Delete
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {/* Empty state for detail panel */}
      {!selectedContact && filteredContacts.length > 0 && (
        <Box
          sx={{
            flex: 1,
            display: { xs: 'none', md: 'flex' },
            alignItems: 'center',
            justifyContent: 'center',
            p: 4,
          }}
        >
          <Box sx={{ textAlign: 'center', maxWidth: 300 }}>
            <PersonAddIcon sx={{ fontSize: 80, opacity: 0.1, mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              Select a contact
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ opacity: 0.7 }}>
              Choose a contact from the list to view details
            </Typography>
          </Box>
        </Box>
      )}

      {/* Context menu */}
      <Menu
        anchorEl={menuAnchor?.el}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            borderRadius: 2,
            minWidth: 180,
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? 'rgba(14, 8, 28, 0.95)'
                : 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(20px)',
          },
        }}
      >
        <MenuItem
          onClick={() => {
            if (menuAnchor?.contact) {
              void onStartChat(menuAnchor.contact.peerId, menuAnchor.contact.displayName);
            }
            handleMenuClose();
          }}
        >
          <ListItemIcon>
            <ChatIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Start Chat</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuAnchor?.contact) {
              handleCopy(menuAnchor.contact.peerId);
            }
            handleMenuClose();
          }}
        >
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Copy Peer ID</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuAnchor?.contact) {
              openEditDialog(menuAnchor.contact);
            }
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            if (menuAnchor?.contact) {
              setDeleteConfirmId(menuAnchor.contact.id);
            }
            handleMenuClose();
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Add / Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            bgcolor: (theme) =>
              theme.palette.mode === 'dark' ? 'rgba(14,8,28,0.85)' : 'rgba(255,255,255,0.9)',
            backdropFilter: 'blur(30px)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {editingContact ? 'Edit Contact' : 'Add Contact'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {/* Avatar preview */}
          {form.peerId && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
              <UserAvatar seed={form.peerId} size={72} />
            </Box>
          )}

          <TextField
            label="Peer ID"
            value={form.peerId}
            onChange={(e) => { setForm(f => ({ ...f, peerId: e.target.value })); setFormError(''); }}
            fullWidth
            disabled={!!editingContact}
            helperText={editingContact ? 'Peer ID cannot be changed after creation' : 'Paste the full libp2p peer ID (12D3Koo…)'}
            placeholder="12D3KooW…"
            InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
          />

          <TextField
            label="Nickname"
            value={form.displayName}
            onChange={(e) => { setForm(f => ({ ...f, displayName: e.target.value })); setFormError(''); }}
            fullWidth
            placeholder="Alice"
            autoFocus={!!editingContact}
          />

          {formError && (
            <Typography color="error" variant="caption">{formError}</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button
            variant="contained"
            disabled={saving}
            onClick={() => void handleSave()}
            sx={{
              textTransform: 'none',
              borderRadius: 2,
              background: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'linear-gradient(135deg, #8e2de2, #4a00e0)'
                  : 'linear-gradient(135deg, #1f7cff, #42c6ff)',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog
        open={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        PaperProps={{ sx: { borderRadius: 3, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(14,8,28,0.9)' : undefined } }}
      >
        <DialogTitle>Delete Contact?</DialogTitle>
        <DialogContent>
          <Typography>This will remove the contact from your list. Any existing chats are kept.</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirmId(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            sx={{ textTransform: 'none', borderRadius: 2 }}
            onClick={() => {
              if (deleteConfirmId) void onDeleteContact(deleteConfirmId);
              setDeleteConfirmId(null);
              if (selectedContact?.id === deleteConfirmId) {
                setSelectedContact(null);
              }
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
