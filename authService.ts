import { randomBytes, timingSafeEqual } from "node:crypto";
export interface AuthenticatedUser {
  id: string; name: string; email: string; phone?: string;
  provider: "founder_password" | "google" | "phone_otp";
  role: "Founder" | "CTO" | "Admin"; avatarUrl?: string; createdAt: string;
}
export interface UserSession { token: string; user: AuthenticatedUser; expiresAt: string; }

/** Single-Founder bootstrap auth. Configure secrets in the deployment environment, never in Git. */
export class AuthService {
  private readonly activeSessions = new Map<string, UserSession>();
  private readonly sessionTtlMs = 12 * 60 * 60 * 1000;

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
    this.activeSessions.set(token, session);
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
    const session = this.activeSessions.get(token);
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) { this.activeSessions.delete(token); return null; }
    return session;
  }
  public logout(token?: string): boolean { return token ? this.activeSessions.delete(token) : true; }
}
