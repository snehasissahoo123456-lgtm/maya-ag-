import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDeveloperChangeRequest, approveDeveloperChange, recordDeveloperReview, submitDeveloperChange, startDeveloperChangeExecution } from "./developer-change-control.ts";
import { DeveloperChangeStore } from "./developer-change-store.ts";
import { verifyDeveloperWorkspaceChange } from "./developer-change-qa-orchestrator.ts";
import { processOneSandboxJob } from "./developer-sandbox-worker.ts";
import type { DeveloperWorkspaceAdapter, DeveloperExecutionResult } from "./developer-workspace-executor.ts";

const sha = (v:string) => createHash("sha256").update(v,"utf8").digest("hex");
const baseline = "b".repeat(40);

async function fixture(exitCode=0) {
  const root = await mkdtemp(path.join(os.tmpdir(),"maya-dev-qa-"));
  const queueRoot = path.join(root,"queue"), workspaceRoot = path.join(root,"workspaces");
  const workspaceDir = path.join(workspaceRoot,"workspace-01");
  await mkdir(path.join(queueRoot,"baselines"),{recursive:true});
  await mkdir(workspaceDir,{recursive:true});
  await writeFile(path.join(queueRoot,"baselines","workspace-01.sha"),baseline);
  const patch = "diff --git a/src/example.ts b/src/example.ts";
  let restored = "";
  const workspace:DeveloperWorkspaceAdapter = {
    inspect:async()=>({workspaceId:"workspace-01",baselineCommit:baseline,isolated:true,networkAccess:false,secretsMounted:false}),
    applyAtomically:async()=>({snapshotId:"snapshot-qa-01"}),
    restoreSnapshot:async id=>{restored=id;},
  };
  const change0 = createDeveloperChangeRequest({
    id:"change-qa-01",founderId:"founder-qa",title:"QA change",objective:"Verify isolated change",
    workspaceId:"workspace-01",files:["src/example.ts"],patch,diffSha256:sha(patch),
  });
  const changes = new DeveloperChangeStore();
  await changes.create(change0);
  let change = submitDeveloperChange(change0);
  await changes.update(change);
  change = recordDeveloperReview(change,{reviewerId:"reviewer-qa",decision:"approved",notes:"Independent review passed."});
  await changes.update(change);
  change = approveDeveloperChange(change,"founder-qa");
  await changes.update(change);
  const executing = startDeveloperChangeExecution(change);
  const execution:DeveloperExecutionResult = {
    status:"applied",change:executing,snapshotId:"snapshot-qa-01",
    packageSha256:"c".repeat(64),appliedFiles:["src/example.ts"],
  };
  await changes.update({...executing,rollbackSnapshotId:execution.snapshotId});
  const runCommand = async()=>({exitCode,timedOut:false,output:exitCode===0?"checks passed":"checks failed",durationMs:12});
  const wait = async()=>{await processOneSandboxJob({queueRoot,workspaceRoot,runCommand});};
  return {root,queueRoot,changes,workspace,execution,wait,restored:()=>restored};
}

test("completes only after all three sandbox checks pass",async()=>{
  const f=await fixture(0);
  try{
    const result=await verifyDeveloperWorkspaceChange(
      {changes:f.changes,workspace:f.workspace,queueRoot:f.queueRoot,wait:f.wait},
      {changeId:"change-qa-01",founderId:"founder-qa",execution:f.execution,timeoutMs:5000,pollIntervalMs:50},
    );
    assert.equal(result.status,"completed");
    assert.equal(result.passed,true);
    assert.equal(result.results.length,3);
    assert.equal((await f.changes.get({changeId:"change-qa-01",founderId:"founder-qa"}))?.status,"completed");
    assert.equal(f.restored(),"");
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test("rolls back exact snapshot when a sandbox check fails",async()=>{
  const f=await fixture(1);
  try{
    const result=await verifyDeveloperWorkspaceChange(
      {changes:f.changes,workspace:f.workspace,queueRoot:f.queueRoot,wait:f.wait},
      {changeId:"change-qa-01",founderId:"founder-qa",execution:f.execution,timeoutMs:5000,pollIntervalMs:50},
    );
    assert.equal(result.status,"rolled_back");
    assert.equal(result.passed,false);
    assert.equal(f.restored(),"snapshot-qa-01");
    assert.equal((await f.changes.get({changeId:"change-qa-01",founderId:"founder-qa"}))?.status,"rolled_back");
  }finally{await rm(f.root,{recursive:true,force:true});}
});
