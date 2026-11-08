import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_MANIFESTS } from "./agent-manifests.ts";
import { DelegationPolicy } from "./delegation-policy.ts";
const get = (id: string) => AGENT_MANIFESTS.find(agent => agent.id === id)!;
test("CEO can delegate bounded work to a specialist with only inherited scopes", () => {
 const policy = new DelegationPolicy();
 const record = policy.delegate({ id: "d1", taskId: "t1", founderId: "f1", parent: get("ceo"), child: get("research"), parentScopes: ["tasks:read", "research:web", "memory:read"], requestedScopes: ["research:web"], depth: 1, budget: { maxTasks: 2, maxTokens: 10000, maxDurationMs: 60000 } });
 assert.deepEqual(record.grantedScopes, ["research:web"]);
 assert.equal(record.depth, 1);
});
test("specialists cannot create agents or exceed parent scopes and budgets", () => {
 const policy = new DelegationPolicy();
 assert.throws(() => policy.delegate({ id: "d2", taskId: "t1", founderId: "f1", parent: get("research"), child: get("developer"), parentScopes: ["research:web"], requestedScopes: ["workspace:write"], depth: 1, budget: { maxTasks: 1, maxTokens: 1000, maxDurationMs: 10000 } }));
 assert.throws(() => policy.delegate({ id: "d3", taskId: "t1", founderId: "f1", parent: get("ceo"), child: get("research"), parentScopes: ["research:web"], requestedScopes: ["research:web"], depth: 5, budget: { maxTasks: 1, maxTokens: 1000, maxDurationMs: 10000 } }));
});
