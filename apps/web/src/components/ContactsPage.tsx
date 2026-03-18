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
  ListItemSecondaryAction,
  Divider,
  Chip,
  Tooltip,
  InputAdornment,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ChatIcon from '@mui/icons-material/Chat';
import SearchIcon from '@mui/icons-material/Search';
import { useState, useMemo } from 'react';
import type { Contact } from '@skypier/storage';
import { UserAvatar } from './UserAvatar';

interface ContactsPageProps {
  contacts: Contact[];
  onSaveContact: (id: string, peerId: string, displayName: string, avatarUrl?: string) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  onStartChat: (peerId: string, displayName: string) => Promise<void>;
}

const GlassPaper = ({ children, sx = {} }: { children: React.ReactNode; sx?: object }) => (
  <Paper
    elevation={0}
    sx={{
      p: 3,
      bgcolor: (theme: any) =>
        theme.palette.mode === 'dark'
          ? 'rgba(14, 8, 28, 0.35)'
          : 'rgba(255, 255, 255, 0.6)',
      backdropFilter: (theme: any) =>
        `blur(20px) saturate(180%) url(#liquid-glass-refraction-${theme.palette.mode})`,
      WebkitBackdropFilter: (theme: any) =>
        `blur(20px) saturate(180%) url(#liquid-glass-refraction-${theme.palette.mode})`,
      border: (theme: any) =>
        theme.palette.mode === 'dark'
          ? '1px solid rgba(171, 110, 255, 0.15)'
          : '1px solid rgba(0, 0, 0, 0.06)',
      borderRadius: 3,
      ...sx,
    }}
  >
    {children}
  </Paper>
);

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

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 800, mx: 'auto', height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Contacts</Typography>
          <Typography variant="body2" color="text.secondary">
            {contacts.length} contact{contacts.length !== 1 ? 's' : ''} saved
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<PersonAddIcon />}
          onClick={openAddDialog}
          sx={{
            borderRadius: '12px',
            background: (theme) =>
              theme.palette.mode === 'dark'
                ? 'linear-gradient(135deg, #8e2de2, #4a00e0)'
                : 'linear-gradient(135deg, #1f7cff, #42c6ff)',
            textTransform: 'none',
            fontWeight: 600,
            px: 2.5,
          }}
        >
          Add Contact
        </Button>
      </Box>

      {/* Search */}
      {contacts.length > 0 && (
        <TextField
          fullWidth
          placeholder="Search by name or peer ID…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          size="small"
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="action" />
              </InputAdornment>
            ),
            sx: { borderRadius: 3 },
          }}
        />
      )}

      {/* Contact List */}
      {filteredContacts.length === 0 ? (
        <GlassPaper sx={{ textAlign: 'center', py: 8 }}>
          <PersonAddIcon sx={{ fontSize: 64, opacity: 0.25, mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {contacts.length === 0 ? 'No contacts yet' : 'No results found'}
          </Typography>
          {contacts.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Add a contact by their libp2p peer ID and give them a nickname.
            </Typography>
          )}
          {contacts.length === 0 && (
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={openAddDialog}
              sx={{ borderRadius: 3, textTransform: 'none' }}
            >
              Add your first contact
            </Button>
          )}
        </GlassPaper>
      ) : (
        <GlassPaper sx={{ p: 0, overflow: 'hidden' }}>
          <List disablePadding>
            {filteredContacts.map((contact, idx) => (
              <Box key={contact.id}>
                {idx > 0 && <Divider variant="inset" component="li" />}
                <ListItem
                  alignItems="center"
                  sx={{
                    py: 1.5,
                    px: 2,
                    transition: 'background 0.15s',
                    '&:hover': {
                      bgcolor: theme.palette.mode === 'dark'
                        ? 'rgba(255,255,255,0.03)'
                        : 'rgba(0,0,0,0.02)',
                    },
                  }}
                >
                  <ListItemAvatar>
                    <UserAvatar seed={contact.peerId} size={44} />
                  </ListItemAvatar>

                  <ListItemText
                    primary={
                      <Typography fontWeight={600} noWrap>
                        {contact.displayName}
                      </Typography>
                    }
                    secondary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          sx={{ fontFamily: 'monospace', maxWidth: 200 }}
                        >
                          {contact.peerId.slice(0, 20)}…
                        </Typography>
                        <Tooltip title={copied === contact.peerId ? 'Copied!' : 'Copy peer ID'}>
                          <IconButton
                            size="small"
                            onClick={() => handleCopy(contact.peerId)}
                            sx={{ p: 0.25 }}
                          >
                            <ContentCopyIcon sx={{ fontSize: 12, opacity: 0.5 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    }
                  />

                  <ListItemSecondaryAction sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Start Chat">
                      <IconButton
                        size="small"
                        onClick={() => void onStartChat(contact.peerId, contact.displayName)}
                        sx={{
                          color: 'primary.main',
                          '&:hover': {
                            bgcolor: (theme) =>
                              theme.palette.mode === 'dark'
                                ? 'rgba(142, 45, 226, 0.1)'
                                : 'rgba(31, 124, 255, 0.1)',
                          }
                        }}
                      >
                        <ChatIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => openEditDialog(contact)}
                        sx={{ '&:hover': { bgcolor: 'rgba(66, 165, 245, 0.1)' } }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={() => setDeleteConfirmId(contact.id)}
                        sx={{ '&:hover': { bgcolor: 'rgba(244, 67, 54, 0.1)', color: 'error.main' } }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </ListItemSecondaryAction>
                </ListItem>
              </Box>
            ))}
          </List>
        </GlassPaper>
      )}

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
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
