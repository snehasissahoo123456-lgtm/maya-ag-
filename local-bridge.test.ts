import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeLocalBridgeCommand } from "../local-bridge.ts";

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
    assert.throws(() => executeLocalBridgeCommand(root, "workspace.read_file", { path: "../outside/private.txt" }), /escapes/i);
    if (process.platform !== "win32") {
      fs.symlinkSync(outside, path.join(root, "linked-outside"), "dir");
      assert.throws(() => executeLocalBridgeCommand(root, "workspace.read_file", { path: "linked-outside/private.txt" }), /escapes/i);
    }
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test("local bridge blocks credentials and all write or shell commands", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-bridge-policy-"));
  try {
    fs.writeFileSync(path.join(root, ".env"), "SECRET=value");
    fs.writeFileSync(path.join(root, "notes.txt"), "safe");
    assert.throws(() => executeLocalBridgeCommand(root, "workspace.read_file", { path: ".env" }), /sensitive/i);
    assert.throws(() => executeLocalBridgeCommand(root, "shell.exec", { command: "whoami" }), /allowlist/i);
    assert.throws(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: "notes.txt", content: "bad" }), /allowlist/i);
    const entries = executeLocalBridgeCommand(root, "workspace.list", {}) as any[];
    assert.ok(!entries.some(entry => entry.name === ".env"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
