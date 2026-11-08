import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry, CapabilityDeniedError } from "./capability-registry.ts";
const definition = { name: "workspace.read", description: "Read approved workspace files", risk: "low" as const, allowedRoles: ["developer"] as const, requiredScopes: ["workspace:read"], arguments: { path: { type: "string" as const, required: true, maxLength: 200 } }, timeoutMs: 5000, requiresApproval: false, verification: "Confirm returned file path and byte count." };
const actor = { id: "dev-1", founderId: "f-1", role: "developer" as const, scopes: ["workspace:read"] };
test("registers and validates a scoped capability", () => {
 const registry = new CapabilityRegistry(); registry.register(definition);
 const result = registry.validate("workspace.read", actor, { path: "src/index.ts" });
 assert.equal(result.args.path, "src/index.ts");
});
test("rejects missing scopes, wrong roles, unknown args and invalid types", () => {
 const registry = new CapabilityRegistry(); registry.register(definition);
 assert.throws(() => registry.validate("workspace.read", { ...actor, scopes: [] }, { path: "a" }), CapabilityDeniedError);
 assert.throws(() => registry.validate("workspace.read", { ...actor, role: "ceo" }, { path: "a" }), CapabilityDeniedError);
 assert.throws(() => registry.validate("workspace.read", actor, { path: "a", shell: "rm -rf /" }), CapabilityDeniedError);
 assert.throws(() => registry.validate("workspace.read", actor, { path: 12 }), CapabilityDeniedError);
});
test("refuses high-risk capabilities without approval", () => {
 const registry = new CapabilityRegistry();
 assert.throws(() => registry.register({ ...definition, name: "payments.send", risk: "critical", requiresApproval: false }));
});
