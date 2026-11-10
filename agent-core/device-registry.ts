export interface DeviceMetadata {
  name: string;
  platform: string;
  architecture: string;
  runtimeVersion: string;
}
export interface RegisteredDevice {
  id: string;
  founderId: string;
  name: string;
  platform: string;
  architecture: string;
  runtimeVersion: string;
  capabilities: string[];
  createdAt: string;
  lastSeenAt: string;
  revokedAt?: string;
}
export interface PairedDevice {
  device: RegisteredDevice;
  token: string;
}
export interface DeviceRegistry {
  createPairing(founderId: string, now?: number): Promise<{ code: string; expiresAt: string }>;
  pair(code: string, metadata: DeviceMetadata, now?: number): Promise<PairedDevice>;
  authenticate(deviceId: string, founderId: string, token: string): Promise<RegisteredDevice | undefined>;
  touch(deviceId: string, founderId: string): Promise<void>;
  list(founderId: string): Promise<RegisteredDevice[]>;
  revoke(deviceId: string, founderId: string): Promise<boolean>;
}
