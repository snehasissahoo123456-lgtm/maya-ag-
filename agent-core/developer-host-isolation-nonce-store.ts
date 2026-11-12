import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const NONCE = /^[A-Za-z0-9_-]{32,128}$/;

export interface FileHostIsolationNonceStoreOptions {
  now?: () => number;
}

interface NonceRecord {
  version: 1;
  nonce: string;
  expiresAt: string;
  consumedAt: string;
}

/**
 * Single-host durable replay protection for signed isolation attestations.
 * Exclusive "wx" file creation is the cross-process atomicity boundary.
 * Records are retained after expiry so a consumed nonce is never reusable.
 * Multi-host deployments must use a transactional shared store instead.
 */
export class FileHostIsolationNonceStore {
  private readonly directory: string;
  private readonly now: () => number;

  constructor(directory: string, options: FileHostIsolationNonceStoreOptions = {}) {
    if (typeof directory !== "string" || !directory.trim()) throw new Error("A nonce-store directory is required.");
    this.directory = path.resolve(directory);
    this.now = options.now ?? Date.now;
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Host isolation nonce storage must be a regular non-symlink directory.");
    }
  }

  async consume(nonce: string, expiresAt: string): Promise<boolean> {
    if (typeof nonce !== "string" || !NONCE.test(nonce)) throw new Error("Host isolation nonce is invalid.");
    if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= this.now()) {
      throw new Error("Host isolation nonce expiry must be a valid future timestamp.");
    }
    const digest = createHash("sha256").update(nonce, "utf8").digest("hex");
    const filePath = path.join(this.directory, digest + ".json");
    const record: NonceRecord = {
      version: 1,
      nonce,
      expiresAt: new Date(Date.parse(expiresAt)).toISOString(),
      consumedAt: new Date(this.now()).toISOString(),
    };
    let fd: number;
    try {
      fd = fs.openSync(filePath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      fs.writeFileSync(fd, JSON.stringify(record), { encoding: "utf8" });
      fs.fsyncSync(fd);
    } catch (error) {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(filePath); } catch {}
      throw error;
    }
    fs.closeSync(fd);
    // Persist the directory entry as well as the file contents on POSIX hosts.
    // Windows does not support opening directories for fsync through this API.
    if (process.platform !== "win32") {
      const directoryFd = fs.openSync(this.directory, "r");
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    }
    return true;
  }
}
