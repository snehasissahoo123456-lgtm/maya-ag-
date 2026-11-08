import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { DeviceBridgeManager } from "./device-bridge-manager.ts";
import { FileDeviceRegistry } from "./file-device-registry.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

class FakeSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: any[] = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = WebSocket.CLOSED; this.emit("close"); }
  receive(value: unknown) { this.emit("message", Buffer.from(JSON.stringify(value))); }
}

test("device bridge pairs, authenticates commands to one Founder and rejects non-allowlisted actions", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-device-manager-"));
  try {
    const registry = new FileDeviceRegistry(directory);
    const manager = new DeviceBridgeManager(registry);
    const pairing = await manager.createPairing("founder-a");
    const socket = new FakeSocket();
    manager.accept(socket as any);
    socket.receive({ type: "pair", code: pairing.code, device: { name: "Test PC", platform: "linux", architecture: "x64", runtimeVersion: "test" } });
    await new Promise(resolve => setTimeout(resolve, 10));
    const paired = socket.sent.find(item => item.type === "paired");
    assert.ok(paired?.token);
    const commandPromise = manager.executeCommand({ deviceId: paired.device.id, founderId: "founder-a", command: "system.info" });
    await new Promise(resolve => setTimeout(resolve, 0));
    const command = socket.sent.find(item => item.type === "command");
    assert.ok(command?.requestId);
    socket.receive({ type: "command_result", requestId: command.requestId, success: true, result: { platform: "linux" } });
    assert.deepEqual(await commandPromise, { platform: "linux" });
    await assert.rejects(() => manager.executeCommand({ deviceId: paired.device.id, founderId: "founder-b", command: "system.info" }), /offline or not registered/i);
    await assert.rejects(() => manager.executeCommand({ deviceId: paired.device.id, founderId: "founder-a", command: "shell.exec", args: { command: "whoami" } }), /read-only allowlist/i);
    assert.equal((await manager.list("founder-a"))[0].online, true);
    assert.equal(await manager.revoke(paired.device.id, "founder-a"), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
