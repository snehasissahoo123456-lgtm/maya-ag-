# Implementation Plan — Fullscreen Secure Authentication (Gmail & Mobile OTP), 5 Corporate Categories & Operating Systems Connection Probes

Implement a secure fullscreen authentication lock screen gating the Action Engine Cockpit (supporting Gmail Google Sign-In and Mobile OTP verification), categorize the entire ecosystem into 5 distinct corporate development tracks, and connect all operating systems and ventures with live real-time health probes integrated into the Diagnostic Test Sheet.

---

## 1. Core Architecture & User Decisions

- **Authentication Gate**: Fullscreen lock screen presented on app launch before opening Maya Cockpit:
  - **Method 1 (Gmail / Google)**: One-click sign-in with Google profile verification (`snehasissahoo123456@gmail.com`).
  - **Method 2 (Mobile Number + OTP)**: Mobile entry (`+91 ...`), 6-digit OTP delivery simulator with 30s resend timer, OTP verification, and session token generation.
  - **Persistent Session**: Session state cached in `localStorage` with quick sign-out button in the user profile area.
- **5 Corporate Development Categories**:
  1. **AI Systems & OS**: ORBIT AIOS, GRAVEN OS, Scanline, Adapt Planner
  2. **Fintech & Ledgers**: Loan Ledger, MANTRA
  3. **Voice & Conversational AI**: Nandi (Voice Agent), Krishna
  4. **Media & Content Creation**: RealTakes AI, Forge Your Frame
  5. **Hospitality & Enterprise Operations**: Sahoo Group of Hotels
- **Operating Systems & Platform Connections**:
  - Live probe server endpoints (`/api/platforms/probes`) measuring latency, status, and API handshakes for each connected platform.
  - Integration into the `🧪 Diagnostic Test Suite` tab with a dedicated 6th Test Suite: `Operating Systems & Ecosystem Platform Bridges` (expanding assertions from 22 to 28 passing live).
  - Real-time probe telemetry cards with latency metrics (ms) and connection states.

---

## 2. Proposed Implementation Details

### A. Authentication & Session Engine (`/server.ts` & `/authService.ts`)
- **Backend Auth Service (`/authService.ts`)**:
  - `POST /api/auth/google-login`: Validates user profile, issues session token, records audit log.
  - `POST /api/auth/send-otp`: Dispatches 6-digit OTP for provided mobile number, tracks expiration.
  - `POST /api/auth/verify-otp`: Validates OTP code, issues authenticated session token.
  - `GET /api/auth/session`: Validates current session token.
  - `POST /api/auth/logout`: Clears session.
- **Platform Probes API (`/server.ts`)**:
  - `GET /api/platforms/probes`: Pings each venture OS/platform, returning live status, response time (ms), and capability metadata.

### B. Corporate Categories & Test Suite Expansion (`/actionEngineCore.ts`)
- **Category Refactoring**:
  - Update `SYBVenture` and `SYB_VENTURES` with explicit corporate categories:
    `'AI Systems & OS' | 'Fintech & Ledgers' | 'Voice & Conversational AI' | 'Media & Production' | 'Hospitality & Enterprise'`
- **Test Suite 6: Connected Operating Systems & Platform Bridges**:
  - Assertion 1: ORBIT AIOS Autonomous Runtime Bridge
  - Assertion 2: GRAVEN OS Kernel & Sandboxed Filesystem
  - Assertion 3: Nandi Voice Agent Multi-Turn Pipeline
  - Assertion 4: RealTakes AI Media Processing Handshake
  - Assertion 5: Loan Ledger Distributed Ledger & Accounting Probe
  - Assertion 6: Sahoo Group Hospitality ERP & Booking Sync

### C. Frontend UI & UX Components (`/index.ts`)
- **Fullscreen Authentication Lock Screen**:
  - Minimal dark container (`bg-[#070a12]`) featuring SYB corporate branding, security lock badge, and animated background glow.
  - Mode toggle: `Continue with Google (Gmail)` or `Sign in with Mobile Phone & OTP`.
  - Number input with country selector (`+91 India`), animated OTP inputs, countdown timer, and secure verification.
  - Founder prefill option for instantaneous testing.
- **Corporate Category Filter & Workspace Switcher**:
  - Top category filter tabs in sidebar and ecosystem tab to easily navigate between the 5 corporate sectors.
- **Connected Platforms Probe Dashboard**:
  - Dedicated interactive matrix in both the Right Persistent Panel and the Diagnostic Test Sheet displaying real-time ping latency, connection state, and live test execution buttons.
- **Profile & Logout Drawer**:
  - Displays authenticated user badge (e.g., `Snehasis Sahoo • snehasissahoo123456@gmail.com`) with instant lock/logout button.

---

## 3. Verification Plan

1. **Compilation & Linting**:
   - Run `compile_applet` and `lint_applet` (`tsc --noEmit`) to ensure zero errors and zero warnings.
2. **Authentication Flow Verification**:
   - Verify lock screen blocks the cockpit until login.
   - Test Gmail Google sign-in flow.
   - Test Mobile number OTP generation and verification flow.
   - Test session persistence across page reload and Sign Out functionality.
3. **5 Corporate Categories & Platforms Verification**:
   - Confirm all 9 ventures are categorized across the 5 corporate tracks.
   - Verify `GET /api/platforms/probes` responds with live probe health for each operating system.
4. **Diagnostic Test Suite Audit**:
   - Verify all 28 assertions across all 6 test suites pass with a 100% health score.
