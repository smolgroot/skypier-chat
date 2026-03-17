import { createTheme, type ThemeOptions } from '@mui/material/styles';

const getDesignTokens = (mode: 'light' | 'dark'): ThemeOptions => ({
  palette: {
    mode,
    ...(mode === 'light'
      ? {
        // Light mode colors
        primary: {
          main: '#1f7cff',
        },
        secondary: {
          main: '#42c6ff',
        },
        background: {
          default: '#f0f2f5',
          paper: '#ffffff',
        },
        text: {
          primary: '#03111f',
          secondary: '#5f6368',
        },
      }
      : {
        // Dark mode colors (Skypier VPN theme)
        primary: {
          main: '#1f7cff',
        },
        secondary: {
          main: '#42c6ff',
        },
        background: {
          default: '#070d18',
          paper: '#0a1322',
        },
        text: {
          primary: '#e5eefc',
          secondary: '#8db4df',
        },
      }),
  },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
    h1: { fontSize: '1.5rem', fontWeight: 700 },
    h2: { fontSize: '1.25rem', fontWeight: 700 },
    h3: { fontSize: '1.1rem', fontWeight: 600 },
    body1: { fontSize: '1rem' },
    body2: { fontSize: '0.875rem' },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          textTransform: 'none',
          fontWeight: 600,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backdropFilter: mode === 'dark' ? 'blur(18px)' : 'none',
          border: mode === 'dark' ? '1px solid rgba(136, 175, 224, 0.16)' : '1px solid rgba(0, 0, 0, 0.08)',
        },
      },
    },
  },
});

export const theme = (mode: 'light' | 'dark') => createTheme(getDesignTokens(mode));
