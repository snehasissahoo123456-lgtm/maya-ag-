import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface AuthenticatedUser {
  id: string; name: string; email: string; phone?: string;
  provider: "founder_password" | "google" | "phone_otp";
  role: "Founder" | "CTO" | "Admin"; avatarUrl?: string; createdAt: string;
}
export interface UserSession { token: string; user: AuthenticatedUser; expiresAt: string; }
interface StoredSession { tokenHash: string; user: AuthenticatedUser; expiresAt: string; }
interface StoredSessionFile { version: 1; updatedAt: string; sessions: StoredSession[]; }

/**
 * Single-Founder bootstrap auth. When a store path is supplied, only token hashes
 * are persisted. The JSON store is suitable for one server instance, not a
 * horizontally scaled deployment or a substitute for a transactional database.
 */
export class AuthService {
  private readonly activeSessions = new Map<string, UserSession>();
  private readonly sessionTtlMs = 12 * 60 * 60 * 1000;
  private readonly storePath?: string;

  constructor(storePath?: string) {
    this.storePath = storePath ? path.resolve(storePath) : undefined;
    if (this.storePath) this.loadSessions();
  }

  public loginWithFounderPassword(emailInput?: string, passwordInput?: string): UserSession {
    const expectedEmail = (process.env.MAYA_FOUNDER_EMAIL || "snehasissahoo123456@gmail.com").trim().toLowerCase();
    const expectedPassword = process.env.MAYA_FOUNDER_PASSWORD || "";
    if (expectedPassword.length < 16) throw new Error("Founder login is not configured. Set MAYA_FOUNDER_PASSWORD to a unique secret of at least 16 characters.");
    const emailMatches = (emailInput || "").trim().toLowerCase() === expectedEmail;
    const expected = Buffer.from(expectedPassword);
    const supplied = Buffer.from(passwordInput || "");
    const passwordMatches = expected.length === supplied.length && timingSafeEqual(expected, supplied);
    if (!emailMatches || !passwordMatches) throw new Error("Invalid Founder credentials.");
    const now = new Date();
    const user: AuthenticatedUser = { id: "founder-primary", name: "Founder", email: expectedEmail, provider: "founder_password", role: "Founder", createdAt: now.toISOString() };
    const token = randomBytes(32).toString("base64url");
    const session = { token, user, expiresAt: new Date(now.getTime() + this.sessionTtlMs).toISOString() };
    const key = this.hashToken(token);
    this.activeSessions.set(key, session);
    try { this.persistSessions(); }
    catch (error) { this.activeSessions.delete(key); throw error; }
    return session;
  }

  public loginWithGoogle(_email?: string, _name?: string): UserSession {
    throw new Error("Google sign-in is disabled: verified OAuth ID-token validation is not configured.");
  }
  public sendOtp(_phone: string): { success: boolean; message: string; demoCode?: string } {
    throw new Error("Phone sign-in is disabled: no trusted SMS delivery provider is configured.");
  }
  public verifyOtp(_phone: string, _code: string, _name?: string): UserSession {
    throw new Error("Phone sign-in is disabled: no trusted OTP delivery and verification provider is configured.");
  }

  public validateSession(token?: string): UserSession | null {
    if (!token) return null;
    const key = this.hashToken(token);
    const session = this.activeSessions.get(key);
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.activeSessions.delete(key);
      try { this.persistSessions(); } catch { /* Expired sessions remain invalid in memory; stale disk records expire again on reload. */ }
      return null;
    }
    return session;
  }

  public logout(token?: string): boolean {
    if (!token) return true;
    const key = this.hashToken(token);
    const session = this.activeSessions.get(key);
    if (!session) return false;
    this.activeSessions.delete(key);
    try { this.persistSessions(); }
    catch (error) { this.activeSessions.set(key, session); throw error; }
    return true;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  private loadSessions(): void {
    if (!this.storePath || !fs.existsSync(this.storePath)) return;
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(this.storePath, "utf8")); }
    catch { throw new Error("Session store is corrupt; refusing to overwrite it."); }
    if (!parsed || typeof parsed !== "object" || (parsed as StoredSessionFile).version !== 1 || !Array.isArray((parsed as StoredSessionFile).sessions)) {
      throw new Error("Session store has an unsupported or invalid format.");
    }
    for (const record of (parsed as StoredSessionFile).sessions) {
      if (!record || typeof record.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(record.tokenHash) ||
          !record.user || typeof record.user.id !== "string" || typeof record.user.email !== "string" ||
          record.user.role !== "Founder" || record.user.provider !== "founder_password" ||
          !Number.isFinite(Date.parse(record.expiresAt))) {
        throw new Error("Session store contains an invalid record.");
      }
      if (this.activeSessions.has(record.tokenHash)) throw new Error("Session store contains duplicate token hashes.");
      if (Date.parse(record.expiresAt) > Date.now()) {
        // The raw bearer token is deliberately not stored. It is reconstructed only
        // when the Founder presents it and its SHA-256 hash matches this key.
        this.activeSessions.set(record.tokenHash, {
          token: "", user: record.user, expiresAt: record.expiresAt,
        });
      }
    }
  }

  private persistSessions(): void {
    if (!this.storePath) return;
    const directory = path.dirname(this.storePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
    const sessions: StoredSession[] = [...this.activeSessions.entries()].map(([tokenHash, session]) => ({
      tokenHash, user: session.user, expiresAt: session.expiresAt,
    }));
    const state: StoredSessionFile = { version: 1, updatedAt: new Date().toISOString(), sessions };
    const tempPath = path.join(directory, `.sessions.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fs.renameSync(tempPath, this.storePath); }
    catch (error) { try { fs.rmSync(tempPath, { force: true }); } catch {} throw error; }
    try { fs.chmodSync(this.storePath, 0o600); } catch {}
  }
}
