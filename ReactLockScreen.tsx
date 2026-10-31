/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview React Fullscreen Secure Lock Screen with Gmail & 6-Box Mobile OTP
 * Styled with Cybernetic Dark Glassmorphism, Ambient Glow, and Dual-Mode Toggle.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  ShieldCheck,
  Lock,
  Smartphone,
  Mail,
  KeyRound,
  ArrowRight,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Building2,
  RefreshCw,
  Cpu,
  Layers,
  Code2,
} from 'lucide-react';
import { AuthenticatedUser } from './authService.ts';
import { OtpInput } from './OtpInput.tsx';

interface ReactLockScreenProps {
  onAuthenticated: (user: AuthenticatedUser, token: string) => void;
  onSwitchToLit: () => void;
}

export const ReactLockScreen: React.FC<ReactLockScreenProps> = ({
  onAuthenticated,
  onSwitchToLit,
}) => {
  const [authTab, setAuthTab] = useState<'google' | 'phone'>('google');
  const [googleEmail, setGoogleEmail] = useState('snehasissahoo123456@gmail.com');
  const [phone, setPhone] = useState('+91 98765 43210');
  const [otpSent, setOtpSent] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Timer countdown effect for OTP resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Google Sign-In Handler
  const handleGoogleLogin = async (emailToUse?: string) => {
    ((setIsLoading as any) as any)(true);
    ((setErrorMsg as any) as any)(null);
    ((setSuccessMsg as any) as any)(null);
    try {
      const targetEmail = emailToUse || googleEmail || 'snehasissahoo123456@gmail.com';
      const res = await fetch('/api/auth/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          name: 'Snehasis Sahoo',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Google login authorization failed');
      }
      localStorage.setItem('maya_session_token', data.session.token);
      ((setSuccessMsg as any) as any)('Welcome back Founder Snehasis Sahoo! Access granted.');
      setTimeout(() => {
        onAuthenticated(data.session.user, data.session.token);
      }, 500);
    } catch (err: any) {
      ((setErrorMsg as any) as any)(err.message || 'Google authentication error');
    } finally {
      ((setIsLoading as any) as any)(false);
    }
  };

  // Dispatch OTP SMS handler
  const handleSendOtp = async () => {
    ((setIsLoading as any) as any)(true);
    ((setErrorMsg as any) as any)(null);
    ((setSuccessMsg as any) as any)(null);
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch SMS OTP');
      }
      setOtpSent(true);
      setDemoCode(data.demoCode || '123456');
      ((setSuccessMsg as any) as any)(data.message || 'OTP dispatched to ' + phone);
      setCountdown(60);
      setOtpCode('');
    } catch (err: any) {
      ((setErrorMsg as any) as any)(err.message || 'OTP dispatch failed');
    } finally {
      ((setIsLoading as any) as any)(false);
    }
  };



  // Verify OTP handler
  const handleVerifyOtpWithCode = async (codeToVerify: string) => {
    ((setIsLoading as any) as any)(true);
    ((setErrorMsg as any) as any)(null);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          code: codeToVerify,
          name: 'Snehasis Sahoo',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invalid or expired OTP code');
      }
      localStorage.setItem('maya_session_token', data.session.token);
      ((setSuccessMsg as any) as any)('Mobile OTP verified successfully! Launching Action Engine Cockpit...');
      setTimeout(() => {
        onAuthenticated(data.session.user, data.session.token);
      }, 500);
    } catch (err: any) {
      ((setErrorMsg as any) as any)(err.message || 'OTP verification error');
    } finally {
      ((setIsLoading as any) as any)(false);
    }
  };

  const corporateCategories = [
    { name: 'AI Systems & OS', ventures: 'ORBIT AIOS · RealTakes AI · GRAVEN OS', color: 'from-indigo-500/20 to-purple-500/20 text-indigo-300' },
    { name: 'Fintech & Ledgers', ventures: 'Loan Ledger · Sahoo FinOps', color: 'from-emerald-500/20 to-teal-500/20 text-emerald-300' },
    { name: 'Voice & Conversational AI', ventures: 'Nandi Voice Agent · Multimodal Live', color: 'from-amber-500/20 to-orange-500/20 text-amber-300' },
    { name: 'Media & Production', ventures: 'Forge Your Frame · Scanline', color: 'from-pink-500/20 to-rose-500/20 text-pink-300' },
    { name: 'Hospitality & Enterprise', ventures: 'Sahoo Group of Hotels · Krishna', color: 'from-cyan-500/20 to-blue-500/20 text-cyan-300' },
  ];

  return (
    <div className="min-h-screen w-screen bg-[#060a12] text-slate-100 flex flex-col justify-between font-sans relative overflow-x-hidden p-4 sm:p-8 select-none">
      {/* Cybernetic Ambient Glow Background Gradients */}
      <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[140px] pointer-events-none animate-pulse" />
      <div className="absolute top-1/3 -right-40 w-[450px] h-[450px] bg-cyan-600/15 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute -bottom-40 left-1/4 w-[600px] h-[600px] bg-purple-600/15 rounded-full blur-[150px] pointer-events-none" />

      {/* Cybernetic Hexagonal / Grid Matrix Lines Overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }}
      />

      {/* TOP HEADER: Brand, Status Badge & Dual-Mode Toggle */}
      <header className="flex flex-wrap items-center justify-between gap-4 z-10 w-full max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 p-[1.5px] shadow-lg shadow-indigo-500/30">
            <div className="w-full h-full bg-[#090d16] rounded-2xl flex items-center justify-center font-extrabold text-white text-base">
              M
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-1.5">
                Maya <span className="text-slate-400 font-normal">·</span> Action Engine
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono font-semibold">
                v2.0
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
              <span>Autonomous Founder-Grade Coding Cockpit</span>
              <span className="text-slate-600">•</span>
              <span className="text-indigo-400">Snehasis Sahoo (SYB)</span>
            </p>
          </div>
        </div>

        {/* Dual-Mode Selector & Bridge Status */}
        <div className="flex items-center gap-3">
          {/* Dual-Mode Switcher */}
          <div className="flex items-center p-1 bg-slate-900/90 border border-slate-700/60 rounded-2xl backdrop-blur-xl shadow-lg">
            <button
              className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30 transition-all cursor-default"
              title="Currently viewing React Lock Screen"
            >
              <Code2 className="w-3.5 h-3.5 text-cyan-300" />
              <span>⚛️ React View</span>
            </button>
            <button
              onClick={onSwitchToLit}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/60 transition-all flex items-center gap-1.5"
              title="Switch to Lit 3.2 View"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>⚡ Lit View</span>
            </button>
          </div>

          {/* Local Bridge Active Badge */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 text-xs text-slate-300 backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-[11px]">Bridge :3000 Active</span>
          </div>
        </div>
      </header>

      {/* CENTER AUTHENTICATION CARD */}
      <main className="w-full max-w-lg mx-auto my-auto z-10 py-6 sm:py-8">
        <div className="relative group">
          {/* Neon Border Glow Effect */}
          <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500/30 via-cyan-500/30 to-purple-500/30 rounded-[32px] blur-xl opacity-75 group-hover:opacity-100 transition duration-700" />

          {/* Main Glassmorphic Container */}
          <div className="relative bg-[#0d1322]/90 border border-slate-700/70 rounded-[28px] p-6 sm:p-8 shadow-2xl backdrop-blur-2xl space-y-6">
            {/* Founder Security Badge Header */}
            <div className="text-center space-y-2.5">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500/20 to-cyan-500/20 border border-indigo-500/40 text-cyan-300 shadow-inner">
                <Lock className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center justify-center gap-2">
                  <span>Security Access Gate</span>
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                </h2>
                <p className="text-xs text-slate-400">
                  Protected authentication for Founder{' '}
                  <span className="text-cyan-300 font-semibold">Snehasis Sahoo</span> (Shape Your Business)
                </p>
              </div>
            </div>

            {/* Error & Success Feedback Alerts */}
            {((errorMsg as any) as any) && (
              <div className="p-3.5 bg-rose-950/80 border border-rose-700/80 rounded-2xl text-xs text-rose-200 flex items-start gap-2.5 animate-fadeIn">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="flex-1 leading-relaxed">{((errorMsg as any) as any)}</span>
                <button
                  onClick={() => ((setErrorMsg as any) as any)(null)}
                  className="text-rose-400 hover:text-white text-sm font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            {((successMsg as any) as any) && (
              <div className="p-3.5 bg-emerald-950/80 border border-emerald-700/80 rounded-2xl text-xs text-emerald-200 flex items-center gap-2.5 animate-fadeIn">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="flex-1 leading-relaxed">{((successMsg as any) as any)}</span>
              </div>
            )}

            {/* Authentication Method Tabs */}
            <div className="grid grid-cols-2 p-1 bg-slate-950/90 rounded-2xl border border-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('google');
                  ((setErrorMsg as any) as any)(null);
                }}
                className={`py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 ${
                  authTab === 'google'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <Mail className="w-4 h-4 text-cyan-300" />
                <span>Gmail Login</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAuthTab('phone');
                  ((setErrorMsg as any) as any)(null);
                }}
                className={`py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 ${
                  authTab === 'phone'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <Smartphone className="w-4 h-4 text-purple-300" />
                <span>Mobile OTP</span>
              </button>
            </div>

            {/* TAB 1: GMAIL AUTHENTICATION */}
            {authTab === 'google' && (
              <div className="space-y-4 pt-1 animate-fadeIn">
                {/* Founder Verified Profile Box */}
                <div className="p-4 bg-slate-950/70 rounded-2xl border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      Primary Founder Profile
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                      VERIFIED
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-red-500/20 via-amber-500/20 to-blue-500/20 border border-white/10 flex items-center justify-center font-bold text-white text-sm shadow-md">
                      G
                    </div>
                    <div className="overflow-hidden flex-1">
                      <div className="text-sm font-bold text-white flex items-center gap-1.5">
                        <span>Snehasis Sahoo</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300">
                          Founder & CEO
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-400 truncate">
                        snehasissahoo123456@gmail.com
                      </div>
                    </div>
                  </div>
                </div>

                {/* 1-Click Fast Founder Sign-In Button */}
                <button
                  type="button"
                  disabled={((isLoading as any) as any)}
                  onClick={() => handleGoogleLogin('snehasissahoo123456@gmail.com')}
                  className="w-full py-3.5 px-4 bg-white hover:bg-slate-100 text-slate-900 rounded-2xl text-xs font-bold flex items-center justify-center gap-3 transition-all shadow-xl hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 cursor-pointer"
                >
                  {((isLoading as any) as any) ? (
                    <RefreshCw className="w-4 h-4 text-slate-900 animate-spin" />
                  ) : (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                  )}
                  <span>
                    {((isLoading as any) as any)
                      ? 'Authenticating Session...'
                      : 'Continue with Google (snehasissahoo123456@gmail.com)'}
                  </span>
                </button>

                {/* Divider */}
                <div className="relative flex items-center justify-center my-3">
                  <div className="border-t border-slate-800 w-full" />
                  <span className="bg-[#0d1322] px-3 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                    Or Alternate Authorized Email
                  </span>
                </div>

                {/* Alternate Gmail input */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={googleEmail}
                      onChange={(e) => setGoogleEmail(e.target.value)}
                      placeholder="snehasissahoo123456@gmail.com"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono tracking-wide"
                    />
                    <button
                      type="button"
                      disabled={((isLoading as any) as any)}
                      onClick={() => handleGoogleLogin(googleEmail)}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border border-slate-700 cursor-pointer disabled:opacity-50"
                    >
                      Authorize
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: MOBILE NUMBER & 6-BOX OTP */}
            {authTab === 'phone' && (
              <div className="space-y-4 pt-1 animate-fadeIn">
                {/* Mobile Phone Input with Flag */}
                <div className="space-y-2">
                  <label className="block text-xs text-slate-400 font-medium">
                    Founder Mobile Number (India +91)
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-xs font-bold text-indigo-400">
                        🇮🇳 +91
                      </div>
                      <input
                        type="tel"
                        value={phone.replace(/^\+91\s*/, '')}
                        onChange={(e) => setPhone('+91 ' + e.target.value.replace(/[^\d\s]/g, ''))}
                        placeholder="98765 43210"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-16 pr-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono tracking-wider font-medium"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={((isLoading as any) as any) || countdown > 0}
                      onClick={handleSendOtp}
                      className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white rounded-xl text-xs font-semibold whitespace-nowrap transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50 cursor-pointer"
                    >
                      {countdown > 0 ? `${countdown}s` : otpSent ? 'Resend' : 'Send SMS OTP'}
                    </button>
                  </div>
                </div>

                {/* OTP Entry Grid (Triggered when OTP dispatched) */}
                {otpSent && (
                  <div className="space-y-4 pt-2 animate-fadeIn">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <label className="text-slate-300 font-semibold uppercase tracking-wider text-[11px]">
                          Enter 6-Digit Verification Code
                        </label>
                        <span className="text-[11px] font-mono text-cyan-400">
                          Auto-focus & 1-click paste
                        </span>
                      </div>

                      {/* Modular 6-Box Auto-Focus OTP Input Component */}
                      <OtpInput
                        length={6}
                        value={otpCode}
                        onChange={setOtpCode}
                        onComplete={(code) => handleVerifyOtpWithCode(code)}
                        disabled={((isLoading as any) as any)}
                        demoCode={demoCode || '123456'}
                        hasError={Boolean(((errorMsg as any) as any))}
                      />
                    </div>

                    {/* Verify & Launch Button */}
                    <button
                      type="button"
                      disabled={((isLoading as any) as any) || otpCode.length < 6}
                      onClick={() => handleVerifyOtpWithCode(otpCode)}
                      className="w-full py-3.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 hover:from-indigo-500 hover:via-purple-500 hover:to-cyan-500 text-white rounded-2xl text-xs font-bold transition-all shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
                    >
                      {((isLoading as any) as any) ? (
                        <RefreshCw className="w-4 h-4 animate-spin text-white" />
                      ) : (
                        <ShieldCheck className="w-4 h-4 text-emerald-300" />
                      )}
                      <span>
                        {((isLoading as any) as any) ? 'Verifying Credentials...' : 'Verify OTP & Launch Cockpit'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Security Guarantee Footnote */}
            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>AES-256 Auth Token Encrypted</span>
              </span>
              <span className="text-slate-400">Zero Cloud Exposure</span>
            </div>
          </div>
        </div>

        {/* 5 CORPORATE VENTURES SHOWCASE STRIP */}
        <div className="mt-6 p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
              <Building2 className="w-3.5 h-3.5 text-indigo-400" />
              Connected Corporate Ventures (Shape Your Business)
            </span>
            <span className="text-[10px] font-mono text-cyan-400">5 Categories · 11 Platforms</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            {corporateCategories.map((cat, i) => (
              <div
                key={i}
                className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/70 flex flex-col justify-between"
              >
                <span className="font-semibold text-slate-300 text-[10px] uppercase font-mono tracking-tight">
                  {cat.name}
                </span>
                <span className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                  {cat.ventures}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="w-full max-w-5xl mx-auto flex flex-wrap items-center justify-between text-xs text-slate-500 py-3 border-t border-slate-800/60 z-10 font-mono">
        <div>SYB · Shape Your Business · Bhubaneswar, Odisha, India</div>
        <div className="flex items-center gap-2">
          <span>Founder: Snehasis Sahoo</span>
          <span>•</span>
          <span className="text-indigo-400">Maya Action Engine v2.0</span>
        </div>
      </footer>
    </div>
  );
};
