import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createDockerHostIsolationAttestation } from "./developer-docker-host-supervisor.ts";
import { createSignedHostIsolationVerifier } from "./developer-host-isolation-attestation.ts";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const publicKeyPem=publicKey.export({type:"spki",format:"pem"}).toString();
const privateKeyPem=privateKey.export({type:"pkcs8",format:"pem"}).toString();
const policy={
 issuer:"maya-host-supervisor-test",workspaceId:"workspace-123456",baselineCommit:"a".repeat(40),privateKeyPem,
 expectedImageId:"sha256:"+"b".repeat(64),
 expectedQueueVolumeSource:"/var/lib/docker/volumes/maya-queue/_data",
 expectedWorkspaceVolumeSource:"/var/lib/docker/volumes/maya-workspaces/_data",
 now:()=>new Date("2026-11-12T14:00:00.000Z"),
};
function inspection(){
 return {
  Image:policy.expectedImageId,State:{Running:true,Status:"running"},
  Config:{User:"node",Env:["NODE_ENV=test","MAYA_DEVELOPER_SANDBOX_QUEUE_DIR=/developer-queue"]},
  HostConfig:{
   NetworkMode:"none",ReadonlyRootfs:true,Privileged:false,PidMode:"",IpcMode:"",CapAdd:[],CapDrop:["ALL"],
   SecurityOpt:["no-new-privileges:true"],Devices:[],Binds:[],PidsLimit:128,Memory:2147483648,NanoCpus:2000000000,
   Tmpfs:{"/tmp":"rw,noexec,nosuid,size=134217728"},
  },
  Mounts:[
   {Type:"volume",Source:policy.expectedQueueVolumeSource,Destination:"/developer-queue",RW:true},
   {Type:"volume",Source:policy.expectedWorkspaceVolumeSource,Destination:"/developer-workspaces",RW:true},
  ],
 };
}
test("signs fresh attestation only after strict Docker inspection checks",()=>{
 const a=createDockerHostIsolationAttestation(inspection(),policy);
 assert.equal(a.isolated,true);assert.equal(a.networkAccess,false);assert.equal(a.secretsMounted,false);
 assert.equal(a.issuer,policy.issuer);assert.equal(a.baselineCommit,policy.baselineCommit);assert.ok(a.signature);
});
test("signed supervisor result is accepted by the verifier",async()=>{
 const a=createDockerHostIsolationAttestation(inspection(),policy);
 const verifier=createSignedHostIsolationVerifier({
  publicKeyPem,expectedIssuer:policy.issuer,
  getBinding:async()=>({workspaceId:policy.workspaceId,baselineCommit:policy.baselineCommit}),
  getAttestation:async()=>a,consumeNonce:async()=>true,now:policy.now,
 });
 assert.deepEqual(await verifier.verify(),{isolated:true,networkAccess:false,secretsMounted:false});
});
test("rejects network-enabled workers",()=>{
 const x=inspection();x.HostConfig.NetworkMode="bridge";
 assert.throws(()=>createDockerHostIsolationAttestation(x,policy),/network_mode=none/);
});
test("rejects writable root filesystem and added capabilities",()=>{
 const x=inspection();x.HostConfig.ReadonlyRootfs=false;
 assert.throws(()=>createDockerHostIsolationAttestation(x,policy),/read-only/);
 const y=inspection();y.HostConfig.CapAdd=["SYS_ADMIN"];
 assert.throws(()=>createDockerHostIsolationAttestation(y,policy),/drop all Linux capabilities/);
});
test("rejects unapproved image, mount and secret environment",()=>{
 const x=inspection();x.Image="sha256:"+"c".repeat(64);
 assert.throws(()=>createDockerHostIsolationAttestation(x,policy),/image ID/);
 const y=inspection();y.Mounts[0].Source="/tmp/attacker";
 assert.throws(()=>createDockerHostIsolationAttestation(y,policy),/volume mounts/);
 const z=inspection();z.Config.Env.push("GEMINI_API_KEY=present");
 assert.throws(()=>createDockerHostIsolationAttestation(z,policy),/credential-like/);
});
test("rejects missing resource limits and unexpected mounts",()=>{
 const x=inspection();x.HostConfig.PidsLimit=0;
 assert.throws(()=>createDockerHostIsolationAttestation(x,policy),/resource limits/);
 const y=inspection();y.Mounts.push({Type:"bind",Source:"/host",Destination:"/host",RW:true});
 assert.throws(()=>createDockerHostIsolationAttestation(y,policy),/unexpected or missing mounts/);
});
