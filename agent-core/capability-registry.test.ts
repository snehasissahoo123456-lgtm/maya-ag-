import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry, CapabilityDeniedError } from "./capability-registry.ts";
const registry = new CapabilityRegistry();
const read = { name: "workspace.read", description: "Read approved workspace files", risk: "low" as const, allowedRoles: ["developer"] as const, requiredScopes: ["workspace:read"], arguments: { path: { type: "string" as const, required: true, maxLength: 200 } }, timeoutMs: 5000, requiresApproval: false, verification: "Confirm returned file path and byte count." };
test("registers and validates a scoped capability", () => {
 registry.register(read);
 const result = registry.validate("workspace.read", { id: "dev-1", founderId: "f-1", role: "developer", scopes: ["workspace:read"] }, { path: "src/index.ts" });
 assert.equal(result.args.path, "src/index.ts");
});
test("rejects missing scopes, wrong roles, unknown args and invalid types", () => {
 registry.register(read);
 assert.throws(() => registry.validate("workspace.read", { id: "dev-1", founderId: "f-1", role: "developer", scopes: [] }, { path: "a" }), CapabilityDeniedError);
 assert.throws(() => registry.validate("workspace.read", { id: "ceo-1", founderId: "f-1", role: "ceo", scopes: ["workspace:read"] }, { path: "a" }), CapabilityDeniedError);
 assert.throws(() => registry.validate("workspace.read", { id: "dev-1", founderId: "f-1", role: "developer", scopes: ["workspace:read"] }, { path: "a", shell: "rm -rf /" }), CapabilityDeniedError);
 assert.throws(() => registry.validate("workspace.read", { id: "dev-1", founderId: "f-1", role: "developer", scopes: ["workspace:read"] }, { path: 12 }), CapabilityDeniedError);
});
test("refuses high-risk capabilities without approval", () => {
 assert.throws(() => registry.register({ ...read, name: "payments.send", risk: "critical", requiresApproval: false }));
});
