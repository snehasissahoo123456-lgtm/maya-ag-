import test from "node:test";
import assert from "node:assert/strict";
import { SpecialistRuntime } from "./specialist-runtime.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("enforces the manifest concurrency limit for each specialist identity", async () => {
  const gate = deferred();
  let started = 0;
  const runtime = new SpecialistRuntime({
    generate: async () => { started++; await gate.promise; return "bounded findings"; },
  });
  const first = runtime.run({ agentId: "finance", task: "Analyze the first budget." });
  const second = runtime.run({ agentId: "finance", task: "Analyze the second budget." });
  assert.equal(started, 2);
  assert.equal(runtime.getActiveRunCount("finance"), 2);
  await assert.rejects(
    runtime.run({ agentId: "finance", task: "Analyze the third budget." }),
    /concurrency limit reached/,
  );
  assert.equal(runtime.getActiveRunCount("finance"), 2);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(runtime.getActiveRunCount("finance"), 0);
});

test("releases a specialist concurrency slot after adapter failure", async () => {
  let attempts = 0;
  const runtime = new SpecialistRuntime({
    generate: async () => {
      attempts++;
      if (attempts === 1) throw new Error("provider unavailable");
      return "recovered";
    },
  });
  await assert.rejects(runtime.run({ agentId: "research", task: "Research the market." }), /provider unavailable/);
  assert.equal(runtime.getActiveRunCount("research"), 0);
  const result = await runtime.run({ agentId: "research", task: "Retry the market research." });
  assert.equal(result.output, "recovered");
  assert.equal(runtime.getActiveRunCount("research"), 0);
});
