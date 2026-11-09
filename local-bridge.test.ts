import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeLocalBridgeCommand } from "./local-bridge.ts";

test("local bridge reads only regular files inside the enrolled workspace", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "maya-bridge-root-"));
  const root = path.join(parent, "workspace");
  const outside = path.join(parent, "outside");
  fs.mkdirSync(root); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, "README.md"), "Maya workspace");
  fs.writeFileSync(path.join(outside, "private.txt"), "outside secret");
  try {
    const result = await executeLocalBridgeCommand(root, "workspace.read_file", { path: "README.md" }) as any;
    assert.equal(result.content, "Maya workspace");
    assert.equal(result.path, "README.md");
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.read_file", { path: "../outside/private.txt" }), /escapes/i);
    if (process.platform !== "win32") {
      fs.symlinkSync(outside, path.join(root, "linked-outside"), "dir");
      fs.symlinkSync(path.join(root, "inside.txt"), path.join(root, "linked-inside.txt"), "file");
      await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.read_file", { path: "linked-outside/private.txt" }), /symbolic links/i);
      await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.read_file", { path: "linked-inside.txt" }), /symbolic links/i);
    }
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test("local bridge permits only bounded replacement of an existing non-sensitive file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-bridge-policy-"));
  try {
    fs.writeFileSync(path.join(root, ".env"), "SECRET=value");
    fs.writeFileSync(path.join(root, "notes.txt"), "safe");
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.read_file", { path: ".env" }), /sensitive/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: ".env", content: "SECRET=changed" }), /sensitive/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "shell.exec", { command: "whoami" }), /allowlist/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: "new-file.txt", content: "not allowed" }), /does not exist|resolve/i);
    const written = await executeLocalBridgeCommand(root, "workspace.write_file", { path: "notes.txt", content: "Founder-approved local replacement" }) as any;
    assert.equal(written.verified, true);
    assert.equal(written.path, "notes.txt");
    assert.match(written.sha256, /^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(path.join(root, "notes.txt"), "utf8"), "Founder-approved local replacement");
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: "notes.txt", content: "x".repeat(100_001) }), /100 KB/i);
    const entries = await executeLocalBridgeCommand(root, "workspace.list", {}) as any[];
    assert.ok(!entries.some(entry => entry.name === ".env"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
