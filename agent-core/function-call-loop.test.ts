import test from "node:test";
import assert from "node:assert/strict";
import { runFunctionCallingTurn } from "./function-call-loop.ts";

test("returns normal Gemini text without executing tools", async () => {
  let executions = 0;
  const chat = { sendMessage: async () => ({ text: "hello", functionCalls: [] }) };
  const result = await runFunctionCallingTurn(chat, "hi", async () => { executions += 1; });
  assert.equal(result.text, "hello");
  assert.equal(executions, 0);
});

test("executes function calls and returns results to Gemini", async () => {
  const sent: unknown[] = [];
  let turn = 0;
  const chat = { sendMessage: async (input: { message: unknown }) => {
    sent.push(input.message);
    turn += 1;
    return turn === 1
      ? { functionCalls: [{ id: "call-1", name: "list_tasks", args: {} }] }
      : { text: "There are no tasks.", functionCalls: [] };
  }};
  const result = await runFunctionCallingTurn(chat, "List my tasks", async (name) => ({ name, count: 0 }));
  assert.equal(result.text, "There are no tasks.");
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], [{ role: "user", parts: [{ functionResponse: { name: "list_tasks", response: { output: { name: "list_tasks", count: 0 } }, id: "call-1" } }] }]);
});

test("converts tool exceptions into error responses instead of crashing the turn", async () => {
  let turn = 0;
  const chat = { sendMessage: async () => (++turn === 1
    ? { functionCalls: [{ name: "unknown_tool", args: {} }] }
    : { text: "That tool is unavailable.", functionCalls: [] }) };
  const result = await runFunctionCallingTurn(chat, "Do it", async () => { throw new Error("unsupported"); });
  assert.equal(result.text, "That tool is unavailable.");
});

test("bounds tool-call rounds and total calls", async () => {
  let calls = 0;
  let turn = 0;
  const chat = { sendMessage: async () => (++turn <= 5
    ? { functionCalls: Array.from({ length: 4 }, (_, i) => ({ name: "x", args: { i } })) }
    : { text: "done" }) };
  const result = await runFunctionCallingTurn(chat, "loop", async () => { calls += 1; return "ok"; }, { maxRounds: 5, maxCalls: 3 });
  assert.equal(calls, 3);
  assert.equal(result.functionCalls.length, 4);
});
