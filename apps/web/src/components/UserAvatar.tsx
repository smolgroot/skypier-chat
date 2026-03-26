import { Avatar } from '@mui/material';
import Jazzicon from 'react-jazzicon';

interface UserAvatarProps {
  seed: string;
  size?: number;
  displayName?: string;
  src?: string | null;
  sx?: any;
}

export function UserAvatar({ seed, size = 40, displayName, src, sx }: UserAvatarProps) {
  // Hash the full seed string (peer IDs share prefixes, so full value matters).
  // FNV-1a 32-bit for deterministic, fast icon seeds.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const avatarSeed = (hash >>> 0) || 1;

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
