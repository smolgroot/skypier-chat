import { Box, Typography, CircularProgress, keyframes } from '@mui/material';

const pulse = keyframes`
  0% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.05); opacity: 1; }
  100% { transform: scale(1); opacity: 0.8; }
`;

export function SplashScreen() {
  return (
    <Box
      sx={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#070d18',
        color: 'white',
      }}
    >
      <Box
        sx={{
          mb: 4,
          animation: `${pulse} 2s infinite ease-in-out`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Box
          component="img"
          src="https://skypier.io/logo.png" // Fallback to a generic icon if logo not available
          alt="Skypier Logo"
          sx={{ width: 80, height: 80, mb: 2, borderRadius: 2 }}
          onError={(e: any) => {
            e.target.style.display = 'none';
          }}
        />
        <Typography variant="h4" sx={{ fontWeight: 'bold', letterSpacing: '0.1em' }}>
          SKYPIER
        </Typography>
        <Typography variant="caption" sx={{ color: '#42c6ff', letterSpacing: '0.3em', mt: 1 }}>
          SECURE CHAT
        </Typography>
      </Box>
      
      <CircularProgress 
        size={24} 
        thickness={4} 
        sx={{ color: '#42c6ff' }} 
      />
      
      <Typography variant="subtitle2" sx={{ mt: 4, opacity: 0.5 }}>
        Initializing secure node...
      </Typography>
    </Box>
  );
}
