import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {processOneSandboxJob} from "./developer-sandbox-worker.ts";
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"maya-sandbox-"));
 const queueRoot=path.join(root,"queue"),workspaceRoot=path.join(root,"workspaces"),workspaceId="workspace-001";
 await fs.mkdir(path.join(workspaceRoot,workspaceId),{recursive:true});
 await fs.mkdir(path.join(queueRoot,"pending"),{recursive:true});
 return {root,queueRoot,workspaceRoot,workspaceId};
}
function job(f:Awaited<ReturnType<typeof fixture>>,overrides:Record<string,unknown>={}) {
 return {id:"job-00000001",workspaceId:f.workspaceId,baselineCommit:"a".repeat(40),command:"test",createdAt:"2026-11-11T10:00:00.000Z",...overrides};
}
async function enqueue(f:Awaited<ReturnType<typeof fixture>>,value:unknown){
 await fs.writeFile(path.join(f.queueRoot,"pending","job.json"),JSON.stringify(value));
}
test("runs a fixed allowlisted operation and persists its result",async()=>{
 const f=await fixture(); await enqueue(f,job(f)); let called="";
 await processOneSandboxJob({queueRoot:f.queueRoot,workspaceRoot:f.workspaceRoot,runCommand:async(c,cwd)=>{called=c+":"+cwd;return{exitCode:0,timedOut:false,output:"ok",durationMs:3};}});
 assert.equal(called,"test:"+path.join(f.workspaceRoot,f.workspaceId));
 const r=JSON.parse(await fs.readFile(path.join(f.queueRoot,"results","job-00000001.json"),"utf8"));assert.equal(r.status,"passed");
 await fs.rm(f.root,{recursive:true,force:true});
});
test("rejects arbitrary commands and unexpected fields without executing",async()=>{
 const f=await fixture();await enqueue(f,job(f,{command:"rm -rf /"}));let called=false;
 await processOneSandboxJob({queueRoot:f.queueRoot,workspaceRoot:f.workspaceRoot,runCommand:async()=>{called=true;return{exitCode:0,timedOut:false,output:"",durationMs:1};}});
 const names=await fs.readdir(path.join(f.queueRoot,"results"));const r=JSON.parse(await fs.readFile(path.join(f.queueRoot,"results",names[0]),"utf8"));
 assert.equal(r.status,"rejected");assert.equal(called,false);await fs.rm(f.root,{recursive:true,force:true});
});
test("rejects symlinked workspace directories",async()=>{
 const f=await fixture();await fs.rm(path.join(f.workspaceRoot,f.workspaceId),{recursive:true});await fs.symlink(f.root,path.join(f.workspaceRoot,f.workspaceId));await enqueue(f,job(f));let called=false;
 await processOneSandboxJob({queueRoot:f.queueRoot,workspaceRoot:f.workspaceRoot,runCommand:async()=>{called=true;return{exitCode:0,timedOut:false,output:"",durationMs:1};}});
 const r=JSON.parse(await fs.readFile(path.join(f.queueRoot,"results","job-00000001.json"),"utf8"));assert.equal(r.status,"rejected");assert.equal(called,false);
 await fs.rm(f.root,{recursive:true,force:true});
});
test("rejects oversized queue entries",async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.queueRoot,"pending","job.json"),"x".repeat(20_000));
 await processOneSandboxJob({queueRoot:f.queueRoot,workspaceRoot:f.workspaceRoot});
 const names=await fs.readdir(path.join(f.queueRoot,"results"));const r=JSON.parse(await fs.readFile(path.join(f.queueRoot,"results",names[0]),"utf8"));assert.equal(r.status,"rejected");
 await fs.rm(f.root,{recursive:true,force:true});
});
