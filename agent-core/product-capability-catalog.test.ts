import test from "node:test";
import assert from "node:assert/strict";
import { MAYA_PRODUCT_CAPABILITIES, getCapabilitiesByCategory } from "./product-capability-catalog.ts";
test("capability catalog includes the Founder-requested work domains", () => {
 const categories = new Set(MAYA_PRODUCT_CAPABILITIES.map(item => item.category));
 for (const category of ["Research and intelligence","Software engineering","Business and venture operations","Real estate and property","Hospitality and travel","Content and media","Personal productivity","Finance and administration","PC and device operations","AI workforce and agent factory"]) assert.ok(categories.has(category));
});
test("planned integrations are not mislabeled as implemented", () => {
 const property = getCapabilitiesByCategory("Real estate and property")[0];
 assert.equal(property.availability, "planned");
 assert.ok(property.dependencies.length > 0);
});
