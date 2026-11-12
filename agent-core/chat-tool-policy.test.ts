import test from "node:test";
import assert from "node:assert/strict";
import { createChatToolExecutor } from "./chat-tool-policy.ts";

test("allows read-only chat tools through the injected server executor", async () => {
  const calls: string[] = [];
  const execute = createChatToolExecutor(async (name) => { calls.push(name); return { ok: true }; });
  assert.deepEqual(await execute("read_file", { path: "README.md" }), { ok: true });
  assert.deepEqual(calls, ["read_file"]);
});

test("allows bounded CEO delegation through the read-only chat tool policy", async () => {
  const calls: string[] = [];
  const execute = createChatToolExecutor(async (name) => { calls.push(name); return { delegated: true }; });
  assert.deepEqual(await execute("delegate_to_ceo", { objective: "Research the launch strategy" }), { delegated: true });
  assert.deepEqual(calls, ["delegate_to_ceo"]);
});

test("allows validated goal-plan proposals without executing the proposed steps", async () => {
  const calls: string[] = [];
  const execute = createChatToolExecutor(async (name) => { calls.push(name); return { executionStatus: "not_executed" }; });
  assert.deepEqual(await execute("create_goal_plan", { objective: "Prepare a website launch plan" }), { executionStatus: "not_executed" });
  assert.deepEqual(calls, ["create_goal_plan"]);
});

test("blocks memory writes, queued tasks, and command execution without approval", async () => {
  const execute = createChatToolExecutor(async () => ({ executed: true }));
  for (const name of ["memory_save", "schedule_task", "run_tests"]) {
    await assert.rejects(execute(name, {}), /explicit Founder approval/);
  }
});
