import type { DeviceIdentity, SessionSecuritySummary } from '@skypier/protocol';

export interface UnlockCapabilities {
  biometricsAvailable: boolean;
  secureHardwareAvailable: boolean;
  canPersistWrappedKey: boolean;
}

export interface UnlockSession {
  unlockedAt: string;
  expiresAt: string;
  protectedBy: 'passphrase' | 'biometric' | 'hardware-backed';
}

export interface KeyCustodyPlan {
  device: DeviceIdentity;
  capabilities: UnlockCapabilities;
  recommendation: string;
}

export function createSecuritySummary(): SessionSecuritySummary {
  return {
    transport: 'noise',
    transportStatus: 'planned',
    contentEncryption: 'recipient-envelope',
    localStorageEncryption: 'wrapped-device-key',
  };
}

export function createKeyCustodyPlan(device: DeviceIdentity, capabilities: UnlockCapabilities): KeyCustodyPlan {
  if (capabilities.secureHardwareAvailable) {
    return {
      device,
      capabilities,
      recommendation: 'Store the wrapped identity key in secure hardware and require biometrics to unwrap it.',
    };
  }

  if (capabilities.biometricsAvailable) {
    return {
      device,
      capabilities,
      recommendation: 'Protect the local wrapping key with platform biometrics and rotate the unlock session aggressively.',
    };
  }

  return {
    device,
    capabilities,
    recommendation: 'Fallback to passphrase-protected local key wrapping and encourage encrypted backup export.',
  };
}
