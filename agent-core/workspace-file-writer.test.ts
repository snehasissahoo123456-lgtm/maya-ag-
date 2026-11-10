import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { replaceWorkspaceFile } from "./workspace-file-writer.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("replaces an existing workspace file atomically and returns verified evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-dev-write-"));
  try {
    fs.writeFileSync(path.join(root, "src.ts"), "const value = 1;\n");
    const result = replaceWorkspaceFile(root, "src.ts", "const value = 2;\n", hash("const value = 1;\n"));
    assert.equal(fs.readFileSync(path.join(root, "src.ts"), "utf8"), "const value = 2;\n");
    assert.equal(result.path, "src.ts");
    assert.equal(result.sha256, hash("const value = 2;\n"));
    assert.equal(result.verified, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("rejects stale Developer proposals without changing the file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-dev-stale-"));
  try {
    fs.writeFileSync(path.join(root, "src.ts"), "founder edit\n");
    assert.throws(() => replaceWorkspaceFile(root, "src.ts", "developer edit\n", hash("older content\n")), /File changed since the Developer proposal/);
    assert.equal(fs.readFileSync(path.join(root, "src.ts"), "utf8"), "founder edit\n");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("blocks traversal, sensitive paths, symlinks, binary files and oversized writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maya-dev-policy-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maya-dev-outside-"));
  try {
    fs.writeFileSync(path.join(root, "file.txt"), "safe");
    fs.writeFileSync(path.join(root, ".env"), "secret");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([0xff, 0xfe, 0xfd]));
    assert.throws(() => replaceWorkspaceFile(root, "../secret.txt", "x"), /relative path|traversal/i);
    assert.throws(() => replaceWorkspaceFile(root, ".env", "x"), /secrets and credential files/);
    assert.throws(() => replaceWorkspaceFile(root, "link.txt", "x"), /symbolic links/);
    assert.throws(() => replaceWorkspaceFile(root, "binary.bin", "x"), /UTF-8/);
    assert.throws(() => replaceWorkspaceFile(root, "file.txt", "x".repeat(100_001)), /100 KB/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
