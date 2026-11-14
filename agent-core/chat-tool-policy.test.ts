import test from "node:test";
import assert from "node:assert/strict";
import { createChatToolExecutor } from "./chat-tool-policy.ts";

test("allows read-only chat tools through the injected server executor", async () => {
  const calls: string[] = [];
  const execute = createChatToolExecutor(async (name) => { calls.push(name); return { ok: true }; });
  assert.deepEqual(await execute("read_file", { path: "README.md" }), { ok: true });
  assert.deepEqual(calls, ["read_file"]);
});

test("blocks memory writes, queued tasks, and command execution without approval", async () => {
  const execute = createChatToolExecutor(async () => ({ executed: true }));
  for (const name of ["memory_save", "schedule_task", "run_tests"]) {
    await assert.rejects(execute(name, {}), /explicit Founder approval/);
  }
});
