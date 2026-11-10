import test from "node:test";
import { spawnSync } from "node:child_process";
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

test("local bridge creates only one new directory under an existing non-sensitive parent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-bridge-directory-"));
  try {
    fs.mkdirSync(path.join(root, "projects"));
    fs.mkdirSync(path.join(root, ".ssh"));
    const created = await executeLocalBridgeCommand(root, "workspace.create_directory", { path: "projects/new-project" }) as any;
    assert.equal(created.created, true);
    assert.equal(created.verified, true);
    assert.equal(created.path, path.join("projects", "new-project"));
    assert.equal(fs.statSync(path.join(root, "projects", "new-project")).isDirectory(), true);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_directory", { path: "projects/new-project" }), /already exists/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_directory", { path: "missing/child" }), /parent does not exist/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_directory", { path: "../outside" }), /escapes|dot segments/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_directory", { path: "." }), /dot segments|equals/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_directory", { path: "projects/\0bad" }), /valid workspace-relative/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_directory", { path: ".ssh/new-key-dir" }), /sensitive/i);
    if (process.platform !== "win32") {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maya-directory-outside-"));
      try {
        fs.symlinkSync(outside, path.join(root, "linked-parent"), "dir");
        await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.create_directory", { path: "linked-parent/escape" }), /symbolic links/i);
      } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    }
    await assert.rejects(() => executeLocalBridgeCommand(root, "shell.exec", { command: "whoami" }), /allowlist/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test("local bridge moves only regular non-sensitive files without overwriting and verifies bytes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-bridge-move-"));
  try {
    fs.mkdirSync(path.join(root, "inbox"));
    fs.mkdirSync(path.join(root, "archive"));
    fs.mkdirSync(path.join(root, ".ssh"));
    fs.writeFileSync(path.join(root, "inbox", "report.md"), "move this exact content");
    fs.writeFileSync(path.join(root, "archive", "existing.md"), "keep destination");
    fs.writeFileSync(path.join(root, ".ssh", "id_ed25519"), "private key");
    fs.linkSync(path.join(root, ".ssh", "id_ed25519"), path.join(root, "mirror.txt"));
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.move_file", {
      fromPath: "mirror.txt", toPath: "archive/mirror.txt",
    }), /hard-linked/i);
    assert.equal(fs.existsSync(path.join(root, "mirror.txt")), true);
    const moved = await executeLocalBridgeCommand(root, "workspace.move_file", {
      fromPath: "inbox/report.md", toPath: "archive/report.md",
    }) as any;
    assert.equal(moved.moved, true);
    assert.equal(moved.verified, true);
    assert.equal(moved.fromPath, path.join("inbox", "report.md"));
    assert.equal(moved.toPath, path.join("archive", "report.md"));
    assert.match(moved.sha256, /^[a-f0-9]{64}$/);
    assert.equal(fs.existsSync(path.join(root, "inbox", "report.md")), false);
    assert.equal(fs.readFileSync(path.join(root, "archive", "report.md"), "utf8"), "move this exact content");
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.move_file", {
      fromPath: "archive/report.md", toPath: "archive/existing.md",
    }), /already exists/i);
    assert.equal(fs.existsSync(path.join(root, "archive", "report.md")), true);
    assert.equal(fs.readFileSync(path.join(root, "archive", "existing.md"), "utf8"), "keep destination");
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.move_file", {
      fromPath: ".ssh/id_ed25519", toPath: "archive/key.txt",
    }), /sensitive/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.move_file", {
      fromPath: "archive/report.md", toPath: "../outside.md",
    }), /escapes/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.move_file", {
      fromPath: "archive/report.md", toPath: "archive/report.md",
    }), /already exists|different/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.move_file", {
      fromPath: "missing.txt", toPath: "archive/missing.txt",
    }), /does not exist|resolve/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.move_file", {
      fromPath: "archive/report.md", toPath: "missing-parent/report.md",
    }), /parent does not exist/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.move_file", {
      fromPath: "archive", toPath: "archive-folder",
    }), /regular non-symlink files/i);
    fs.writeFileSync(path.join(root, "oversized.bin"), Buffer.alloc(5_000_001, 1));
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.move_file", {
      fromPath: "oversized.bin", toPath: "archive/oversized.bin",
    }), /5 MB/i);
    assert.equal(fs.existsSync(path.join(root, "oversized.bin")), true);
    if (process.platform !== "win32") {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maya-move-outside-"));
      try {
        fs.symlinkSync(outside, path.join(root, "linked"), "dir");
        await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.move_file", {
          fromPath: "archive/report.md", toPath: "linked/escape.md",
        }), /symbolic links/i);
      } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    }
    await assert.rejects(() => executeLocalBridgeCommand(root, "shell.exec", { command: "whoami" }), /allowlist/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("local bridge returns bounded read-only Git status without diff contents", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-bridge-git-status-"));
  try {
    fs.writeFileSync(path.join(root, "notes.md"), "tracked note");
    fs.writeFileSync(path.join(root, ".env"), "SECRET=value");
    const initialized = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(initialized.status, 0, initialized.stderr);
    const staged = spawnSync("git", ["add", "notes.md", ".env"], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(staged.status, 0, staged.stderr);
    const result = await executeLocalBridgeCommand(root, "workspace.git_status", { path: "." }) as any;
    assert.equal(result.repository, ".");
    assert.match(result.branch, /No commits yet|main|master/);
    assert.ok(result.changes.some((change: any) => change.path === "notes.md"));
    assert.equal(result.changes.some((change: any) => change.path === ".env"), false);
    assert.equal(typeof result.changeCount, "number");
    assert.equal(result.truncated, false);
    assert.equal("diff" in result, false);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.git_status", { path: "../outside" }), /escapes/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "shell.exec", { command: "whoami" }), /allowlist/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test("local bridge search is bounded, literal and excludes sensitive, binary and symlink paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-bridge-search-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, ".ssh"));
    fs.writeFileSync(path.join(root, "src", "agent.ts"), "export function executeTask() { return true; }\nconst other = 1;");
    fs.writeFileSync(path.join(root, "src", "config.ts"), 'const apiKey = "private-value-123";\\nconst data = {"client_secret": "json-secret-456"};\\nconst auth = "Authorization: Bearer bearer-secret-789";\\nconst provider = "sk-proj-1234567890123456789012345678";');
    fs.writeFileSync(path.join(root, "README.md"), "Maya local workspace\nTask worker documentation");
    fs.writeFileSync(path.join(root, ".env"), "GEMINI_API_KEY=private-token");
    fs.writeFileSync(path.join(root, ".ssh", "id_ed25519"), "private-key");
    fs.writeFileSync(path.join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    const result = await executeLocalBridgeCommand(root, "workspace.search_files", {
      path: ".", query: "EXECUTETASK", maxResults: 50,
    }) as any;
    assert.equal(result.query, "EXECUTETASK");
    assert.ok(result.matches.some((item: any) => item.path === path.join("src", "agent.ts") && item.line === 1));
    assert.equal(result.matches.some((item: any) => String(item.preview).includes("GEMINI_API_KEY")), false);
    assert.equal(result.matches.some((item: any) => item.path.includes(".ssh")), false);
    assert.equal(result.matches.some((item: any) => item.path === "binary.dat"), false);
    assert.equal(typeof result.filesScanned, "number");
    assert.equal(typeof result.directoriesScanned, "number");
    assert.equal(result.truncated, false);
    fs.writeFileSync(path.join(root, "large.txt"), Buffer.alloc(256_001, 65));
    const bounded = await executeLocalBridgeCommand(root, "workspace.search_files", { query: "not-present" }) as any;
    assert.equal(bounded.truncated, true);
    const redacted = await executeLocalBridgeCommand(root, "workspace.search_files", { query: "apiKey" }) as any;
    const credentialMatch = redacted.matches.find((item: any) => item.path === path.join("src", "config.ts"));
    assert.ok(credentialMatch);
    assert.equal(credentialMatch.preview.includes("private-value-123"), false);
    assert.equal(credentialMatch.preview.includes("[REDACTED]"), true);
    const jsonSecret = await executeLocalBridgeCommand(root, "workspace.search_files", { query: "client_secret" }) as any;
    assert.equal(jsonSecret.matches[0].preview.includes("json-secret-456"), false);
    const bearerSecret = await executeLocalBridgeCommand(root, "workspace.search_files", { query: "Bearer" }) as any;
    assert.equal(bearerSecret.matches[0].preview.includes("bearer-secret-789"), false);
    const providerSecret = await executeLocalBridgeCommand(root, "workspace.search_files", { query: "sk-proj" }) as any;
    assert.equal(providerSecret.matches[0].preview.includes("sk-proj-1234567890123456789012345678"), false);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.search_files", { query: "" }), /1–200 characters/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.search_files", { query: "x".repeat(201) }), /1–200 characters/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.search_files", { path: "../outside", query: "token" }), /escapes/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "shell.exec", { command: "whoami" }), /allowlist/i);
    if (process.platform !== "win32") {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maya-search-outside-"));
      try {
        fs.writeFileSync(path.join(outside, "secret.txt"), "needle");
        fs.symlinkSync(outside, path.join(root, "linked"), "dir");
        const linked = await executeLocalBridgeCommand(root, "workspace.search_files", { query: "needle" }) as any;
        assert.equal(linked.matches.some((item: any) => String(item.path).includes("linked")), false);
      } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test("local bridge directory listing is bounded and excludes sensitive and symlink entries", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-bridge-list-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, ".ssh"));
    fs.writeFileSync(path.join(root, "README.md"), "safe");
    fs.writeFileSync(path.join(root, ".env"), "GEMINI_API_KEY=private");
    fs.writeFileSync(path.join(root, ".ssh", "id_ed25519"), "private");
    if (process.platform !== "win32") {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maya-list-outside-"));
      try {
        fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
        fs.symlinkSync(outside, path.join(root, "linked"), "dir");
        const entries = await executeLocalBridgeCommand(root, "workspace.list", { path: "." }) as any[];
        assert.ok(entries.some(item => item.name === "README.md" && item.type === "file"));
        assert.ok(entries.some(item => item.name === "src" && item.type === "directory"));
        assert.equal(entries.some(item => item.name === ".env" || item.name === ".ssh" || item.name === "linked"), false);
      } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    } else {
      const entries = await executeLocalBridgeCommand(root, "workspace.list", { path: "." }) as any[];
      assert.ok(entries.some(item => item.name === "README.md" && item.type === "file"));
      assert.equal(entries.some(item => item.name === ".env" || item.name === ".ssh"), false);
    }
    const detailed = await executeLocalBridgeCommand(root, "workspace.list_directory", { path: "." }) as any;
    assert.equal(detailed.path, ".");
    assert.equal(detailed.count, detailed.entries.length);
    assert.equal(detailed.truncated, false);
    assert.ok(detailed.entries.some((item: any) => item.name === "README.md" && item.type === "file"));
    assert.equal(detailed.entries.some((item: any) => item.name === ".env" || item.name === ".ssh" || item.name === "linked"), false);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.list", { path: "../outside" }), /escapes/i);
    await assert.rejects(() => executeLocalBridgeCommand(root, "workspace.list_directory", { path: "../outside" }), /escapes/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
