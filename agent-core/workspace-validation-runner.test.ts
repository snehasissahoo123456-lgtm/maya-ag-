import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runWorkspaceValidation } from "./workspace-validation-runner.ts";

function fakeSpawn(results: number[], calls: Array<{ command: string; args: string[]; options: any }>) {
  return (command: string, args: string[], options: any) => {
    calls.push({ command, args, options });
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("validation output\n"));
      child.emit("close", results[calls.length - 1] ?? 0, null);
    });
    return child;
  };
}

test("validation runner executes only the fixed lint, test and build scripts without a shell", async () => {
  const calls: Array<{ command: string; args: string[]; options: any }> = [];
  const result = await runWorkspaceValidation("/repo", new AbortController().signal, fakeSpawn([0, 0, 0], calls) as any);
  assert.deepEqual(calls.map(call => [call.command, call.args]), [
    ["bun", ["run", "lint"]],
    ["bun", ["run", "test"]],
    ["bun", ["run", "build"]],
  ]);
  assert.ok(calls.every(call => call.options.shell === false));
  assert.equal(calls[0].options.env.CI, "true");
  assert.equal(calls[0].options.env.NODE_ENV, "test");
  assert.equal(Object.hasOwn(calls[0].options.env, "GEMINI_API_KEY"), false);
  assert.equal(Object.hasOwn(calls[0].options.env, "SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(result.passed, true);
  assert.equal(result.commands.length, 3);
  assert.equal(result.sha256.length, 64);
});

test("validation runner stops at the first failed command and never executes later scripts", async () => {
  const calls: Array<{ command: string; args: string[]; options: any }> = [];
  await assert.rejects(
    () => runWorkspaceValidation("/repo", new AbortController().signal, fakeSpawn([0, 1, 0], calls) as any),
    /failed at 'bun run test'/,
  );
  assert.equal(calls.length, 2);
});

test("validation runner refuses to start when its task was cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls: Array<{ command: string; args: string[]; options: any }> = [];
  await assert.rejects(() => runWorkspaceValidation("/repo", controller.signal, fakeSpawn([0, 0, 0], calls) as any), /cancelled/);
  assert.equal(calls.length, 0);
});
