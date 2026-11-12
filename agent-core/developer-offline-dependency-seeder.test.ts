import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { seedOfflineWorkspaceDependencies } from "./developer-offline-dependency-seeder.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "maya-dependency-seed-"));
  const workspace = path.join(root, "workspace");
  const source = path.join(root, "image-node-modules");
  await fs.mkdir(workspace);
  await fs.mkdir(path.join(source, ".bin"), { recursive: true });
  const packageJson = JSON.stringify({ name: "fixture", scripts: { test: "node test.js" } });
  const lock = '{"lockfileVersion":1}';
  await fs.writeFile(path.join(workspace, "package.json"), packageJson);
  await fs.writeFile(path.join(workspace, "bun.lock"), lock);
  await fs.writeFile(path.join(source, "fixture.js"), "module.exports = 1;");
  await fs.writeFile(path.join(source, ".bin", "fixture"), "#!/usr/bin/env node\n");
  await fs.chmod(path.join(source, ".bin", "fixture"), 0o755);
  const manifest = path.join(root, "manifest.json");
  await fs.writeFile(manifest, JSON.stringify({ version: 1, packageJsonSha256: hash(packageJson), bunLockSha256: hash(lock) }));
  return { root, workspace, source, manifest };
}

test("seeds image-baked dependencies after exact package and lock digest checks", async () => {
  const f = await fixture();
  try {
    const result = await seedOfflineWorkspaceDependencies({ workspaceRoot: f.workspace, sourceNodeModules: f.source, manifestPath: f.manifest });
    assert.equal(result.entries, 3);
    assert.equal(await fs.readFile(path.join(f.workspace, "node_modules", "fixture.js"), "utf8"), "module.exports = 1;");
    assert.ok((await fs.stat(path.join(f.workspace, "node_modules", ".bin", "fixture"))).mode & 0o010);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test("rejects a workspace whose package manifest differs from the image baseline", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.workspace, "package.json"), '{"name":"changed"}');
    await assert.rejects(
      seedOfflineWorkspaceDependencies({ workspaceRoot: f.workspace, sourceNodeModules: f.source, manifestPath: f.manifest }),
      /differs from the dependency image baseline/,
    );
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test("refuses to overwrite a workspace node_modules directory", async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.workspace, "node_modules"));
    await assert.rejects(
      seedOfflineWorkspaceDependencies({ workspaceRoot: f.workspace, sourceNodeModules: f.source, manifestPath: f.manifest }),
      /refusing to overwrite/,
    );
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test("rejects dependency symlinks that escape the image node_modules root", async () => {
  const f = await fixture();
  try {
    await fs.symlink(f.manifest, path.join(f.source, "outside-link"));
    await assert.rejects(
      seedOfflineWorkspaceDependencies({ workspaceRoot: f.workspace, sourceNodeModules: f.source, manifestPath: f.manifest }),
      /symlink outside/,
    );
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});
