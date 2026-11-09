import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

interface BridgeCredentials { serverUrl: string; deviceId: string; founderId: string; token: string; }
interface BridgeCommand { type: "command"; requestId: string; command: string; args?: Record<string, unknown>; }

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function isSensitive(target: string): boolean {
  const parts = target.split(path.sep).map(part => part.toLowerCase());
  const base = path.basename(target).toLowerCase();
  return parts.some(part => [".git", "node_modules", "secrets", "credentials", ".maya", ".ssh", ".aws", ".gnupg", ".kube", ".azure"].includes(part)) ||
    base === ".env" || base.startsWith(".env.") || base === ".npmrc" || base === ".netrc" ||
    base === "id_rsa" || base === "id_ed25519" || base === "authorized_keys" || base === "known_hosts" ||
    base.includes("credential") || base.includes("service-account") ||
    base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p8") || base.endsWith(".p12") ||
    base.endsWith(".pfx") || base.endsWith(".jks") || base.endsWith(".keystore");
}
function resolveAllowedPath(root: string, relativePath: unknown): string {
  if (typeof relativePath !== "string" || relativePath.length > 1024) throw new Error("A valid relative path is required.");
  let realRoot: string;
  try { realRoot = fs.realpathSync(root); }
  catch { throw new Error("Configured workspace root cannot be resolved."); }
  const lexicalTarget = path.resolve(realRoot, relativePath || ".");
  if (!isWithinRoot(realRoot, lexicalTarget)) throw new Error("Path escapes the configured workspace root.");
  // Reject symlinks in every path component, not only the final file. Resolving first
  // and lstat'ing only the resolved target would silently follow a symlinked parent.
  const relative = path.relative(realRoot, lexicalTarget);
  let cursor = realRoot;
  try {
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error("Symbolic links are blocked in the enrolled workspace.");
    }
    const realTarget = fs.realpathSync(lexicalTarget);
    if (!isWithinRoot(realRoot, realTarget)) throw new Error("Resolved workspace path escapes the configured workspace root.");
    if (isSensitive(realTarget)) throw new Error("Access to sensitive workspace paths is blocked.");
    return realTarget;
  } catch (error) {
    if (error instanceof Error && ["Symbolic links", "escapes", "sensitive"].some(marker => error.message.includes(marker))) throw error;
    throw new Error("Workspace path does not exist or cannot be resolved.");
  }
}

function resolveCreatablePath(root: string, relativePath: unknown): string {
  if (typeof relativePath !== "string" || !relativePath.trim() || relativePath.length > 1024 || path.isAbsolute(relativePath)) {
    throw new Error("A valid workspace-relative new-file path is required.");
  }
  const realRoot = fs.realpathSync(root);
  const lexicalTarget = path.resolve(realRoot, relativePath);
  if (!isWithinRoot(realRoot, lexicalTarget) || lexicalTarget === realRoot) throw new Error("New-file path escapes or equals the workspace root.");
  const parent = path.dirname(lexicalTarget);
  const relativeParent = path.relative(realRoot, parent);
  let cursor = realRoot;
  try {
    for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error("Symbolic links are blocked in the enrolled workspace.");
      if (!stat.isDirectory()) throw new Error("New-file parent must be an existing directory.");
    }
    const realParent = fs.realpathSync(parent);
    if (!isWithinRoot(realRoot, realParent)) throw new Error("New-file parent escapes the configured workspace root.");
    const target = path.join(realParent, path.basename(lexicalTarget));
    if (isSensitive(target)) throw new Error("Creation in sensitive workspace paths is blocked.");
    try {
      fs.lstatSync(target);
      throw new Error("Target file already exists; create-file never overwrites.");
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) throw error;
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    return target;
  } catch (error) {
    if (error instanceof Error && ["Symbolic links", "escapes", "sensitive", "existing directory", "already exists"].some(marker => error.message.includes(marker))) throw error;
    throw new Error("New-file parent does not exist or cannot be resolved.");
  }
}

