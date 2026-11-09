import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { DeviceBridgeManager, DeviceCommandUncertainError } from "./device-bridge-manager.ts";
import { FileDeviceRegistry } from "./file-device-registry.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
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
    await assert.rejects(() => manager.executeCommand({ deviceId: paired.device.id, founderId: "founder-b", command: "system.info" }), /not registered/i);
    await assert.rejects(() => manager.executeCommand({ deviceId: paired.device.id, founderId: "founder-a", command: "shell.exec", args: { command: "whoami" } }), /read-only allowlist/i);
    await assert.rejects(() => manager.executeCommand({ deviceId: paired.device.id, founderId: "founder-a", command: "workspace.write_file", args: { path: "notes.txt", content: "bypass" } }), /read-only allowlist/i);
    assert.equal((await manager.list("founder-a"))[0].online, true);
    assert.equal(await manager.revoke(paired.device.id, "founder-a"), true);
    assert.equal(manager.isOnline(paired.device.id, "founder-a"), false);
    await assert.rejects(() => manager.executeCommand({ deviceId: paired.device.id, founderId: "founder-a", command: "system.info" }), /revoked/i);
    await assert.rejects(() => manager.executeApprovedWrite({
      deviceId: paired.device.id, founderId: "founder-a", path: "notes.txt", content: "must not write after revoke",
    }), /revoked/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


test("approved local file replacement uses a separate server-only command path", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-device-approved-write-"));
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

    const writePromise = manager.executeApprovedWrite({
      deviceId: paired.device.id,
      founderId: "founder-a",
      path: "reports/status.md",
      content: "Exact Founder-approved content",
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    const command = socket.sent.find(item => item.type === "command" && item.command === "workspace.write_file");
    assert.ok(command?.requestId);
    assert.deepEqual(command.args, { path: "reports/status.md", content: "Exact Founder-approved content" });
    socket.receive({ type: "command_result", requestId: command.requestId, success: true, result: { verified: true, sha256: "a".repeat(64) } });
    assert.deepEqual(await writePromise, { verified: true, sha256: "a".repeat(64) });
    await assert.rejects(() => manager.executeApprovedWrite({
      deviceId: paired.device.id, founderId: "founder-b", path: "reports/status.md", content: "wrong founder",
    }), /not registered/i);
    await assert.rejects(() => manager.executeApprovedWrite({
      deviceId: paired.device.id, founderId: "founder-a", path: "reports/status.md", content: "x".repeat(100_001),
    }), /100 KB/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


test("disconnect during a local write reports an uncertain side effect", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "maya-device-write-disconnect-"));
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
    const pending = manager.executeApprovedWrite({
      deviceId: paired.device.id, founderId: "founder-a", path: "notes.md", content: "approved replacement",
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(socket.sent.some(item => item.type === "command" && item.command === "workspace.write_file"));
    socket.close();
    await assert.rejects(pending, DeviceCommandUncertainError);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
