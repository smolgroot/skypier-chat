import { Avatar } from '@mui/material';
import Jazzicon, { jsNumberForAddress } from 'react-jazzicon';

interface UserAvatarProps {
  seed: string;
  size?: number;
  displayName?: string;
  sx?: any;
}

export function UserAvatar({ seed, size = 40, displayName, sx }: UserAvatarProps) {
  // Use a hash of the seed if it's not a valid address-like string
  // jsNumberForAddress works well for generating a seed for Jazzicon
  const avatarSeed = jsNumberForAddress(seed.slice(-8));

  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        bgcolor: 'background.paper',
        border: '1px solid rgba(0,0,0,0.1)',
        ...sx,
      }}
    >
      <Jazzicon diameter={size} seed={avatarSeed} />
      {/* 
        If Jazzicon fails or we want a fallback initial, we could overlay it, 
        but Jazzicon is standard for web3 apps.
      */}
    </Avatar>
  );
}
