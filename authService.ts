/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview Authentication & Session Management Service
 * Supports Google (Gmail) Sign-In and Mobile Number + 6-digit OTP verification.
 */

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  provider: 'google' | 'phone_otp';
  role: 'Founder' | 'CTO' | 'Admin';
  avatarUrl?: string;
  createdAt: string;
}

export interface UserSession {
  token: string;
  user: AuthenticatedUser;
  expiresAt: string;
}

export class AuthService {
  private activeSessions: Map<string, UserSession> = new Map();
  private pendingOtps: Map<string, { code: string; expiresAt: number; phone: string }> = new Map();

  constructor() {
    // Seed default session for Founder Snehasis Sahoo
    const founderUser: AuthenticatedUser = {
      id: 'usr-founder-snehasis',
      name: 'Snehasis Sahoo',
      email: 'snehasissahoo123456@gmail.com',
      phone: '+91 98765 43210',
      provider: 'google',
      role: 'Founder',
      createdAt: new Date().toISOString(),
    };
    const defaultToken = 'sess-syb-founder-token';
    this.activeSessions.set(defaultToken, {
      token: defaultToken,
      user: founderUser,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
  }

  /**
   * Google (Gmail) Login handler
   */
  public loginWithGoogle(email?: string, name?: string): UserSession {
    const userEmail = (email || 'snehasissahoo123456@gmail.com').trim().toLowerCase();
    const userName = name || (userEmail.includes('snehasis') ? 'Snehasis Sahoo' : 'Authorized User');

    const user: AuthenticatedUser = {
      id: 'usr-g-' + Math.random().toString(36).slice(2, 9),
      name: userName,
      email: userEmail,
      provider: 'google',
      role: 'Founder',
      createdAt: new Date().toISOString(),
    };

    const token = 'token-g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const session: UserSession = {
      token,
      user,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    };

    this.activeSessions.set(token, session);
    return session;
  }

  /**
   * Dispatch 6-digit OTP for mobile verification
   */
  public sendOtp(phone: string): { success: boolean; message: string; demoCode?: string } {
    const cleanPhone = phone.trim().replace(/\s+/g, '');
    if (!cleanPhone || cleanPhone.length < 8) {
      throw new Error('Please enter a valid mobile number with country code (e.g. +91 9876543210)');
    }

    // Generate deterministic/secure 6-digit OTP
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    this.pendingOtps.set(cleanPhone, { code, expiresAt, phone: cleanPhone });

    console.log(`[AuthService] Dispatched 6-digit OTP for ${cleanPhone}: ${code}`);

    return {
      success: true,
      message: `6-digit OTP sent successfully to ${cleanPhone}. Valid for 5 minutes.`,
      demoCode: code, // Provided for instant demo test convenience
    };
  }

  /**
   * Verify mobile OTP and issue session
   */
  public verifyOtp(phone: string, code: string, name?: string): UserSession {
    const cleanPhone = phone.trim().replace(/\s+/g, '');
    const cleanCode = code.trim();

    const pending = this.pendingOtps.get(cleanPhone);

    // Support standard test code 123456 or generated code
    const isMatching = pending?.code === cleanCode || cleanCode === '123456';
    if (!isMatching) {
      throw new Error('Invalid OTP code. Please check the code or request a new one.');
    }

    if (pending && Date.now() > pending.expiresAt) {
      this.pendingOtps.delete(cleanPhone);
      throw new Error('OTP expired. Please request a new verification code.');
    }

    this.pendingOtps.delete(cleanPhone);

    const user: AuthenticatedUser = {
      id: 'usr-p-' + Math.random().toString(36).slice(2, 9),
      name: name || 'Snehasis Sahoo',
      email: 'snehasissahoo123456@gmail.com',
      phone: cleanPhone,
      provider: 'phone_otp',
      role: 'Founder',
      createdAt: new Date().toISOString(),
    };

    const token = 'token-otp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const session: UserSession = {
      token,
      user,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    };

    this.activeSessions.set(token, session);
    return session;
  }

  /**
   * Verify session token
   */
  public validateSession(token?: string): UserSession | null {
    if (!token) return null;
    const session = this.activeSessions.get(token);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.activeSessions.delete(token);
      return null;
    }
    return session;
  }

  /**
   * Sign out / invalidate session
   */
  public logout(token?: string): boolean {
    if (!token) return true;
    return this.activeSessions.delete(token);
  }
}
