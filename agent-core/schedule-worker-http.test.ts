import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate test port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function waitForServer(url: string, child: ChildProcess) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Maya scheduler test server exited early.");
    try { if ((await fetch(url + "/api/health")).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("Maya scheduler test server did not become healthy.");
}

test("live schedule worker enqueues and TaskWorker completes a read-only file task", async () => {
  const port = await unusedPort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-schedule-http-"));
  const password = "test-schedule-founder-password-2026";
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: "production", PORT: String(port), MAYA_DATA_DIR: dataDir,
      MAYA_TASK_WORKER_ENABLED: "true", MAYA_TASK_WORKER_POLL_MS: "1000",
      MAYA_SCHEDULE_WORKER_ENABLED: "true", MAYA_SCHEDULE_WORKER_POLL_MS: "1000",
      MAYA_FOUNDER_EMAIL: "scheduler-test@example.invalid", MAYA_FOUNDER_PASSWORD: password,
      MAYA_STORAGE_DRIVER: "file", GEMINI_API_KEY: "", API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", chunk => { logs += chunk.toString(); });
  child.stderr?.on("data", chunk => { logs += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(baseUrl, child);
    const login = await fetch(baseUrl + "/api/auth/founder-login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "scheduler-test@example.invalid", password }),
    });
    assert.equal(login.status, 200, logs);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const created = await fetch(baseUrl + "/api/schedules", {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ title: "Automated README check", path: "README.md", runAt: new Date(Date.now() - 1000).toISOString(), intervalMs: null }),
    });
    assert.equal(created.status, 201, await created.text());
    const createdBody = await created.json() as any;
    const scheduleId = createdBody.schedule.id;

    const deadline = Date.now() + 15_000;
    let task: any;
    let schedule: any;
    while (Date.now() < deadline) {
      const [tasksResponse, schedulesResponse] = await Promise.all([
        fetch(baseUrl + "/api/control-plane/tasks", { headers: { cookie } }),
        fetch(baseUrl + `/api/schedules/${scheduleId}`, { headers: { cookie } }),
      ]);
      const tasksBody = await tasksResponse.json() as any;
      const scheduleBody = await schedulesResponse.json() as any;
      task = tasksBody.tasks?.find((item: any) => item.task?.instruction?.includes("Automated README check"));
      schedule = scheduleBody.schedule;
      if (task?.task?.status === "completed" && schedule?.status === "completed") break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(schedule?.status, "completed", logs);
    assert.equal(schedule?.runCount, 1);
    assert.equal(task?.capability, "workspace.read_file");
    assert.equal(task?.task?.status, "completed", logs);
    assert.ok((task?.task?.verificationEvidence || []).length > 0, "completed scheduled task must include verification evidence");
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
