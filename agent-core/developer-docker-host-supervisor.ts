import { execFile } from "node:child_process";
import { randomBytes, createPrivateKey, sign } from "node:crypto";
import { hostIsolationAttestationSigningBytes, type HostIsolationAttestationPayload, type SignedHostIsolationAttestation } from "./developer-host-isolation-attestation.ts";

export interface DockerHostSupervisorPolicy {
  issuer: string; workspaceId: string; baselineCommit: string; privateKeyPem: string;
  expectedImageId: string; expectedQueueVolumeSource: string; expectedWorkspaceVolumeSource: string;
  now?: () => Date; attestationTtlMs?: number;
}
type JsonObject = Record<string, unknown>;
const SHA=/^[a-f0-9]{40}$/i, IMAGE_ID=/^sha256:[a-f0-9]{64}$/i;
const WORKSPACE_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;
const SECRET_ENV=/(API.?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE.?KEY|SUPABASE|GEMINI|GOOGLE|OPENAI|FOUNDER|REVIEWER)/i;
const object=(v:unknown):JsonObject=>v&&typeof v==="object"&&!Array.isArray(v)?v as JsonObject:{};
const string=(v:unknown)=>typeof v==="string"?v:"";
const list=(v:unknown)=>Array.isArray(v)?v:[];

/** Host-only policy checker and Ed25519 signer for the dedicated Maya QA worker. */
export function createDockerHostIsolationAttestation(inspection:unknown,policy:DockerHostSupervisorPolicy):SignedHostIsolationAttestation {
  if(!policy||!policy.issuer.trim()||!WORKSPACE_ID.test(policy.workspaceId)||!SHA.test(policy.baselineCommit)||
    !IMAGE_ID.test(policy.expectedImageId)||!policy.privateKeyPem.trim()||
    !policy.expectedQueueVolumeSource.trim()||!policy.expectedWorkspaceVolumeSource.trim())
    throw new Error("Host supervisor policy is incomplete or invalid.");
  const root=object(inspection),state=object(root.State),config=object(root.Config),host=object(root.HostConfig);
  if(state.Running!==true||state.Status!=="running")throw new Error("QA worker container is not running.");
  if(string(root.Image).toLowerCase()!==policy.expectedImageId.toLowerCase())throw new Error("QA worker image ID does not match the host-approved image.");
  if(string(config.User)!=="node")throw new Error("QA worker must run as the unprivileged node user.");
  if(host.NetworkMode!=="none")throw new Error("QA worker must use Docker network_mode=none.");
  if(host.ReadonlyRootfs!==true)throw new Error("QA worker root filesystem must be read-only.");
  if(host.Privileged===true||host.PidMode==="host"||host.IpcMode==="host")throw new Error("Privileged, host-PID and host-IPC worker modes are forbidden.");
  if(list(host.CapAdd).length!==0||!list(host.CapDrop).some(x=>x==="ALL"))throw new Error("QA worker must drop all Linux capabilities and add none.");
  if(!list(host.SecurityOpt).some(x=>x==="no-new-privileges:true"))throw new Error("QA worker must enable no-new-privileges.");
  if(list(host.Devices).length!==0||list(host.Binds).length!==0)throw new Error("Host devices and bind mounts are forbidden for the QA worker.");
  const pids=Number(host.PidsLimit),memory=Number(host.Memory),nanoCpus=Number(host.NanoCpus);
  if(!Number.isFinite(pids)||pids<1||pids>128||!Number.isFinite(memory)||memory<1||memory>2*1024*1024*1024||
    !Number.isFinite(nanoCpus)||nanoCpus<1||nanoCpus>2_000_000_000)
    throw new Error("QA worker resource limits are missing or exceed the host supervisor policy.");
  const mounts=list(root.Mounts).map(object);
  const expected=[
    {destination:"/developer-queue",source:policy.expectedQueueVolumeSource},
    {destination:"/developer-workspaces",source:policy.expectedWorkspaceVolumeSource},
  ];
  if(mounts.length!==expected.length)throw new Error("QA worker has unexpected or missing mounts.");
  for(const mount of expected){
    const found=mounts.find(x=>x.Destination===mount.destination);
    if(!found||found.Type!=="volume"||found.RW!==true||string(found.Source)!==mount.source)
      throw new Error("QA worker volume mounts do not match the host-approved queue/workspace volumes.");
  }
  const tmp=string(object(host.Tmpfs)["/tmp"]);
  if(!tmp||!tmp.includes("noexec")||!tmp.includes("nosuid"))throw new Error("QA worker /tmp must be a noexec,nosuid tmpfs.");
  const env=list(config.Env).filter((x):x is string=>typeof x==="string");
  if(env.some(value=>SECRET_ENV.test(value.split("=",1)[0])))throw new Error("QA worker environment contains a credential-like variable.");
  const now=(policy.now?.()??new Date()).getTime(),ttl=policy.attestationTtlMs??15_000;
  if(!Number.isInteger(ttl)||ttl<1_000||ttl>30_000)throw new Error("Host attestation TTL must be between one and thirty seconds.");
  const payload:HostIsolationAttestationPayload={
    version:1,issuer:policy.issuer,workspaceId:policy.workspaceId,baselineCommit:policy.baselineCommit.toLowerCase(),
    isolated:true,networkAccess:false,secretsMounted:false,issuedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+ttl).toISOString(),nonce:randomBytes(32).toString("base64url"),
  };
  const key=createPrivateKey(policy.privateKeyPem);
  if(key.asymmetricKeyType!=="ed25519")throw new Error("Host supervisor signing key must be Ed25519.");
  return {...payload,signature:sign(null,hostIsolationAttestationSigningBytes(payload),key).toString("base64url")};
}


export type DockerInspectRunner = (containerId: string) => Promise<string>;

/** Query the local Docker CLI without a shell, then attest only its live inspect result. */
export async function inspectDockerWorkerAndAttest(
  containerId: string,
  policy: DockerHostSupervisorPolicy,
  runner: DockerInspectRunner = (id) => new Promise((resolve, reject) => {
    execFile("docker", ["inspect", id], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      encoding: "utf8",
    }, (error, stdout) => {
      if (error) reject(new Error("Docker inspect failed; no host attestation was issued."));
      else resolve(stdout);
    });
  }),
): Promise<SignedHostIsolationAttestation> {
  if (typeof containerId !== "string" || !/^[a-f0-9]{12,64}$/i.test(containerId)) {
    throw new Error("A valid Docker container ID is required.");
  }
  const raw = await runner(containerId);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error("Docker inspect returned invalid JSON; no host attestation was issued.");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Docker inspect must return exactly one container.");
  }
  return createDockerHostIsolationAttestation(parsed[0], policy);
}
