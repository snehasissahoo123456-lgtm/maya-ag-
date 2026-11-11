import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  approveDeveloperChange, createDeveloperChangeRequest, recordDeveloperReview, submitDeveloperChange,
} from "./developer-change-control.ts";
import { DeveloperChangeStore } from "./developer-change-store.ts";

const now = new Date("2026-11-11T12:00:00.000Z");
const patch = "diff --git a/agent-core/example.ts b/agent-core/example.ts\n+export const example = true;";
const digest = createHash("sha256").update(patch).digest("hex");
function make(id = "change-001") {
  return createDeveloperChangeRequest({id,founderId:"founder-1",title:"Persist change",objective:"Keep lifecycle state durable",
    workspaceId:"workspace-001",files:["agent-core/example.ts"],patch,diffSha256:digest,now});
}
function approved() {
  const submitted = submitDeveloperChange(make(),now);
  const reviewed = recordDeveloperReview(submitted,{reviewerId:"reviewer-1",decision:"approved",notes:"Reviewed",now});
  return approveDeveloperChange(reviewed,"founder-1",now);
}

test("creates, reads and lists changes with Founder isolation", async () => {
  const store = new DeveloperChangeStore();
  await store.create(make());
  assert.equal((await store.get({changeId:"change-001",founderId:"founder-1"}))?.status,"draft");
  assert.equal(await store.get({changeId:"change-001",founderId:"founder-2"}),null);
  assert.equal((await store.list({founderId:"founder-2"})).length,0);
  assert.equal((await store.list({founderId:"founder-1"})).length,1);
});

test("rejects duplicate IDs, invalid patch digests and invalid limits", async () => {
  const store = new DeveloperChangeStore();
  await store.create(make());
  await assert.rejects(store.create(make()),/already exists/);
  await assert.rejects(store.create({...make("change-002"),diffSha256:"a".repeat(64)}),/invalid identity|content/);
  await assert.rejects(store.list({founderId:"founder-1",limit:0}),/limit/);
});

test("updates lifecycle state without allowing Founder or creation-time reassignment", async () => {
  const store = new DeveloperChangeStore();
  await store.create(make());
  const submitted = submitDeveloperChange(make(),now);
  await store.update(submitted);
  assert.equal((await store.get({changeId:"change-001",founderId:"founder-1"}))?.status,"submitted");
  await assert.rejects(store.update({...submitted,founderId:"founder-2"}),/not found/);
  await assert.rejects(store.update({...submitted,createdAt:"2026-11-10T00:00:00.000Z"}),/immutable/);
  await assert.rejects(store.update({...make(),status:"approved"}),/transition is not allowed/);
});

test("requires review, Founder approval and execution evidence for advanced states", async () => {
  const store = new DeveloperChangeStore();
  await assert.rejects(store.create({...make(),status:"approved"}),/independent approval/);
  await assert.rejects(store.create({...make(),status:"rolled_back",rollbackSnapshotId:"snapshot-1"}),/independent approval/);
  const value = approved();
  await store.create(value);
  assert.equal((await store.get({changeId:value.id,founderId:"founder-1"}))?.status,"approved");
});

test("persists across instances and prevents deleting approved audit records", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"maya-change-store-"));
  const file = path.join(dir,"changes.json");
  try {
    const first = new DeveloperChangeStore(file);
    await first.create(make());
    assert.equal((await new DeveloperChangeStore(file).get({changeId:"change-001",founderId:"founder-1"}))?.founderId,"founder-1");
    const store = new DeveloperChangeStore();
    await store.create(approved());
    await assert.rejects(store.delete({changeId:"change-001",founderId:"founder-1"}),/audit history/);
    assert.equal(await first.delete({changeId:"change-001",founderId:"founder-2"}),false);
    assert.equal(await first.delete({changeId:"change-001",founderId:"founder-1"}),true);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test("refuses corrupt and unsafe storage files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"maya-change-corrupt-"));
  const file = path.join(dir,"changes.json");
  try {
    fs.writeFileSync(file,"{bad json");
    assert.throws(()=>new DeveloperChangeStore(file),/corrupt/);
    fs.rmSync(file);
    fs.symlinkSync(path.join(dir,"missing.json"),file);
    assert.throws(()=>new DeveloperChangeStore(file),/regular non-symlink/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
