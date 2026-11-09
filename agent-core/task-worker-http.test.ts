import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { executeLocalBridgeCommand } from "../local-bridge.ts";

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


async function waitForWsMessage(socket: WebSocket, type: string, timeoutMs = 10_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", handler); reject(new Error(`Timed out waiting for bridge message: ${type}`)); }, timeoutMs);
    const handler = (raw: any) => {
      let message: any;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === type) { clearTimeout(timer); socket.off("message", handler); resolve(message); }
    };
    socket.on("message", handler);
  });
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


test("real HTTP worker replaces an existing workspace file only after exact Founder approval", async () => {
  const port = await unusedPort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-approved-write-http-data-"));
  const workspaceDir = fs.mkdtempSync(path.join(process.cwd(), ".maya-approved-write-test-"));
  const targetPath = path.join(workspaceDir, "report.md");
  fs.writeFileSync(targetPath, "Original file contents", "utf8");
  const relativePath = path.relative(process.cwd(), targetPath);
  const password = "test-founder-password-2026-approved-write";
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      MAYA_DATA_DIR: dataDir,
      MAYA_FOUNDER_EMAIL: "write-founder@example.invalid",
      MAYA_FOUNDER_PASSWORD: password,
      MAYA_TASK_WORKER_ENABLED: "true",
      MAYA_TASK_WORKER_POLL_MS: "1000",
      MAYA_SCHEDULE_WORKER_ENABLED: "false",
      MAYA_PLAN_WORKER_ENABLED: "false",
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
    const login = await fetch(baseUrl + "/api/auth/founder-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "write-founder@example.invalid", password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const replacement = "Founder-approved replacement contents";
    const created = await fetch(baseUrl + "/api/control-plane/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instruction: "Replace the report after explicit approval",
        capability: "workspace.write_file",
        path: relativePath,
        content: replacement,
      }),
    });
    assert.equal(created.status, 201);
    const createdData = await created.json() as any;
    const taskId = createdData.task.id;
    assert.equal(createdData.task.requiresApproval, true);
    assert.equal(fs.readFileSync(targetPath, "utf8"), "Original file contents");

    const approvalRequest = await fetch(baseUrl + `/api/control-plane/tasks/${encodeURIComponent(taskId)}/request-approval`, {
      method: "POST", headers: { cookie },
    });
    assert.equal(approvalRequest.status, 200);
    const approvalData = await approvalRequest.json() as any;

    const pendingTasks = await fetch(baseUrl + "/api/control-plane/tasks", { headers: { cookie } });
    const pendingData = await pendingTasks.json() as any;
    assert.equal(pendingData.tasks.find((item: any) => item.task.id === taskId)?.task.status, "awaiting_approval");
    assert.equal(fs.readFileSync(targetPath, "utf8"), "Original file contents");

    const decision = await fetch(baseUrl + `/api/control-plane/approvals/${encodeURIComponent(approvalData.approvalId)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ approved: true }),
    });
    assert.equal(decision.status, 200);

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
    assert.equal(finished?.task.status, "completed", `Approved write did not complete. Server output:\n${logs}`);
    assert.equal(fs.readFileSync(targetPath, "utf8"), replacement);
    assert.match(finished.task.verificationEvidence[0].reference, /^sha256:[a-f0-9]{64}$/);
    const approvals = await (await fetch(baseUrl + "/api/control-plane/approvals", { headers: { cookie } })).json() as any;
    assert.equal(approvals.approvals.find((item: any) => item.id === approvalData.approvalId)?.status, "consumed");


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
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});


test("real HTTP worker writes to an enrolled local PC only after exact Founder approval", async () => {
  const port = await unusedPort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maya-device-write-http-data-"));
  const deviceWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "maya-device-write-workspace-"));
  const targetPath = path.join(deviceWorkspace, "notes.md");
  fs.writeFileSync(targetPath, "Original local PC contents", "utf8");
  const password = "test-founder-password-2026-device-write";
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      MAYA_DATA_DIR: dataDir,
      MAYA_FOUNDER_EMAIL: "device-write-founder@example.invalid",
      MAYA_FOUNDER_PASSWORD: password,
      MAYA_TASK_WORKER_ENABLED: "true",
      MAYA_TASK_WORKER_POLL_MS: "1000",
      MAYA_SCHEDULE_WORKER_ENABLED: "false",
      MAYA_PLAN_WORKER_ENABLED: "false",
      GEMINI_API_KEY: "",
      API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", chunk => { logs += chunk.toString(); });
  child.stderr?.on("data", chunk => { logs += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  let socket: WebSocket | undefined;

  try {
    await waitForServer(baseUrl, child);
    const login = await fetch(baseUrl + "/api/auth/founder-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "device-write-founder@example.invalid", password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const pairing = await fetch(baseUrl + "/api/devices/pairing", { method: "POST", headers: { cookie } });
    assert.equal(pairing.status, 201);
    const pairingData = await pairing.json() as any;
    socket = new WebSocket(`ws://127.0.0.1:${port}/api/device-bridge`);
    await new Promise<void>((resolve, reject) => {
      socket!.once("open", resolve);
      socket!.once("error", reject);
    });
    const pairedPromise = waitForWsMessage(socket, "paired");
    socket.send(JSON.stringify({
      type: "pair",
      code: pairingData.code,
      device: { name: "HTTP Local PC", platform: "test", architecture: "x64", runtimeVersion: "test" },
    }));
    const paired = await pairedPromise;
    assert.ok(paired.device.id);

    socket.on("message", async raw => {
      let message: any;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type !== "command" || !["workspace.write_file", "workspace.create_file", "workspace.create_directory"].includes(message.command)) return;
      try {
        const result = await executeLocalBridgeCommand(deviceWorkspace, message.command, message.args || {});
        socket?.send(JSON.stringify({ type: "command_result", requestId: message.requestId, success: true, result }));
      } catch (error) {
        socket?.send(JSON.stringify({ type: "command_result", requestId: message.requestId, success: false, error: error instanceof Error ? error.message : String(error) }));
      }
    });

    const replacement = "Founder-approved local device replacement";
    const created = await fetch(baseUrl + "/api/control-plane/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instruction: "Replace the notes file on my paired PC",
        capability: "device.workspace.write_file",
        deviceId: paired.device.id,
        path: "notes.md",
        content: replacement,
      }),
    });
    assert.equal(created.status, 201, `Device write task creation failed. Server output:\n${logs}`);
    const taskId = (await created.json() as any).task.id;
    assert.equal(fs.readFileSync(targetPath, "utf8"), "Original local PC contents");

    const approvalRequest = await fetch(baseUrl + `/api/control-plane/tasks/${encodeURIComponent(taskId)}/request-approval`, {
      method: "POST", headers: { cookie },
    });
    assert.equal(approvalRequest.status, 200);
    const approvalData = await approvalRequest.json() as any;
    const decision = await fetch(baseUrl + `/api/control-plane/approvals/${encodeURIComponent(approvalData.approvalId)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ approved: true }),
    });
    assert.equal(decision.status, 200);

    const deadline = Date.now() + 12_000;
    let finished: any = null;
    while (Date.now() < deadline) {
      const response = await fetch(baseUrl + "/api/control-plane/tasks", { headers: { cookie } });
      const data = await response.json() as any;
      finished = data.tasks.find((item: any) => item.task.id === taskId);
      if (finished?.task.status === "completed" || finished?.task.status === "failed") break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(finished?.task.status, "completed", `Approved device write did not complete. Server output:\n${logs}`);
    assert.equal(fs.readFileSync(targetPath, "utf8"), replacement);
    assert.match(finished.task.verificationEvidence[0].reference, /^sha256:[a-f0-9]{64}$/);
    const approvals = await (await fetch(baseUrl + "/api/control-plane/approvals", { headers: { cookie } })).json() as any;
    assert.equal(approvals.approvals.find((item: any) => item.id === approvalData.approvalId)?.status, "consumed");

    fs.mkdirSync(path.join(deviceWorkspace, "projects"));
    const directoryTaskResponse = await fetch(baseUrl + "/api/control-plane/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instruction: "Create a new project directory on my paired PC",
        capability: "device.workspace.create_directory",
        deviceId: paired.device.id,
        path: "projects/new-project",
      }),
    });
    assert.equal(directoryTaskResponse.status, 201, `Directory task creation failed. Server output:\n${logs}`);
    const directoryTaskId = (await directoryTaskResponse.json() as any).task.id;
    assert.equal(fs.existsSync(path.join(deviceWorkspace, "projects", "new-project")), false);
    const directoryApprovalRequest = await fetch(baseUrl + `/api/control-plane/tasks/${encodeURIComponent(directoryTaskId)}/request-approval`, {
      method: "POST", headers: { cookie },
    });
    assert.equal(directoryApprovalRequest.status, 200);
    const directoryApproval = await directoryApprovalRequest.json() as any;
    const directoryDecision = await fetch(baseUrl + `/api/control-plane/approvals/${encodeURIComponent(directoryApproval.approvalId)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ approved: true }),
    });
    assert.equal(directoryDecision.status, 200);
    const directoryDeadline = Date.now() + 12_000;
    let directoryTask: any = null;
    while (Date.now() < directoryDeadline) {
      const response = await fetch(baseUrl + "/api/control-plane/tasks", { headers: { cookie } });
      const data = await response.json() as any;
      directoryTask = data.tasks.find((item: any) => item.task.id === directoryTaskId);
      if (directoryTask?.task.status === "completed" || directoryTask?.task.status === "failed") break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(directoryTask?.task.status, "completed", `Approved directory creation did not complete. Server output:\n${logs}`);
    assert.equal(fs.statSync(path.join(deviceWorkspace, "projects", "new-project")).isDirectory(), true);
    assert.equal(directoryTask.capability, "device.workspace.create_directory");
    assert.equal(directoryTask.task.verificationEvidence[0].kind, "device-workspace-directory-create");
    const directoryApprovals = await (await fetch(baseUrl + "/api/control-plane/approvals", { headers: { cookie } })).json() as any;
    assert.equal(directoryApprovals.approvals.find((item: any) => item.id === directoryApproval.approvalId)?.status, "consumed");

    const createContent = "Founder-approved new local PC file";
    const createTaskResponse = await fetch(baseUrl + "/api/control-plane/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instruction: "Create a new report on my paired PC",
        capability: "device.workspace.create_file",
        deviceId: paired.device.id,
        path: "created-report.md",
        content: createContent,
      }),
    });
    assert.equal(createTaskResponse.status, 201, `Device create task creation failed. Server output:\n${logs}`);
    const createTaskId = (await createTaskResponse.json() as any).task.id;
    assert.equal(fs.existsSync(path.join(deviceWorkspace, "created-report.md")), false);
    const createApprovalRequest = await fetch(baseUrl + `/api/control-plane/tasks/${encodeURIComponent(createTaskId)}/request-approval`, {
      method: "POST", headers: { cookie },
    });
    assert.equal(createApprovalRequest.status, 200);
    const createApproval = await createApprovalRequest.json() as any;
    const createDecision = await fetch(baseUrl + `/api/control-plane/approvals/${encodeURIComponent(createApproval.approvalId)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ approved: true }),
    });
    assert.equal(createDecision.status, 200);
    const createDeadline = Date.now() + 12_000;
    let createdTask: any = null;
    while (Date.now() < createDeadline) {
      const response = await fetch(baseUrl + "/api/control-plane/tasks", { headers: { cookie } });
      const data = await response.json() as any;
      createdTask = data.tasks.find((item: any) => item.task.id === createTaskId);
      if (createdTask?.task.status === "completed" || createdTask?.task.status === "failed") break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(createdTask?.task.status, "completed", `Approved device create did not complete. Server output:\n${logs}`);
    assert.equal(fs.readFileSync(path.join(deviceWorkspace, "created-report.md"), "utf8"), createContent);
    assert.match(createdTask.task.verificationEvidence[0].reference, /^sha256:[a-f0-9]{64}$/);
    const createApprovals = await (await fetch(baseUrl + "/api/control-plane/approvals", { headers: { cookie } })).json() as any;
    assert.equal(createApprovals.approvals.find((item: any) => item.id === createApproval.approvalId)?.status, "consumed");
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nServer output:\n${logs}`);
  } finally {
    socket?.close();
    child.kill("SIGTERM");
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(deviceWorkspace, { recursive: true, force: true });
  }
});
