import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { RegisteredDevice, DeviceMetadata, DeviceRegistry } from "./device-registry.ts";

type SocketLike = WebSocket;
interface ConnectedDevice { device: RegisteredDevice; socket: SocketLike; }
interface PendingCommand { deviceId: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; sideEffecting?: boolean; }

export class DeviceCommandUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceCommandUncertainError";
  }
}
const ALLOWED_COMMANDS = new Set(["system.info", "workspace.list", "workspace.read_file"]);

export class DeviceBridgeManager {
  private readonly connected = new Map<string, ConnectedDevice>();
  private readonly pending = new Map<string, PendingCommand>();
  constructor(private readonly registry: DeviceRegistry, private readonly commandTimeoutMs = 15_000) {}

  createPairing(founderId: string): Promise<{ code: string; expiresAt: string }> {
    return this.registry.createPairing(founderId);
  }

  accept(socket: SocketLike): void {
    let device: RegisteredDevice | undefined;
    let authTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => socket.close(4001, "Authentication timeout"), 5_000);
    const send = (payload: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };
    const cleanup = () => {
      if (authTimer) clearTimeout(authTimer);
      if (!device) return;
      const current = this.connected.get(device.id);
      if (current?.socket === socket) this.connected.delete(device.id);
      for (const [id, pending] of this.pending) {
        if (pending.deviceId === device.id) {
          clearTimeout(pending.timer);
          pending.reject(pending.sideEffecting
            ? new DeviceCommandUncertainError("Device disconnected during a file replacement; verify the target file before retrying.")
            : new Error("Device disconnected during command execution."));
          this.pending.delete(id);
        }
      }
    };
    socket.on("message", async raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (!device) {
          if (message.type === "pair") {
            const paired = await this.registry.pair(String(message.code || ""), message.device as DeviceMetadata);
            device = paired.device;
            this.connected.set(device.id, { device, socket });
            if (authTimer) clearTimeout(authTimer);
            authTimer = undefined;
            send({ type: "paired", device, token: paired.token });
            return;
          }
          if (message.type === "authenticate") {
            const authenticated = await this.registry.authenticate(String(message.deviceId || ""), String(message.founderId || ""), String(message.token || ""));
            if (!authenticated) { socket.close(4003, "Invalid device credentials"); return; }
            device = authenticated;
            this.connected.set(device.id, { device, socket });
            if (authTimer) clearTimeout(authTimer);
            authTimer = undefined;
            await this.registry.touch(device.id, device.founderId);
            send({ type: "authenticated", device });
            return;
          }
          socket.close(4002, "Pair or authenticate first");
          return;
        }

        if (message.type === "heartbeat") {
          await this.registry.touch(device.id, device.founderId);
          send({ type: "heartbeat_ack", at: new Date().toISOString() });
          return;
        }
        if (message.type === "command_result") {
          const requestId = String(message.requestId || "");
          const pending = this.pending.get(requestId);
          if (!pending || pending.deviceId !== device.id) return;
          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          if (message.success !== true) {
            pending.reject(pending.sideEffecting
            ? new DeviceCommandUncertainError("Local device reported a write failure after receiving the command; verify the target file before retrying.")
            : new Error(String(message.error || "Local device command failed.").slice(0, 500)));
            return;
          }
          let serialized: string;
          try { serialized = JSON.stringify(message.result); } catch {
            pending.reject(pending.sideEffecting
              ? new DeviceCommandUncertainError("Device returned an unverifiable write result; inspect the target file before retrying.")
              : new Error("Device returned an unserializable result."));
            return;
          }
          if (serialized.length > 250_000) {
            pending.reject(pending.sideEffecting
              ? new DeviceCommandUncertainError("Device write result exceeded the response limit; inspect the target file before retrying.")
              : new Error("Device result exceeds the 250 KB limit."));
            return;
          }
          pending.resolve(message.result);
          return;
        }
        send({ type: "error", error: "Unsupported device bridge message." });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : String(error) });
        if (!device) socket.close(4002, "Pairing or authentication failed");
      }
    });
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  isOnline(deviceId: string, founderId: string): boolean {
    const current = this.connected.get(deviceId);
    return Boolean(current && current.device.founderId === founderId && !this.revokedDeviceIds.has(deviceId));
  }

  async list(founderId: string): Promise<Array<RegisteredDevice & { online: boolean }>> {
    const devices = await this.registry.list(founderId);
    return devices.map(device => ({ ...device, online: this.isOnline(device.id, founderId) }));
  }

  async revoke(deviceId: string, founderId: string): Promise<boolean> {
    const revoked = await this.registry.revoke(deviceId, founderId);
    if (!revoked) return false;
    this.revokedDeviceIds.add(deviceId);
    const current = this.connected.get(deviceId);
    if (current) current.socket.close(4004, "Device revoked by Founder");
    return true;
  }


  /**
   * Trusted server-side path used only by the task capability runner after the
   * TaskOrchestrator has consumed an exact Founder approval. This command is
   * deliberately not added to executeCommand's public read-only allowlist.
   */
  async executeApprovedWrite(input: { deviceId: string; founderId: string; path: string; content: string }): Promise<unknown> {
    if (!input.deviceId || input.deviceId.length > 128 || !input.founderId) throw new Error("A valid Founder-owned device is required.");
    if (typeof input.path !== "string" || !input.path.trim() || input.path.length > 1024) throw new Error("A valid workspace-relative path is required.");
    if (typeof input.content !== "string" || Buffer.byteLength(input.content, "utf8") > 100_000) throw new Error("Replacement content must be text no larger than 100 KB.");
    const current = this.connected.get(input.deviceId);
    if (!current || current.device.founderId !== input.founderId || this.revokedDeviceIds.has(input.deviceId)) throw new Error("Device is offline, revoked or not registered for this Founder.");
    const requestId = randomUUID();
    const args = { path: input.path, content: input.content };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new DeviceCommandUncertainError("Local device write timed out; inspect the target file before retrying."));
      }, this.commandTimeoutMs);
      this.pending.set(requestId, { deviceId: input.deviceId, resolve, reject, timer, sideEffecting: true });
      try {
        current.socket.send(JSON.stringify({ type: "command", requestId, command: "workspace.write_file", args }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new DeviceCommandUncertainError("The local write command could not be confirmed as sent; inspect the target file before retrying."));
      }
    });
  }

  async executeCommand(input: { deviceId: string; founderId: string; command: string; args?: Record<string, unknown> }): Promise<unknown> {
    if (!ALLOWED_COMMANDS.has(input.command)) throw new Error("Device command is not in the read-only allowlist.");
    const args = input.args || {};
    if (input.command === "workspace.read_file" && (typeof args.path !== "string" || !args.path.trim() || args.path.length > 1024)) {
      throw new Error("A valid relative file path is required.");
    }
    if (input.command === "workspace.list" && args.path !== undefined && (typeof args.path !== "string" || args.path.length > 1024)) {
      throw new Error("Workspace path is invalid.");
    }
    const current = this.connected.get(input.deviceId);
    if (!current || current.device.founderId !== input.founderId || this.revokedDeviceIds.has(input.deviceId)) throw new Error("Device is offline, revoked or not registered for this Founder.");
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Local device command timed out."));
      }, this.commandTimeoutMs);
      this.pending.set(requestId, { deviceId: input.deviceId, resolve, reject, timer });
      try {
        current.socket.send(JSON.stringify({ type: "command", requestId, command: input.command, args }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