function resolveCreatableDirectoryPath(root: string, relativePath: unknown): string {
  if (typeof relativePath !== "string" || !relativePath.trim() || relativePath.length > 1024 || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("A valid workspace-relative new-directory path is required.");
  }
  const segments = relativePath.split(/[\\/]+/);
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error("Directory paths must use explicit child names without dot segments.");
  }
  const realRoot = fs.realpathSync(root);
  const normalized = relativePath.replace(/[\\/]+/g, path.sep);
  const target = path.resolve(realRoot, normalized);
  if (!isWithinRoot(realRoot, target) || target === realRoot) throw new Error("New-directory path escapes or equals the workspace root.");
  const parent = path.dirname(target);
  const relativeParent = path.relative(realRoot, parent);
  let cursor = realRoot;
  try {
    for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error("Symbolic links are blocked in the enrolled workspace.");
      if (!stat.isDirectory()) throw new Error("New-directory parent must be an existing directory.");
    }
    const realParent = fs.realpathSync(parent);
    if (!isWithinRoot(realRoot, realParent)) throw new Error("New-directory parent escapes the configured workspace root.");
    const finalPath = path.join(realParent, path.basename(target));
    if (isSensitive(finalPath)) throw new Error("Creation in sensitive workspace paths is blocked.");
    try {
      fs.lstatSync(finalPath);
      throw new Error("Target directory already exists; create-directory never replaces.");
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) throw error;
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    return finalPath;
  } catch (error) {
    if (error instanceof Error && ["Symbolic links", "escapes", "sensitive", "existing directory", "already exists"].some(marker => error.message.includes(marker))) throw error;
    throw new Error("New-directory parent does not exist or cannot be resolved.");
  }
}

