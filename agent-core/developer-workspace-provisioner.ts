import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { validateDeveloperPatch } from "./developer-change-control.ts";
export interface DeveloperWorkspaceSnapshotFile { path:string; content:string; contentSha256:string; }
export interface DeveloperWorkspaceSnapshot { workspaceId:string; baselineCommit:string; files:readonly DeveloperWorkspaceSnapshotFile[]; }
export interface DeveloperWorkspaceProvisionerOptions { workspaceRoot:string; queueRoot:string; maxFiles?:number; maxFileBytes?:number; maxTotalBytes?:number; }
export interface ProvisionedDeveloperWorkspace { workspaceId:string; baselineCommit:string; workspacePath:string; fileCount:number; totalBytes:number; }
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;
const GIT=/^[a-f0-9]{40}$/i, HASH=/^[a-f0-9]{64}$/i;
const SECRET=/(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,})\b|-----BEGIN CERTIFICATE-----)/;
const DEFAULTS={maxFiles:10000,maxFileBytes:2*1024*1024,maxTotalBytes:50*1024*1024};
const hash=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const inside=(root:string,target:string)=>{const r=path.relative(root,target);return r===""||(!r.startsWith("..")&&!path.isAbsolute(r));};
async function ensureDir(input:string){await fs.mkdir(input,{recursive:true,mode:0o700});const st=await fs.lstat(input);if(!st.isDirectory()||st.isSymbolicLink())throw new Error("Provisioning roots must be regular directories.");const real=await fs.realpath(input);if(real!==path.resolve(input))throw new Error("Provisioning roots cannot resolve through symlinks.");return real;}
function validate(snapshot:DeveloperWorkspaceSnapshot,limits:typeof DEFAULTS){
 if(!snapshot||!ID.test(snapshot.workspaceId)||!GIT.test(snapshot.baselineCommit)||!Array.isArray(snapshot.files)||snapshot.files.length<1||snapshot.files.length>limits.maxFiles)throw new Error("Workspace snapshot identity, baseline or file count is invalid.");
 validateDeveloperPatch({files:snapshot.files.map(f=>f?.path),patch:"workspace-snapshot"});
 const seen=new Set<string>();let totalBytes=0;
 const files=snapshot.files.map(f=>{if(!f||typeof f.path!=="string"||typeof f.content!=="string"||typeof f.contentSha256!=="string"||!HASH.test(f.contentSha256))throw new Error("Workspace snapshot contains an invalid file record.");if(seen.has(f.path))throw new Error("Workspace snapshot contains duplicate paths.");seen.add(f.path);const bytes=Buffer.byteLength(f.content,"utf8");if(bytes>limits.maxFileBytes)throw new Error("Workspace snapshot file exceeds the per-file limit: "+f.path);totalBytes+=bytes;if(totalBytes>limits.maxTotalBytes)throw new Error("Workspace snapshot exceeds the total size limit.");if(SECRET.test(f.content))throw new Error("Workspace snapshot contains a credential or private-key pattern.");if(hash(f.content)!==f.contentSha256.toLowerCase())throw new Error("Workspace snapshot content digest mismatch: "+f.path);return{path:f.path,content:f.content,contentSha256:f.contentSha256.toLowerCase()};});
 return{files,totalBytes};
}
/** Builds a disposable workspace from a trusted, content-hashed baseline snapshot. No code is executed and the source repository is never modified. */
export async function provisionDeveloperWorkspace(options:DeveloperWorkspaceProvisionerOptions,snapshot:DeveloperWorkspaceSnapshot):Promise<ProvisionedDeveloperWorkspace>{
 const limits={...DEFAULTS,maxFiles:options.maxFiles??DEFAULTS.maxFiles,maxFileBytes:options.maxFileBytes??DEFAULTS.maxFileBytes,maxTotalBytes:options.maxTotalBytes??DEFAULTS.maxTotalBytes};
 for(const [k,v] of Object.entries(limits))if(!Number.isInteger(v)||v<1)throw new Error("Workspace provisioning limits must be positive integers: "+k);
 const{files,totalBytes}=validate(snapshot,limits),workspaceRoot=await ensureDir(path.resolve(options.workspaceRoot)),queueRoot=await ensureDir(path.resolve(options.queueRoot)),baselines=await ensureDir(path.join(queueRoot,"baselines"));
 const destination=path.resolve(workspaceRoot,snapshot.workspaceId),baseline=path.join(baselines,snapshot.workspaceId+".sha");
 if(!inside(workspaceRoot,destination)||destination===workspaceRoot)throw new Error("Workspace destination escapes its root.");
 for(const target of[destination,baseline]){try{await fs.lstat(target);throw new Error("Workspace or baseline already exists; refusing to overwrite it.");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
 const temp=path.join(workspaceRoot,".provision-"+randomUUID()),markerTemp=path.join(baselines,"."+snapshot.workspaceId+"."+randomUUID()+".tmp");await fs.mkdir(temp,{mode:0o700});let published=false;
 try{
  for(const file of files){const target=path.resolve(temp,file.path);if(!inside(temp,target)||target===temp)throw new Error("Snapshot file path escapes the workspace.");await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.writeFile(target,file.content,{encoding:"utf8",flag:"wx",mode:0o600});const st=await fs.lstat(target);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw new Error("Provisioned files must be regular, unlinked files.");}
  await fs.chmod(temp,0o750);await fs.writeFile(markerTemp,snapshot.baselineCommit.toLowerCase()+"\n",{encoding:"utf8",flag:"wx",mode:0o600});await fs.rename(temp,destination);published=true;
  try{await fs.rename(markerTemp,baseline);}catch(e){await fs.rm(destination,{recursive:true,force:true});published=false;throw e;}
 }catch(e){if(!published)await fs.rm(temp,{recursive:true,force:true});await fs.rm(markerTemp,{force:true});throw e;}
 return{workspaceId:snapshot.workspaceId,baselineCommit:snapshot.baselineCommit.toLowerCase(),workspacePath:destination,fileCount:files.length,totalBytes};
}