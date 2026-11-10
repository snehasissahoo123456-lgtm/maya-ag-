import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DeviceMetadata, DeviceRegistry, PairedDevice, RegisteredDevice } from "./device-registry.ts";

interface StoredDevice extends RegisteredDevice { tokenHash: string; }
interface Pairing { codeHash: string; founderId: string; createdAt: string; expiresAt: string; consumedAt?: string; }
interface RegistryFile { version: 1; devices: StoredDevice[]; pairings: Pairing[]; }
const CAPABILITIES = ["system.info", "workspace.list", "workspace.read_file", "workspace.write_file", "workspace.create_file"];

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Local single-instance registry; only token hashes are persisted. */
export class FileDeviceRegistry implements DeviceRegistry {
  private readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();
  constructor(directory = process.env.MAYA_DATA_DIR || path.resolve(process.cwd(), "..", "maya-data")) {
    this.filePath = path.join(path.resolve(directory), "devices.json");
    this.read();
  }

  async createPairing(founderId: string, now = Date.now()): Promise<{ code: string; expiresAt: string }> {
    if (!founderId) throw new Error("Founder identity is required.");
    const code = randomBytes(9).toString("base64url").toUpperCase();
    const expiresAt = new Date(now + 5 * 60_000).toISOString();
    await this.mutate(state => {
      state.pairings = state.pairings.filter(item => Date.parse(item.expiresAt) > now && !item.consumedAt).slice(-99);
      state.pairings.push({ codeHash: hash(code), founderId, createdAt: new Date(now).toISOString(), expiresAt });
    });
    return { code, expiresAt };
  }

  async pair(code: string, metadata: DeviceMetadata, now = Date.now()): Promise<PairedDevice> {
    if (!code || code.length > 64) throw new Error("A valid one-time pairing code is required.");
    this.validateMetadata(metadata);
    let paired: PairedDevice | undefined;
    await this.mutate(state => {
      const codeHash = hash(code.trim().toUpperCase());
      const pairing = state.pairings.find(item => safeEqualHex(item.codeHash, codeHash) && !item.consumedAt && Date.parse(item.expiresAt) > now);
      if (!pairing) throw new Error("Pairing code is invalid, expired or already used.");
      const activeDevices = state.devices.filter(item => item.founderId === pairing.founderId && !item.revokedAt);
      if (activeDevices.length >= 10) throw new Error("Founder device limit reached.");
      const token = randomBytes(32).toString("base64url");
      const createdAt = new Date(now).toISOString();
      const device: RegisteredDevice = {
        id: randomUUID(), founderId: pairing.founderId, name: metadata.name.trim(),
        platform: metadata.platform, architecture: metadata.architecture, runtimeVersion: metadata.runtimeVersion,
        capabilities: [...CAPABILITIES], createdAt, lastSeenAt: createdAt,
      };
      state.devices.push({ ...device, tokenHash: hash(token) });
      pairing.consumedAt = createdAt;
      paired = { device: structuredClone(device), token };
    });
    if (!paired) throw new Error("Pairing did not complete.");
    return paired;
  }

  async authenticate(deviceId: string, founderId: string, token: string): Promise<RegisteredDevice | undefined> {
    const device = this.read().devices.find(item => item.id === deviceId && item.founderId === founderId && !item.revokedAt);
    if (!device || !safeEqualHex(device.tokenHash, hash(token))) return undefined;
    const { tokenHash: _secret, ...publicDevice } = device;
    return structuredClone(publicDevice);
  }

  async touch(deviceId: string, founderId: string): Promise<void> {
    await this.mutate(state => {
      const device = state.devices.find(item => item.id === deviceId && item.founderId === founderId && !item.revokedAt);
      if (!device) throw new Error("Device is not registered for this Founder.");
      device.lastSeenAt = new Date().toISOString();
    });
  }

  async list(founderId: string): Promise<RegisteredDevice[]> {
    return this.read().devices.filter(item => item.founderId === founderId).map(({ tokenHash: _secret, ...device }) => structuredClone(device));
  }

  async revoke(deviceId: string, founderId: string): Promise<boolean> {
    let revoked = false;
    await this.mutate(state => {
      const device = state.devices.find(item => item.id === deviceId && item.founderId === founderId && !item.revokedAt);
      if (!device) return;
      device.revokedAt = new Date().toISOString();
      revoked = true;
    });
    return revoked;
  }

  private validateMetadata(metadata: DeviceMetadata): void {
    for (const [name, value, max] of [
      ["name", metadata?.name, 100], ["platform", metadata?.platform, 40],
      ["architecture", metadata?.architecture, 40], ["runtimeVersion", metadata?.runtimeVersion, 40],
    ] as const) {
      if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Device ${name} is invalid.`);
    }
  }

  private read(): RegistryFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, devices: [], pairings: [] };
    let parsed: any;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")); }
    catch { throw new Error("Device registry is corrupt; refusing to overwrite it."); }
    if (parsed?.version !== 1 || !Array.isArray(parsed.devices) || !Array.isArray(parsed.pairings)) throw new Error("Device registry format is invalid.");
    return parsed as RegistryFile;
  }

  private async mutate(change: (state: RegistryFile) => void): Promise<void> {
    const operation = this.queue.then(() => {
      const state = this.read();
      change(state);
      this.write(state);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private write(state: RegistryFile): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
    const temp = path.join(directory, `.devices.${process.pid}.${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(temp, this.filePath); }
    catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
}