export async function executeLocalBridgeCommand(rootInput: string, command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const root = fs.realpathSync(path.resolve(rootInput));
  if (command === "system.info") {
    return { node: process.version, platform: process.platform, architecture: process.arch, hostname: os.hostname(), uptimeSeconds: Math.floor(os.uptime()), memory: os.totalmem() };
  }
  if (command === "workspace.list") {
    const directory = resolveAllowedPath(root, args.path || ".");
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Only workspace directories can be listed.");
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => !entry.isSymbolicLink() && !isSensitive(path.join(directory, entry.name)))
      .slice(0, 100)
      .map(entry => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }));
  }
  if (command === "workspace.git_status") {
    const directory = resolveAllowedPath(root, args.path || ".");
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Git status path must be a regular workspace directory.");
    const processResult = spawnSync("git", [
      "-c", "core.fsmonitor=false",
      "-c", "core.pager=cat",
      "status", "--porcelain=v1", "--branch", "--untracked-files=no", "--no-renames",
    ], {
      cwd: directory,
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" },
    });
    if (processResult.error) throw new Error("Git status could not run: " + processResult.error.message.slice(0, 200));
    if (processResult.status !== 0) throw new Error("Git status failed: " + String(processResult.stderr || "Not a Git repository.").trim().slice(0, 300));
    const lines = String(processResult.stdout || "").split(/\r?\n/).filter(Boolean);
    const branch = lines.find(line => line.startsWith("## "))?.slice(3) || "unknown";
    const changes = lines.filter(line => !line.startsWith("## ")).flatMap(line => {
      const rawPath = line.slice(3).split(" -> ").pop() || "";
      if (!rawPath || isSensitive(path.resolve(directory, rawPath))) return [];
      return [{ status: line.slice(0, 2), path: rawPath.slice(0, 1024) }];
    });
    return {
      repository: path.relative(root, directory) || ".",
      branch,
      changes: changes.slice(0, 200),
      changeCount: changes.length,
      truncated: changes.length > 200,
    };
  }
  if (command === "workspace.read_file") {
    const file = resolveAllowedPath(root, args.path);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Only regular non-symlink files can be read.");
    if (stat.size > 50_000) throw new Error("File exceeds the 50 KB read limit.");
    return { path: path.relative(root, file), content: fs.readFileSync(file, "utf8") };
  }
  if (command === "workspace.move_file") {
    const source = resolveAllowedPath(root, args.fromPath);
    const sourceStat = fs.lstatSync(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error("Only regular non-symlink files can be moved.");
    if (sourceStat.size > 5_000_000) throw new Error("Source file exceeds the 5 MB move limit.");
    const destination = resolveCreatablePath(root, args.toPath);
    if (path.resolve(source) === path.resolve(destination)) throw new Error("Source and destination paths must be different.");
    const sourceBytes = fs.readFileSync(source);
    const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
    // linkSync is exclusive: it fails if the destination exists, unlike rename on POSIX.
    // Both paths are constrained to this workspace, so the hard link remains on one volume.
    fs.linkSync(source, destination);
    try {
      const destinationStat = fs.lstatSync(destination);
      const destinationReal = fs.realpathSync(destination);
      const destinationBytes = fs.readFileSync(destination);
      const destinationDigest = createHash("sha256").update(destinationBytes).digest("hex");
      if (!destinationStat.isFile() || destinationStat.isSymbolicLink() ||
          !isWithinRoot(root, destinationReal) || destinationDigest !== sourceDigest ||
          destinationBytes.length !== sourceBytes.length) {
        throw new Error("Moved-file verification failed; source has been preserved.");
      }
      fs.unlinkSync(source);
      return {
        fromPath: path.relative(root, source),
        toPath: path.relative(root, destination),
        moved: true,
        verified: true,
        bytes: destinationBytes.length,
        sha256: destinationDigest,
      };
    } catch (error) {
      try { fs.unlinkSync(destination); } catch {}
      throw error;
    }
  }
  if (command === "workspace.create_directory") {
    const directory = resolveCreatableDirectoryPath(root, args.path);
    fs.mkdirSync(directory, { mode: 0o755 });
    const stat = fs.lstatSync(directory);
    const realDirectory = fs.realpathSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isWithinRoot(root, realDirectory) || isSensitive(realDirectory)) {
      throw new Error("Local directory creation could not be safely verified; inspect the target path before retrying.");
    }
    return { path: path.relative(root, realDirectory), created: true, verified: true };
  }
  if (command === "workspace.create_file") {
    const file = resolveCreatablePath(root, args.path);
    const content = args.content;
    if (typeof content !== "string" || content.includes("\u0000") || Buffer.byteLength(content, "utf8") > 100_000) {
      throw new Error("New-file content must be plain text no larger than 100 KB.");
    }
    const temp = path.join(path.dirname(file), `.maya-create.${process.pid}.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o644, flag: "wx" });
      fs.linkSync(temp, file);
    } finally {
      try { fs.rmSync(temp, { force: true }); } catch {}
    }
    const verified = fs.readFileSync(file, "utf8");
    if (verified !== content) throw new Error("Local create verification failed; resulting bytes differ from the approved payload.");
    const sha256 = createHash("sha256").update(verified, "utf8").digest("hex");
    return { path: path.relative(root, file), bytes: Buffer.byteLength(verified, "utf8"), sha256, verified: true, created: true };
  }
  if (command === "workspace.write_file") {
    const file = resolveAllowedPath(root, args.path);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Only existing regular non-symlink files can be replaced.");
    if (stat.size > 100_000) throw new Error("Existing file exceeds the 100 KB write limit.");
    const originalBytes = fs.readFileSync(file);
    if (originalBytes.includes(0)) throw new Error("Binary files cannot be replaced through the local bridge.");
    const content = args.content;
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 100_000) throw new Error("Replacement content must be text no larger than 100 KB.");
    const temp = path.join(path.dirname(file), `.maya-write.${process.pid}.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temp, content, { encoding: "utf8", mode: stat.mode & 0o777, flag: "wx" });
      fs.renameSync(temp, file);
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch {}
      throw error;
    }
    const verified = fs.readFileSync(file, "utf8");
    if (verified !== content) throw new Error("Local write verification failed; resulting bytes differ from the approved payload.");
    const sha256 = createHash("sha256").update(verified, "utf8").digest("hex");
    return { path: path.relative(root, file), bytes: Buffer.byteLength(verified, "utf8"), sha256, verified: true };
  }
  throw new Error("Local bridge command is not in the allowlist.");
}

