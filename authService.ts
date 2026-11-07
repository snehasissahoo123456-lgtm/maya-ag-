/**
 * Authentication is deliberately fail-closed until real identity providers are configured.
 * Never trust an email/name supplied by the browser and never issue demo sessions or OTPs.
 */
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  provider: "google" | "phone_otp";
  role: "Founder" | "CTO" | "Admin";
  avatarUrl?: string;
  createdAt: string;
}

export interface UserSession {
  token: string;
  user: AuthenticatedUser;
  expiresAt: string;
}

export class AuthService {
  private readonly activeSessions = new Map<string, UserSession>();

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
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.activeSessions.delete(token);
      return null;
    }
    return session;
  }

  public logout(token?: string): boolean {
    if (!token) return true;
    return this.activeSessions.delete(token);
  }
}
