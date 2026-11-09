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
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Maya test server exited early (code ${child.exitCode}).`);
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Maya test server did not become healthy: ${String(lastError)}`);
}

test("real HTTP control-plane routes enforce Founder auth and execute only the read-only workspace capability", async () => {
  const port = await unusedPort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-http-control-plane-"));
  const password = "test-founder-password-2026-secure";
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      MAYA_DATA_DIR: dataDir,
      MAYA_FOUNDER_EMAIL: "founder-test@example.invalid",
      MAYA_FOUNDER_PASSWORD: password,
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
    const unauthenticated = await fetch(baseUrl + "/api/control-plane/tasks");
    assert.equal(unauthenticated.status, 401);

    const login = await fetch(baseUrl + "/api/auth/founder-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "founder-test@example.invalid", password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "Founder login should set an HttpOnly session cookie");

    const csrfBlocked = await fetch(baseUrl + "/api/control-plane/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: "https://attacker.invalid" },
      body: JSON.stringify({ instruction: "This must be blocked", path: "README.md" }),
    });
    assert.equal(csrfBlocked.status, 403, "cross-origin cookie-authenticated mutations must be rejected");

    const missingOriginBlocked = await fetch(baseUrl + "/api/control-plane/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ instruction: "This must also be blocked", path: "README.md" }),
    });
    assert.equal(missingOriginBlocked.status, 403, "cookie-authenticated mutations without an origin must be rejected");

    const logoutCsrfBlocked = await fetch(baseUrl + "/api/auth/logout", {
      method: "POST",
      headers: { cookie, origin: "https://attacker.invalid" },
    });
    assert.equal(logoutCsrfBlocked.status, 403, "cross-origin logout requests must be rejected");

    const created = await fetch(baseUrl + "/api/control-plane/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: baseUrl },
      body: JSON.stringify({ instruction: "Read the project README for verification", path: "README.md" }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as any;
    assert.equal(createdBody.task.status, "queued");
    const taskId = createdBody.task.id;

    const listed = await fetch(baseUrl + "/api/control-plane/tasks", { headers: { cookie } });
    assert.equal(listed.status, 200);
    const listBody = await listed.json() as any;
    assert.ok(listBody.tasks.some((item: any) => item.task.id === taskId));

    const executed = await fetch(baseUrl + `/api/control-plane/tasks/${encodeURIComponent(taskId)}/execute`, {
      method: "POST", headers: { cookie, origin: baseUrl },
    });
    assert.equal(executed.status, 200);
    const executedBody = await executed.json() as any;
    assert.equal(executedBody.task.status, "completed");
    assert.match(executedBody.task.verificationEvidence[0].reference, /^sha256:[a-f0-9]{64}$/);
    assert.equal(executedBody.result.path, "README.md");

    const repeated = await fetch(baseUrl + `/api/control-plane/tasks/${encodeURIComponent(taskId)}/execute`, {
      method: "POST", headers: { cookie, origin: baseUrl },
    });
    assert.equal(repeated.status, 409, "Completed tasks must not execute a second time");
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