function readCredentials(file: string): BridgeCredentials | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof value?.serverUrl !== "string" || typeof value?.deviceId !== "string" ||
        typeof value?.founderId !== "string" || typeof value?.token !== "string") return undefined;
    return value as BridgeCredentials;
  } catch { return undefined; }
}
function saveCredentials(file: string, credentials: BridgeCredentials): void {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = path.join(directory, `.device-bridge.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(credentials, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

export function startLocalDeviceBridge(): void {
  const serverUrl = process.env.MAYA_SERVER_URL || "";
  if (!serverUrl) throw new Error("Set MAYA_SERVER_URL to your Maya server URL.");
  const parsed = new URL(serverUrl);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
    throw new Error("Remote device bridge connections require HTTPS/WSS. HTTP is allowed only for localhost.");
  }
  const root = path.resolve(process.env.MAYA_WORKSPACE_ROOT || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("MAYA_WORKSPACE_ROOT must be an existing directory.");
  const credentialsFile = process.env.MAYA_DEVICE_CREDENTIAL_FILE || path.join(os.homedir(), ".maya", "device-bridge.json");
  let credentials = readCredentials(credentialsFile);
  const pairingCode = process.env.MAYA_PAIRING_CODE || "";
  if (!credentials && !pairingCode) throw new Error("Create a pairing code in Maya, then set MAYA_PAIRING_CODE for the first connection.");

  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let socket: WebSocket | undefined;
  let retryMs = 1000;
  const url = new URL("/api/device-bridge", parsed);
  url.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(url);
    socket.on("open", () => {
      retryMs = 1000;
      if (credentials) {
        socket?.send(JSON.stringify({ type: "authenticate", deviceId: credentials.deviceId, founderId: credentials.founderId, token: credentials.token }));
      } else {
        socket?.send(JSON.stringify({
          type: "pair", code: pairingCode,
          device: { name: os.hostname().slice(0, 100), platform: os.platform(), architecture: os.arch(), runtimeVersion: process.version },
        }));
      }
    });
    socket.on("message", async raw => {
      let message: any;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === "paired" && message.device?.id && message.token) {
        credentials = { serverUrl, deviceId: message.device.id, founderId: message.device.founderId, token: message.token };
        saveCredentials(credentialsFile, credentials);
        console.info(`Maya device paired: ${credentials.deviceId}. Token stored in the local user profile.`);
        return;
      }
      if (message.type === "authenticated") {
        console.info(`Maya device bridge connected: ${message.device?.name || credentials?.deviceId}`);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "heartbeat" }));
        }, 20_000);
        heartbeatTimer.unref?.();
        return;
      }
      if (message.type === "command" && typeof message.requestId === "string") {
        try {
          const result = await executeLocalBridgeCommand(root, String(message.command || ""), message.args || {});
          const payload = JSON.stringify({ type: "command_result", requestId: message.requestId, success: true, result });
          if (payload.length > 250_000) throw new Error("Local result exceeds the 250 KB bridge limit.");
          if (socket?.readyState === WebSocket.OPEN) socket.send(payload);
        } catch (error) {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
            type: "command_result", requestId: message.requestId, success: false,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          }));
        }
      }
    });
    socket.on("close", () => scheduleReconnect());
    socket.on("error", () => { try { socket?.close(); } catch {} });
  };

  const scheduleReconnect = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, retryMs);
    retryTimer.unref?.();
    retryMs = Math.min(30_000, retryMs * 2);
  };

  const shutdown = () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    socket?.close(1000, "Local bridge stopped");
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  connect();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { startLocalDeviceBridge(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
