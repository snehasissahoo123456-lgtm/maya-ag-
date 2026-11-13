import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  bootstrapDeveloperExecutionRuntime,
  readDeveloperWorkspaceBinding,
} from "./developer-runtime-bootstrap.ts";

const BASELINE = "a".repeat(40);

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "maya-developer-runtime-bootstrap-"));
  const workspaceRoot = path.join(root, "workspaces");
  const queueRoot = path.join(root, "queue");
  const workspaceId = "workspace-12345678";
  await fs.mkdir(path.join(workspaceRoot, workspaceId), { recursive: true });
  await fs.mkdir(path.join(queueRoot, "baselines"), { recursive: true });
  await fs.writeFile(path.join(queueRoot, "baselines", workspaceId + ".sha"), BASELINE, "utf8");
  return { root, workspaceRoot, queueRoot, workspaceId };
}

test("workspace binding reads the single enrolled workspace and pinned baseline", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(
      await readDeveloperWorkspaceBinding(f.workspaceRoot, f.queueRoot),
      { workspaceId: f.workspaceId, baselineCommit: BASELINE },
    );
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("workspace binding rejects multiple enrolled workspaces", async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.workspaceRoot, "workspace-87654321"));
    await assert.rejects(
      () => readDeveloperWorkspaceBinding(f.workspaceRoot, f.queueRoot),
      /exactly one enrolled workspace/i,
    );
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("workspace binding rejects an invalid baseline record", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.queueRoot, "baselines", f.workspaceId + ".sha"), "not-a-git-sha", "utf8");
    await assert.rejects(
      () => readDeveloperWorkspaceBinding(f.workspaceRoot, f.queueRoot),
      /baseline commit is invalid/i,
    );
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("runtime bootstrap fails closed and lists every missing host trust setting", async () => {
  const result = await bootstrapDeveloperExecutionRuntime({
    env: {},
    changes: {} as any,
    approvals: {} as any,
  });
  assert.equal(result.configured, false);
  assert.equal(result.runtime, undefined);
  assert.deepEqual(result.blockers, [
    "Missing required runtime setting: MAYA_DEVELOPER_WORKSPACE_ROOT",
    "Missing required runtime setting: MAYA_DEVELOPER_QUEUE_ROOT",
    "Missing required runtime setting: MAYA_HOST_SUPERVISOR_SOCKET",
    "Missing required runtime setting: MAYA_HOST_SUPERVISOR_TOKEN",
    "Missing required runtime setting: MAYA_HOST_ISOLATION_PUBLIC_KEY_PEM",
    "Missing required runtime setting: MAYA_HOST_ISOLATION_ISSUER",
  ]);
});
