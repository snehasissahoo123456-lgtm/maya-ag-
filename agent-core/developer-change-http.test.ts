import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { AddressInfo } from "node:net";
import { DeveloperChangeStore } from "./developer-change-store.ts";
import { createDeveloperChangeRouter } from "./developer-change-http.ts";

async function start(repository: DeveloperChangeStore) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use((req, _res, next) => {
    if (req.headers.authorization === "Bearer founder-token") {
      (req as any).authSession = { user: { id: "founder-primary", role: "Founder" } };
    } else if (req.headers.authorization === "Bearer other-founder-token") {
      (req as any).authSession = { user: { id: "other-founder", role: "Founder" } };
    } else if (req.headers.authorization === "Bearer reviewer-token") {
      (req as any).authSession = { user: { id: "reviewer-primary", role: "CTO" } };
    }
    next();
  });
  app.use("/api/developer/changes", createDeveloperChangeRouter(repository));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${address.port}/api/developer/changes`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test("Founder creates and submits a Developer change; independent reviewer reviews; Founder alone approves", async () => {
  const store = new DeveloperChangeStore();
  const http = await start(store);
  const founderHeaders = { authorization: "Bearer founder-token", "content-type": "application/json" };
  const reviewerHeaders = { authorization: "Bearer reviewer-token", "content-type": "application/json" };
  const patch = "*** Begin Patch\n*** Update File: src/example.ts\n+export const value = 1;\n*** End Patch";
  const diffSha256 = createHash("sha256").update(patch).digest("hex");
  try {
    assert.equal((await fetch(http.base)).status, 401);
    const rejectedExtra = await fetch(http.base, { method: "POST", headers: founderHeaders, body: JSON.stringify({
      title: "Test", objective: "Test", workspaceId: "workspace-01", files: ["src/example.ts"], patch, diffSha256, founderId: "other-founder",
    }) });
    assert.equal(rejectedExtra.status, 400);

    const createdResponse = await fetch(http.base, { method: "POST", headers: founderHeaders, body: JSON.stringify({
      title: "Add example value", objective: "Create a bounded example change.", workspaceId: "workspace-01",
      files: ["src/example.ts"], patch, diffSha256,
    }) });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json() as any).change;
    assert.equal(created.founderId, "founder-primary");
    assert.equal(created.status, "draft");

    const list = await fetch(http.base, { headers: founderHeaders });
    const listBody = await list.json() as any;
    assert.equal(listBody.changes.length, 1);
    assert.equal("patch" in listBody.changes[0], false);

    const hidden = await fetch(http.base + "/" + created.id, { headers: { authorization: "Bearer other-founder-token" } });
    assert.equal(hidden.status, 404);
    const details = await fetch(http.base + "/" + created.id, { headers: founderHeaders });
    assert.equal((await details.json() as any).change.patch, patch);

    const submitted = await fetch(http.base + "/" + created.id + "/submit", { method: "POST", headers: founderHeaders });
    assert.equal(submitted.status, 200);
    assert.equal((await submitted.json() as any).change.status, "submitted");

    const founderReview = await fetch(http.base + "/" + created.id + "/review", {
      method: "POST", headers: founderHeaders, body: JSON.stringify({ decision: "approved", notes: "self-review" }),
    });
    assert.equal(founderReview.status, 403, "Founder cannot independently review their own change.");

    const reviewerList = await fetch(http.base, { headers: reviewerHeaders });
    assert.equal(reviewerList.status, 401, "Reviewer cannot list Founder-owned proposals.");

    const reviewerReview = await fetch(http.base + "/" + created.id + "/review", {
      method: "POST", headers: reviewerHeaders, body: JSON.stringify({ decision: "approved", notes: "Reviewed independently." }),
    });
    assert.equal(reviewerReview.status, 200);
    assert.equal((await reviewerReview.json() as any).change.status, "reviewed");

    const reviewerApprove = await fetch(http.base + "/" + created.id + "/approve", { method: "POST", headers: reviewerHeaders });
    assert.equal(reviewerApprove.status, 403, "Reviewer cannot supply the owning Founder's approval.");

    const founderApprove = await fetch(http.base + "/" + created.id + "/approve", { method: "POST", headers: founderHeaders });
    assert.equal(founderApprove.status, 200);
    assert.equal((await founderApprove.json() as any).change.status, "approved");

    const forgedReviewer = await fetch(http.base + "/" + created.id + "/review", {
      method: "POST", headers: reviewerHeaders, body: JSON.stringify({ reviewerId: "founder-primary", decision: "approved", notes: "forged" }),
    });
    assert.equal(forgedReviewer.status, 400, "Reviewer identity cannot be supplied by request body.");
  } finally {
    await http.close();
  }
});
