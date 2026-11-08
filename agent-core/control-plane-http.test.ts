import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

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

function waitForWsMessage(socket: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off("message", handler); reject(new Error(`Timed out waiting for WebSocket message: ${type}`)); }, 5_000);
    const handler = (raw: any) => {
      let message: any;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === "error") { clearTimeout(timeout); socket.off("message", handler); reject(new Error(message.error || "Device bridge error")); return; }
      if (message.type === type) { clearTimeout(timeout); socket.off("message", handler); resolve(message); }
    };
    socket.on("message", handler);
  });
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
    const unauthenticatedAudit = await fetch(baseUrl + "/api/audit-events");
    assert.equal(unauthenticatedAudit.status, 401, "Audit history must require Founder authentication");
    const unauthenticatedMemory = await fetch(baseUrl + "/api/action-engine/memory", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "Unauthenticated memory must not persist." }),
    });
    assert.equal(unauthenticatedMemory.status, 401, "Memory writes must require Founder authentication");

    const login = await fetch(baseUrl + "/api/auth/founder-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "founder-test@example.invalid", password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "Founder login should set an HttpOnly session cookie");

    const devicesBeforeAuth = await fetch(baseUrl + "/api/devices");
    assert.equal(devicesBeforeAuth.status, 401, "Device inventory must require Founder authentication");
    const pairingBeforeAuth = await fetch(baseUrl + "/api/devices/pairing", { method: "POST" });
    assert.equal(pairingBeforeAuth.status, 401, "Device pairing must require Founder authentication");
    const pairing = await fetch(baseUrl + "/api/devices/pairing", { method: "POST", headers: { cookie } });
    assert.equal(pairing.status, 201);
    const pairingBody = await pairing.json() as any;
    assert.match(pairingBody.code, /^[A-Z0-9_-]{8,32}$/);
    assert.ok(Date.parse(pairingBody.expiresAt) > Date.now());

    const deviceSocket = new WebSocket(`ws://127.0.0.1:${port}/api/device-bridge`);
    await new Promise<void>((resolve, reject) => {
      deviceSocket.once("open", () => resolve());
      deviceSocket.once("error", reject);
    });
    const pairedMessagePromise = waitForWsMessage(deviceSocket, "paired");
    deviceSocket.send(JSON.stringify({
      type: "pair", code: pairingBody.code,
      device: { name: "HTTP Test PC", platform: "linux", architecture: "x64", runtimeVersion: "test" },
    }));
    const pairedMessage = await pairedMessagePromise;
    assert.ok(pairedMessage.token);
    const devices = await fetch(baseUrl + "/api/devices", { headers: { cookie } });
    assert.equal(devices.status, 200);
    const deviceList = await devices.json() as any;
    assert.equal(deviceList.devices[0].online, true);

    const commandMessagePromise = waitForWsMessage(deviceSocket, "command");
    const commandResponsePromise = fetch(baseUrl + `/api/devices/${pairedMessage.device.id}/commands`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ command: "system.info" }),
    });
    const commandMessage = await commandMessagePromise;
    deviceSocket.send(JSON.stringify({ type: "command_result", requestId: commandMessage.requestId, success: true, result: { platform: "linux", verified: true } }));
    const commandResponse = await commandResponsePromise;
    assert.equal(commandResponse.status, 200);
    assert.deepEqual((await commandResponse.json() as any).result, { platform: "linux", verified: true });

    const revokedDevice = await fetch(baseUrl + `/api/devices/${pairedMessage.device.id}`, { method: "DELETE", headers: { cookie } });
    assert.equal(revokedDevice.status, 200);
    deviceSocket.close();



    const savedMemory = await fetch(baseUrl + "/api/action-engine/memory", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ category: "lesson", title: "HTTP memory test", content: "Persistent Founder memory works." }),
    });
    assert.equal(savedMemory.status, 200);
    const savedMemoryBody = await savedMemory.json() as any;
    const stateResponse = await fetch(baseUrl + "/api/action-engine/state", { headers: { cookie } });
    assert.equal(stateResponse.status, 200);
    const stateBody = await stateResponse.json() as any;
    assert.ok(stateBody.memories.some((item: any) => item.id === savedMemoryBody.memory.id));
    const memoryFeedback = await fetch(baseUrl + `/api/action-engine/memory/${savedMemoryBody.memory.id}/feedback`, {
      method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ rating: "helpful" }),
    });
    assert.equal(memoryFeedback.status, 200);
    const memoryFeedbackBody = await memoryFeedback.json() as any;
    assert.equal(memoryFeedbackBody.feedbackScore, 1);
    assert.equal(memoryFeedbackBody.feedbackCount, 1);
    const deletedMemory = await fetch(baseUrl + `/api/action-engine/memory/${savedMemoryBody.memory.id}`, { method: "DELETE", headers: { cookie } });
    assert.equal(deletedMemory.status, 200);

    const conversationsBeforeAuth = await fetch(baseUrl + "/api/conversations");
    assert.equal(conversationsBeforeAuth.status, 401, "Conversation history must require Founder authentication");

    const planBeforeAuth = await fetch(baseUrl + "/api/agent/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objective: "Inspect the repository" }) });
    assert.equal(planBeforeAuth.status, 401, "Goal planning must require Founder authentication");
    const planWorkerBeforeAuth = await fetch(baseUrl + "/api/agent/plans/not-a-real-plan/start", { method: "POST" });
    assert.equal(planWorkerBeforeAuth.status, 401, "Background plan start must require Founder authentication");
    const specialistsBeforeAuth = await fetch(baseUrl + "/api/agent/specialists");
    assert.equal(specialistsBeforeAuth.status, 401, "Specialist registry must require Founder authentication");
    const ceoBeforeAuth = await fetch(baseUrl + "/api/agent/ceo/orchestrate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objective: "Review the project" }) });
    assert.equal(ceoBeforeAuth.status, 401, "CEO orchestration must require Founder authentication");
    const ceoRunsBeforeAuth = await fetch(baseUrl + "/api/agent/ceo/runs");
    assert.equal(ceoRunsBeforeAuth.status, 401, "CEO run history must require Founder authentication");
    const specialistRunBeforeAuth = await fetch(baseUrl + "/api/agent/specialists/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: "research", task: "Review this project" }) });
    assert.equal(specialistRunBeforeAuth.status, 401, "Specialist execution must require Founder authentication");

    const unavailablePlan = await fetch(baseUrl + "/api/agent/plan", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ objective: "Inspect the repository" }) });
    assert.equal(unavailablePlan.status, 503, "Planner must report missing Gemini configuration instead of fabricating a plan");

    const ceoUnavailable = await fetch(baseUrl + "/api/agent/ceo/orchestrate", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ objective: "Review the project" }) });
    assert.equal(ceoUnavailable.status, 503, "CEO orchestration must report missing Gemini configuration");
    const ceoRuns = await fetch(baseUrl + "/api/agent/ceo/runs", { headers: { cookie } });
    assert.equal(ceoRuns.status, 200);
    assert.deepEqual((await ceoRuns.json() as any).runs, []);
    const missingCeoRun = await fetch(baseUrl + "/api/agent/ceo/runs/not-a-real-run", { headers: { cookie } });
    assert.equal(missingCeoRun.status, 404);

    const specialists = await fetch(baseUrl + "/api/agent/specialists", { headers: { cookie } });
    assert.equal(specialists.status, 200);
    const specialistsBody = await specialists.json() as any;
    assert.ok(specialistsBody.specialists.some((agent: any) => agent.id === "research"));
    const unavailableSpecialist = await fetch(baseUrl + "/api/agent/specialists/run", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ agentId: "research", task: "Review this project" }) });
    assert.equal(unavailableSpecialist.status, 503, "Specialist execution must report missing Gemini configuration");

    const disabledPlanWorker = await fetch(baseUrl + "/api/agent/plans/not-a-real-plan/start", { method: "POST", headers: { cookie } });
    assert.equal(disabledPlanWorker.status, 503, "Background plan start must report the disabled worker explicitly");

    const emptyPlans = await fetch(baseUrl + "/api/agent/plans", { headers: { cookie } });
    assert.equal(emptyPlans.status, 200);
    const emptyPlansBody = await emptyPlans.json() as any;
    assert.deepEqual(emptyPlansBody.plans, []);
    const unknownPlanExecution = await fetch(baseUrl + "/api/agent/plans/not-a-real-plan/execute", { method: "POST", headers: { cookie } });
    assert.equal(unknownPlanExecution.status, 404);

    const conversationId = "http-conversation-test";
    const chat = await fetch(baseUrl + "/api/chat-stream", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ conversationId, message: "Remember this conversation test." }),
    });
    assert.equal(chat.status, 200);
    const chatText = await chat.text();
    assert.match(chatText, /limited offline mode/i);

    const conversations = await fetch(baseUrl + "/api/conversations", { headers: { cookie } });
    assert.equal(conversations.status, 200);
    const conversationsBody = await conversations.json() as any;
    assert.ok(conversationsBody.conversations.some((item: any) => item.id === conversationId));

    const conversation = await fetch(baseUrl + `/api/conversations/${conversationId}`, { headers: { cookie } });
    assert.equal(conversation.status, 200);
    const conversationBody = await conversation.json() as any;
    assert.equal(conversationBody.conversation.messages.length, 2, "User and assistant turns should be persisted");
    assert.equal(conversationBody.conversation.messages[0].role, "user");
    assert.equal(conversationBody.conversation.messages[1].role, "model");

    const deletedConversation = await fetch(baseUrl + `/api/conversations/${conversationId}`, { method: "DELETE", headers: { cookie } });
    assert.equal(deletedConversation.status, 200);
    const missingConversation = await fetch(baseUrl + `/api/conversations/${conversationId}`, { headers: { cookie } });
    assert.equal(missingConversation.status, 404);

    const created = await fetch(baseUrl + "/api/control-plane/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
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
      method: "POST", headers: { cookie },
    });
    assert.equal(executed.status, 200);
    const executedBody = await executed.json() as any;
    assert.equal(executedBody.task.status, "completed");
    assert.match(executedBody.task.verificationEvidence[0].reference, /^sha256:[a-f0-9]{64}$/);
    assert.equal(executedBody.result.path, "README.md");

    const auditHistory = await fetch(baseUrl + "/api/audit-events", { headers: { cookie } });
    assert.equal(auditHistory.status, 200);
    const auditBody = await auditHistory.json() as any;
    const taskEvents = auditBody.events.filter((event: any) => event.taskId === taskId);
    assert.deepEqual(taskEvents.map((event: any) => event.type).sort(), ["task.enqueued", "task.execution_started", "task.execution_verified"].sort());
    assert.ok(taskEvents.every((event: any) => event.founderId === "founder-primary"));
    assert.ok(taskEvents.every((event: any) => /^[a-f0-9]{64}$/.test(event.actionDigest)));

    const repeated = await fetch(baseUrl + `/api/control-plane/tasks/${encodeURIComponent(taskId)}/execute`, {
      method: "POST", headers: { cookie },
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
