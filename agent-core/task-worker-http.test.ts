import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate test port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Maya test server exited early (code ${child.exitCode}).`);
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Maya worker test server did not become healthy.");
}

test("opt-in server worker automatically completes only the safe read-only queued task", async () => {
  const port = await unusedPort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-worker-http-"));
  const password = "test-founder-password-2026-worker";
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      MAYA_DATA_DIR: dataDir,
      MAYA_FOUNDER_EMAIL: "worker-founder@example.invalid",
      MAYA_FOUNDER_PASSWORD: password,
      MAYA_TASK_WORKER_ENABLED: "true",
      MAYA_TASK_WORKER_POLL_MS: "1000",
      GEMINI_API_KEY: "",
      API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", chunk => { logs += chunk.toString(); });
  child.stderr?.on("data", chunk => { logs += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(baseUrl, child);
    const health = await (await fetch(baseUrl + "/api/health")).json() as any;
    assert.equal(health.taskWorker.enabled, true);

    const login = await fetch(baseUrl + "/api/auth/founder-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "worker-founder@example.invalid", password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const created = await fetch(baseUrl + "/api/control-plane/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ instruction: "Worker should read README", path: "README.md" }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as any;
    const taskId = createdBody.task.id;
    assert.equal(createdBody.task.status, "queued");

    const deadline = Date.now() + 12_000;
    let finished: any = null;
    while (Date.now() < deadline) {
      const response = await fetch(baseUrl + "/api/control-plane/tasks", { headers: { cookie } });
      assert.equal(response.status, 200);
      const data = await response.json() as any;
      finished = data.tasks.find((item: any) => item.task.id === taskId);
      if (finished?.task.status === "completed" || finished?.task.status === "failed") break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    assert.equal(finished?.task.status, "completed", `Worker did not complete task. Server output:\n${logs}`);
    assert.match(finished.task.verificationEvidence[0].reference, /^sha256:[a-f0-9]{64}$/);
    assert.equal(finished.capability, "workspace.read_file");
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nServer output:\n${logs}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
