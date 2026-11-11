import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type SandboxCommand = "typecheck" | "test" | "build";
export interface SandboxJob { id:string; workspaceId:string; baselineCommit:string; command:SandboxCommand; createdAt:string; }
export interface SandboxResult { id:string; workspaceId:string; command:SandboxCommand|"unknown"; status:"passed"|"failed"|"rejected"|"interrupted"; exitCode:number|null; timedOut:boolean; durationMs:number; output:string; finishedAt:string; }
export interface SandboxOptions {
  queueRoot:string; workspaceRoot:string;
  runCommand?:(command:SandboxCommand,cwd:string,timeoutMs:number)=>Promise<{exitCode:number|null;timedOut:boolean;output:string;durationMs:number}>;
  now?:()=>Date;
}
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;
const SHA=/^[a-f0-9]{40}$/i;
const ALLOWED=new Set<SandboxCommand>(["typecheck","test","build"]);
const MAX_OUTPUT=64_000;
const TIMEOUT=600_000;
const clean=(s:string)=>s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").slice(-MAX_OUTPUT);
const inside=(root:string,target:string)=>{const r=path.relative(root,target);return r===""||(!r.startsWith("..")&&!path.isAbsolute(r));};

async function dirs(root:string) {
  for(const n of ["pending","running","results"]) {
    const p=path.join(root,n); await fs.mkdir(p,{recursive:true,mode:0o700});
    const st=await fs.lstat(p); if(!st.isDirectory()||st.isSymbolicLink()) throw new Error("Queue paths must be regular directories.");
  }
}
function parseJob(v:unknown):SandboxJob {
  if(!v||typeof v!=="object"||Array.isArray(v)) throw new Error("Invalid sandbox job.");
  const j=v as Record<string,unknown>;
  if(Object.keys(j).sort().join(",")!=="baselineCommit,command,createdAt,id,workspaceId" ||
    typeof j.id!=="string"||!ID.test(j.id)||typeof j.workspaceId!=="string"||!ID.test(j.workspaceId)||
    typeof j.baselineCommit!=="string"||!SHA.test(j.baselineCommit)||
    typeof j.command!=="string"||!ALLOWED.has(j.command as SandboxCommand)||
    typeof j.createdAt!=="string"||!Number.isFinite(Date.parse(j.createdAt))) throw new Error("Invalid or unsupported sandbox job fields.");
  return j as unknown as SandboxJob;
}
async function workspacePath(rootInput:string,id:string,baselineCommit:string) {
  const root=await fs.realpath(rootInput), target=path.resolve(root,id);
  if(!inside(root,target)||target===root) throw new Error("Workspace path escapes sandbox root.");
  const st=await fs.lstat(target);
  if(!st.isDirectory()||st.isSymbolicLink()) throw new Error("Workspace must be a regular non-symlink directory.");
  const real=await fs.realpath(target);
  if(real!==target||!inside(root,real)) throw new Error("Workspace symlinks are blocked.");
  const marker=path.join(real,".maya-baseline");
  const markerStat=await fs.lstat(marker);
  if(!markerStat.isFile()||markerStat.isSymbolicLink()) throw new Error("Workspace baseline marker must be a regular file.");
  const recorded=(await fs.readFile(marker,"utf8")).trim();
  if(recorded.toLowerCase()!==baselineCommit.toLowerCase()) throw new Error("Workspace baseline commit does not match the approved job.");
  return real;
}
export async function runSandboxCommand(command:SandboxCommand,cwd:string,timeoutMs=TIMEOUT) {
  const script=command==="typecheck"?"lint":command==="test"?"test":"build";
  const start=Date.now(); let output="",timedOut=false,settled=false;
  return await new Promise<{exitCode:number|null;timedOut:boolean;output:string;durationMs:number}>(resolve=>{
    const finish=(exitCode:number|null)=>{if(settled)return;settled=true;resolve({exitCode,timedOut,output:clean(output),durationMs:Date.now()-start});};
    const child=spawn("npm",["run",script],{cwd,shell:false,windowsHide:true,detached:process.platform!=="win32",
      env:{PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin",HOME:"/tmp",TMPDIR:"/tmp",CI:"1",NODE_ENV:"test"},
      stdio:["ignore","pipe","pipe"]});
    const add=(b:Buffer)=>{output=clean(output+b.toString("utf8"));};
    child.stdout?.on("data",add); child.stderr?.on("data",add);
    const timer=setTimeout(()=>{timedOut=true;try{if(process.platform!=="win32"&&child.pid)process.kill(-child.pid,"SIGKILL");else child.kill("SIGKILL");}catch{}},Math.min(Math.max(timeoutMs,1000),TIMEOUT));
    child.once("error",e=>{clearTimeout(timer);output=clean(output+"\n"+e.message);finish(null);});
    child.once("close",code=>{clearTimeout(timer);finish(code);});
  });
}
async function saveResult(dir:string,result:SandboxResult) {
  const dest=path.join(dir,result.id+".json"),tmp=path.join(dir,"."+randomUUID()+".tmp");
  await fs.writeFile(tmp,JSON.stringify(result),{encoding:"utf8",flag:"wx",mode:0o600}); await fs.rename(tmp,dest);
}
export async function processOneSandboxJob(o:SandboxOptions):Promise<boolean> {
  const root=path.resolve(o.queueRoot); await dirs(root);
  const pending=path.join(root,"pending"),running=path.join(root,"running"),results=path.join(root,"results");
  const items=(await fs.readdir(pending,{withFileTypes:true})).filter(x=>x.isFile()&&x.name.endsWith(".json")).slice(0,100);
  if(!items.length)return false;
  const claimed=path.join(running,randomUUID()+".json");
  try{await fs.rename(path.join(pending,items[0].name),claimed);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return true;throw e;}
  const start=Date.now(); let job:SandboxJob|undefined, result:SandboxResult;
  try{
    const st=await fs.lstat(claimed); if(!st.isFile()||st.isSymbolicLink()||st.size>16_384)throw new Error("Invalid or oversized job file.");
    job=parseJob(JSON.parse(await fs.readFile(claimed,"utf8")));
    const cwd=await workspacePath(o.workspaceRoot,job.workspaceId,job.baselineCommit);
    const r=await (o.runCommand??runSandboxCommand)(job.command,cwd,TIMEOUT);
    result={id:job.id,workspaceId:job.workspaceId,command:job.command,status:!r.timedOut&&r.exitCode===0?"passed":"failed",exitCode:r.exitCode,timedOut:r.timedOut,durationMs:r.durationMs,output:clean(r.output),finishedAt:(o.now?.()??new Date()).toISOString()};
  }catch(e){
    result={id:job?.id??"rejected-"+path.basename(claimed,".json"),workspaceId:job?.workspaceId??"unknown",command:job?.command??"unknown",status:"rejected",exitCode:null,timedOut:false,durationMs:Date.now()-start,output:e instanceof Error?clean(e.message):"Job rejected.",finishedAt:(o.now?.()??new Date()).toISOString()};
  }
  await saveResult(results,result); await fs.rm(claimed,{force:true}); return true;
}
export async function runSandboxWorker(o:SandboxOptions):Promise<never> {
  const root=path.resolve(o.queueRoot); await dirs(root);
  const running=path.join(root,"running"),results=path.join(root,"results");
  for(const entry of await fs.readdir(running,{withFileTypes:true})) {
    if(!entry.isFile()||!entry.name.endsWith(".json"))continue;
    await saveResult(results,{id:"interrupted-"+randomUUID(),workspaceId:"unknown",command:"unknown",status:"interrupted",exitCode:null,timedOut:false,durationMs:0,output:"Worker restarted; job was not replayed.",finishedAt:(o.now?.()??new Date()).toISOString()});
    await fs.rm(path.join(running,entry.name),{force:true});
  }
  while(true){if(!await processOneSandboxJob(o))await new Promise(r=>setTimeout(r,1000));}
}
if(process.env.MAYA_DEVELOPER_SANDBOX_QUEUE_DIR&&process.env.MAYA_DEVELOPER_SANDBOX_WORKSPACE_DIR){
  runSandboxWorker({queueRoot:process.env.MAYA_DEVELOPER_SANDBOX_QUEUE_DIR,workspaceRoot:process.env.MAYA_DEVELOPER_SANDBOX_WORKSPACE_DIR}).catch(()=>{process.exitCode=1;});
}
