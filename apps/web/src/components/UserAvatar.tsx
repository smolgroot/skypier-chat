import { Avatar } from '@mui/material';
import Jazzicon, { jsNumberForAddress } from 'react-jazzicon';

interface UserAvatarProps {
  seed: string;
  size?: number;
  displayName?: string;
  src?: string | null;
  sx?: any;
}

export function UserAvatar({ seed, size = 40, displayName, src, sx }: UserAvatarProps) {
  // Use a hash of the seed if it's not a valid address-like string
  // jsNumberForAddress works well for generating a seed for Jazzicon
  const avatarSeed = jsNumberForAddress(seed.slice(-8));

  return (
    <Avatar
      src={src || undefined}
      sx={{
        width: size,
        height: size,
        bgcolor: 'background.paper',
        border: '1px solid rgba(0,0,0,0.1)',
        ...sx,
      }}
    >
      {!src && <Jazzicon diameter={size} seed={avatarSeed} />}
    </Avatar>
  );
}
