import type { DeviceRegistry } from "./device-registry.ts";
import { FileDeviceRegistry } from "./file-device-registry.ts";

export function createDeviceRegistry(): DeviceRegistry {
  // Pairing registry is local single-instance until the Supabase device adapter is added.
  return new FileDeviceRegistry();
}
