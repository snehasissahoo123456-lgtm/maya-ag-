import test from "node:test";
import assert from "node:assert/strict";
import { validateGoalPlan, GoalPlanValidationError, type PlannerToolContract } from "./goal-planner.ts";

const tools: PlannerToolContract[] = [
  { name: "read_file", description: "Read a workspace file", parametersJsonSchema: { type: "object", properties: { path: { type: "string", maxLength: 1024 } }, required: ["path"] } },
  { name: "memory_save", description: "Save a memory", parametersJsonSchema: { type: "object", properties: { content: { type: "string", maxLength: 20000 } }, required: ["content"] } },
];
const valid = { summary: "Inspect the requested file, then summarize the findings.", steps: [
  { id: "inspect", title: "Inspect README", tool: "read_file", args: { path: "README.md" }, dependsOn: [], expectedResult: "README contents are available." },
  { id: "save_note", title: "Save an approved note", tool: "memory_save", args: { content: "Founder-approved summary." }, dependsOn: ["inspect"], expectedResult: "A memory note is saved." },
] };

test("validates tool allowlists, arguments, and earlier-step dependencies", () => {
  const plan = validateGoalPlan(valid, "Review the project and remember the key architecture.", tools);
  assert.equal(plan.executionMode, "plan_only");
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[1].requiresFounderApproval, true);
  assert.deepEqual(plan.steps[1].dependsOn, ["inspect"]);
});

test("rejects unknown tools and unexpected arguments", () => {
  assert.throws(() => validateGoalPlan({ ...valid, steps: [{ ...valid.steps[0], tool: "shell_exec" }] }, "Do work", tools), GoalPlanValidationError);
  assert.throws(() => validateGoalPlan({ ...valid, steps: [{ ...valid.steps[0], args: { path: "README.md", command: "whoami" } }] }, "Do work", tools), /Unexpected argument/);
});

test("rejects forward dependencies, duplicate IDs, and oversized plans", () => {
  assert.throws(() => validateGoalPlan({ ...valid, steps: [{ ...valid.steps[0], dependsOn: ["later"] }] }, "Do work", tools), /earlier steps/);
  assert.throws(() => validateGoalPlan({ ...valid, steps: [valid.steps[0], { ...valid.steps[0] }] }, "Do work", tools), /unique/);
  assert.throws(() => validateGoalPlan({ ...valid, steps: Array.from({ length: 13 }, (_, i) => ({ ...valid.steps[0], id: `step_${i}` })) }, "Do work", tools), /between 1 and 12/);
});

test("rejects malformed objectives and missing required arguments", () => {
  assert.throws(() => validateGoalPlan(valid, "", tools), /Objective/);
  assert.throws(() => validateGoalPlan({ ...valid, steps: [{ ...valid.steps[0], args: {} }] }, "Do work", tools), /Missing required/);
});
