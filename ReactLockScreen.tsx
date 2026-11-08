/**
 * Maya Founder sign-in screen.
 *
 * Only the server-verified Founder password flow is exposed here. OAuth and SMS
 * sign-in remain hidden until real identity providers are configured.
 */
import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { AuthenticatedUser } from "./authService.ts";

interface ReactLockScreenProps {
  onAuthenticated: (user: AuthenticatedUser, token: string) => void;
  onSwitchToLit: () => void;
}

export const ReactLockScreen: React.FC<ReactLockScreenProps> = ({ onAuthenticated }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/auth/founder-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || !data.session?.user) {
        throw new Error(data.error || "Founder sign-in failed. Check your credentials and server configuration.");
      }

      // The bearer token is deliberately not returned to browser storage.
      // The server sets an HttpOnly session cookie and validates it on later requests.
      setPassword("");
      setNotice("Founder credentials verified. Opening Maya…");
      onAuthenticated(data.session.user as AuthenticatedUser, "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Founder sign-in failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#060a12] px-4 py-10 text-slate-100">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-indigo-600/20 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-48 -right-24 h-[32rem] w-[32rem] rounded-full bg-cyan-600/15 blur-[150px]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.035]" style={{
        backgroundImage: "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />

      <section className="relative z-10 w-full max-w-md">
        <header className="mb-7 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-400/30 bg-gradient-to-br from-indigo-500/25 to-cyan-500/20 text-xl font-black shadow-lg shadow-indigo-950/60">
            M
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Maya</h1>
            <p className="text-xs text-slate-400">Founder-controlled AI operator</p>
          </div>
        </header>

        <div className="rounded-[28px] border border-slate-700/70 bg-[#0d1322]/95 p-6 shadow-2xl shadow-black/50 backdrop-blur-2xl sm:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <div className="mb-2 flex items-center justify-center gap-2">
              <h2 className="text-2xl font-bold text-white">Founder sign in</h2>
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
            </div>
            <p className="text-sm leading-6 text-slate-400">
              Sign in to access your private Maya workspace.
            </p>
          </div>

          <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-700/70 bg-slate-950/70 p-3 text-xs leading-5 text-slate-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              This screen uses server-verified Founder credentials and an HttpOnly session cookie.
              Google and SMS sign-in are not enabled.
            </span>
          </div>

          {error && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-rose-700/70 bg-rose-950/50 p-3 text-sm text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-700/70 bg-emerald-950/40 p-3 text-sm text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          <form onSubmit={signIn} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="maya-founder-email" className="block text-xs font-semibold text-slate-300">
                Founder email
              </label>
              <input
                id="maya-founder-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={254}
                placeholder="Enter your configured Founder email"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="maya-founder-password" className="block text-xs font-semibold text-slate-300">
                Founder password
              </label>
              <input
                id="maya-founder-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                maxLength={1024}
                placeholder="Enter your password"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !email.trim() || !password}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-950/50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isLoading ? "Verifying credentials…" : "Open Maya"}
            </button>
          </form>

          <p className="mt-5 border-t border-slate-800 pt-4 text-center text-[11px] leading-5 text-slate-500">
            Session validation is performed by the Maya server. No password or bearer token is saved in browser local storage.
          </p>
        </div>

        <footer className="mt-5 text-center text-[11px] text-slate-500">
          Maya · Founder workspace · Development build
        </footer>
      </section>
    </main>
  );
};
