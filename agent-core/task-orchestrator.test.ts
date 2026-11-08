import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalLedger } from "./approval-ledger.ts";
import { CapabilityRegistry } from "./capability-registry.ts";
import { TaskOrchestrator, type TaskEnvelope, type TaskRepository } from "./task-orchestrator.ts";
class MemoryRepo implements TaskRepository {
 private rows = new Map<string, TaskEnvelope>();
 async get(id: string) { return this.rows.get(id); }
 async put(value: TaskEnvelope) { this.rows.set(value.task.id, structuredClone(value)); }
 async list(founderId: string) { return [...this.rows.values()].filter(value => value.task.founderId === founderId).map(value => structuredClone(value)); }
}
const founder = { id: "founder-session", founderId: "f1", role: "founder" as const, scopes: ["*"] };
const developer = { id: "developer-1", founderId: "f1", role: "developer" as const, scopes: ["workspace:write"] };
function setup(risk: "low" | "high" = "low") {
 const registry = new CapabilityRegistry();
 registry.register({ name: "workspace.write", description: "Write a generated artifact", risk, allowedRoles: ["developer"], requiredScopes: ["workspace:write"], arguments: { file: { type: "string", required: true, maxLength: 100 } }, timeoutMs: 5000, requiresApproval: risk === "high", verification: "Read back artifact and compare checksum." });
 const ledger = new ApprovalLedger();
 let runs = 0;
 const orchestrator = new TaskOrchestrator(new MemoryRepo(), registry, ledger, { run: async ({ capability, args }) => {
  runs++;
  return { result: { capability, args }, evidence: { kind: "checksum", description: "Artifact read back and checksum matched.", observedAt: new Date().toISOString() } };
 } });
 return { orchestrator, ledger, getRuns: () => runs };
}
test("low-risk task executes and only completes with verification evidence", async () => {
 const { orchestrator, getRuns } = setup();
 await orchestrator.enqueue({ id: "t-low", founderId: "f1", instruction: "Write a report", capability: "workspace.write", args: { file: "report.md" }, actor: developer });
 const result = await orchestrator.execute("t-low", developer);
 assert.equal(result.task.status, "completed");
 assert.equal(result.task.verificationEvidence.length, 1);
 assert.equal(getRuns(), 1);
});
test("high-risk task cannot execute until exact Founder approval is granted", async () => {
 const { orchestrator, getRuns } = setup("high");
 await orchestrator.enqueue({ id: "t-high", founderId: "f1", instruction: "Publish release", capability: "workspace.write", args: { file: "release.zip" }, actor: developer });
 await assert.rejects(() => orchestrator.execute("t-high", developer), /approval/i);
 const pending = await orchestrator.requestApproval("t-high", founder);
 await orchestrator.decideApproval({ approvalId: pending.approvalId, approved: true, actor: founder });
 const result = await orchestrator.execute("t-high", developer, pending.approvalId);
 assert.equal(result.task.status, "completed");
 assert.equal(getRuns(), 1);
});

test("rejects concurrent duplicate execution for the same task", async () => {
 const registry = new CapabilityRegistry();
 registry.register({ name: "workspace.write", description: "Write a generated artifact", risk: "low", allowedRoles: ["developer"], requiredScopes: ["workspace:write"], arguments: { file: { type: "string", required: true, maxLength: 100 } }, timeoutMs: 5000, requiresApproval: false, verification: "Read back artifact and compare checksum." });
 const repository = new MemoryRepo();
 let runs = 0;
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 const orchestrator = new TaskOrchestrator(repository, registry, new ApprovalLedger(), { run: async () => {
   runs++;
   await gate;
   return { result: "ok", evidence: { kind: "test", description: "Verified", observedAt: new Date().toISOString() } };
 } });
 await orchestrator.enqueue({ id: "t-race", founderId: "f1", instruction: "Write a report", capability: "workspace.write", args: { file: "report.md" }, actor: developer });
 const first = orchestrator.execute("t-race", developer);
 await assert.rejects(() => orchestrator.execute("t-race", developer), /already in progress/i);
 release();
 const completed = await first;
 assert.equal(completed.task.status, "completed");
 assert.equal(runs, 1);
});

test("records Founder-scoped task lifecycle audit events", async () => {
 const registry = new CapabilityRegistry();
 registry.register({ name: "workspace.write", description: "Write a generated artifact", risk: "low", allowedRoles: ["developer"], requiredScopes: ["workspace:write"], arguments: { file: { type: "string", required: true, maxLength: 100 } }, timeoutMs: 5000, requiresApproval: false, verification: "Read back artifact and compare checksum." });
 const repository = new MemoryRepo();
 const events: any[] = [];
 const audit = { append: async (event: any) => { events.push(event); }, list: async () => events };
 const orchestrator = new TaskOrchestrator(repository, registry, new ApprovalLedger(), { run: async () => ({ result: "ok", evidence: { kind: "test", description: "Verified", reference: "sha256:" + "a".repeat(64), observedAt: new Date().toISOString() } }) }, audit);
 await orchestrator.enqueue({ id: "t-audit", founderId: "f1", instruction: "Write a report", capability: "workspace.write", args: { file: "report.md" }, actor: developer });
 await orchestrator.execute("t-audit", developer);
 assert.deepEqual(events.map(event => event.type), ["task.enqueued", "task.execution_started", "task.execution_verified"]);
 assert.ok(events.every(event => event.founderId === "f1" && event.actorId === developer.id));
 assert.ok(events.every(event => /^[a-f0-9]{64}$/.test(event.actionDigest)));
});

test("audit failure after a capability runs parks task in requires_recovery", async () => {
 const registry = new CapabilityRegistry();
 registry.register({ name: "workspace.write", description: "Write a generated artifact", risk: "low", allowedRoles: ["developer"], requiredScopes: ["workspace:write"], arguments: { file: { type: "string", required: true, maxLength: 100 } }, timeoutMs: 5000, requiresApproval: false, verification: "Read back artifact and compare checksum." });
 const repository = new MemoryRepo();
 const audit = { append: async (event: any) => { if (event.type === "task.execution_verified") throw new Error("audit database unavailable"); }, list: async () => [] };
 const orchestrator = new TaskOrchestrator(repository, registry, new ApprovalLedger(), { run: async () => ({ result: "possibly-applied", evidence: { kind: "test", description: "Verified", observedAt: new Date().toISOString() } }) }, audit);
 await orchestrator.enqueue({ id: "t-audit-failure", founderId: "f1", instruction: "Write a report", capability: "workspace.write", args: { file: "report.md" }, actor: developer });
 await assert.rejects(() => orchestrator.execute("t-audit-failure", developer), /audit database unavailable/);
 assert.equal((await repository.get("t-audit-failure"))?.task.status, "requires_recovery");
});
