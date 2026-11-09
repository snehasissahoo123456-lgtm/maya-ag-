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
      await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: "linked-inside.txt", content: "symlink write" }), /symbolic links/i);
      await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: "linked-outside/private.txt", content: "symlink write" }), /symbolic links/i);
    }
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test("local bridge permits only bounded replacement of an existing non-sensitive file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-bridge-policy-"));
  try {
    fs.writeFileSync(path.join(root, ".env"), "SECRET=value");
    fs.mkdirSync(path.join(root, ".ssh"));
    fs.writeFileSync(path.join(root, ".ssh", "id_ed25519"), "PRIVATE KEY");
    fs.mkdirSync(path.join(root, ".aws"));
    fs.writeFileSync(path.join(root, ".aws", "credentials"), "AWS_SECRET");
    fs.writeFileSync(path.join(root, "notes.txt"), "safe");
    fs.writeFileSync(path.join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.read_file", { path: ".env" }), /sensitive/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: ".env", content: "SECRET=changed" }), /sensitive/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.read_file", { path: ".ssh/id_ed25519" }), /sensitive/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: ".aws/credentials", content: "AWS_SECRET=changed" }), /sensitive/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_file", { path: ".ssh/new_key", content: "PRIVATE KEY" }), /sensitive/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "shell.exec", { command: "whoami" }), /allowlist/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: "new-file.txt", content: "not allowed" }), /does not exist|resolve/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: "binary.dat", content: "text replacement" }), /binary files/i);
    const written = await executeLocalBridgeCommand(root, "workspace.write_file", { path: "notes.txt", content: "Founder-approved local replacement" }) as any;
    assert.equal(written.verified, true);
    assert.equal(written.path, "notes.txt");
    assert.match(written.sha256, /^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(path.join(root, "notes.txt"), "utf8"), "Founder-approved local replacement");
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.write_file", { path: "notes.txt", content: "x".repeat(100_001) }), /100 KB/i);

    fs.mkdirSync(path.join(root, "reports"));
    const created = await executeLocalBridgeCommand(root, "workspace.create_file", { path: "reports/new-status.md", content: "Founder-approved new file" }) as any;
    assert.equal(created.verified, true);
    assert.equal(created.created, true);
    assert.match(created.sha256, /^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(path.join(root, "reports", "new-status.md"), "utf8"), "Founder-approved new file");
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_file", { path: "reports/new-status.md", content: "must not overwrite" }), /already exists/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_file", { path: "missing/new-file.md", content: "no parent" }), /parent does not exist/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_file", { path: ".env", content: "SECRET=value" }), /sensitive/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_file", { path: "reports/binary.txt", content: "\u0000binary" }), /plain text/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_file", { path: "reports/oversized.md", content: "x".repeat(100_001) }), /100 KB/i);
    if (process.platform !== "win32") {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maya-create-outside-"));
      try {
        fs.symlinkSync(outside, path.join(root, "reports-link"), "dir");
        await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_file", { path: "reports-link/escape.md", content: "escape" }), /symbolic links/i);
      } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    }
    const entries = await executeLocalBridgeCommand(root, "workspace.list", {}) as any[];
    assert.ok(!entries.some(entry => entry.name === ".env"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
