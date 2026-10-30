# Implementation Plan: Fullscreen Secure Lock Screen (React + Tailwind CSS)

## Objective
Build a production-grade, cybernetic dark glassmorphism Fullscreen Secure Lock Screen using **React 19** and **Tailwind CSS v4**, seamlessly integrated with the existing **Action Engine v2.0 Cockpit**. The lock screen features dual-mode switching (React ⚛️ ⟷ Lit ⚡), 1-click verified Google/Gmail login for founder **Snehasis Sahoo** (`snehasissahoo123456@gmail.com`), and Indian Mobile SMS OTP verification with individual 6-box auto-focus inputs and 1-click test paste.

---

## Architecture & Integration Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Action Engine v2.0 Root Host                        │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 Dual-Mode View Selector                        │   │
│   │       [ ⚛️ React Mode (Active) ]   [ ⚡ Lit Mode ]             │   │
│   └────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                   │
│            ┌───────────────────────┴────────────────────────┐          │
│            ▼                                                ▼          │
│  ┌──────────────────────────────┐              ┌──────────────────┐    │
│  │ React Lock Screen Component  │              │ Lit Lock Screen  │    │
│  │ (Dark Glassmorphism + Glow)  │              │ (Original View)  │    │
│  │                              │              └──────────────────┘    │
│  │  • Gmail OAuth / 1-Click     │                                      │
│  │  • 6-Box Auto-Focus OTP      │                                      │
│  │  • 1-Click Test Code Paste   │                                      │
│  │  • Session State Management  │                                      │
│  └──────────────┬───────────────┘                                      │
│                 │ Validated Session Token                              │
│                 ▼                                                      │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │         Action Engine v2.0 Multimodal Founder Cockpit           │    │
│  │   • Voice / Audio Native Bridge  • Platform Probes (28/28)      │    │
│  │   • Corporate Ventures           • 21 Master Autonomous Tools   │    │
│  └────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Implementation Steps

### 1. Dependencies & Build Configuration
- Install React runtime & UI libraries:
  - `react`, `react-dom`, `lucide-react`
- Install developer dependencies & Vite plugins:
  - `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`
- Update `vite.config.ts`:
  - Add `react()` plugin from `@vitejs/plugin-react` alongside `@tailwindcss/vite`
  - Ensure JSX/TSX resolution works seamlessly alongside existing Lit web components.

### 2. React Lock Screen Component (`/src/components/ReactLockScreen.tsx`)
- **Cybernetic Glassmorphism Styling**:
  - Deep obsidian background with dual animated radial gradients (electric indigo `#6366f1` and cyan neon `#06b6d4`).
  - Frosted glass panel with `backdrop-blur-2xl`, subtle inset borders `border-white/10`, and reactive cursor lighting glow.
  - Founder badge: *Snehasis Sahoo (Founder & CEO, Shape Your Business)* with active status indicator.
- **Dual-Mode Toggle Header**:
  - Interactive switcher: `⚛️ React View` vs `⚡ Lit View`.
  - Persists preference in `localStorage.getItem('cockpit_auth_ui_mode')`.
- **Tab 1: Gmail Account Authentication**:
  - Fast 1-click founder button: pre-filled for `snehasissahoo123456@gmail.com` with official Google 'G' iconography.
  - Alternative email input for collaborators with email format validation.
  - Calls `/api/auth/google-login` and receives verified founder session token.
- **Tab 2: Mobile Number & 6-Box OTP**:
  - Indian telephone input with `+91` flag prefix and 10-digit validation.
  - Trigger "Send SMS OTP" calling `/api/auth/send-otp` with a 60-second cooldown countdown timer.
  - **6-Box Auto-Focus Input Grid**:
    - 6 individual styled digit squares with numeric keyboards (`inputMode="numeric"`).
    - Auto-advance on keystroke (`refs[i+1].focus()`).
    - Auto-rewind on Backspace (`refs[i-1].focus()`).
    - Clipboard paste handling: automatically splits pasted 6-digit codes (e.g. `123456`) across all 6 boxes.
    - Quick-fill helper button: `⚡ Paste Test Code (123456)` for instant 1-click founder verification.
  - Calls `/api/auth/verify-otp` with real-time feedback and cybernetic success animation.
- **Venture Corporations Badge Carousel**:
  - Mini tags for the 5 corporate categories: *AI Systems (ORBIT, RealTakes)*, *Fintech (Loan Ledger)*, *Voice (Nandi)*, *Media (Forge Your Frame)*, *Hospitality (Sahoo Group)*.

### 3. Dual-Mode Bridge & Integration (`/src/index.ts` & `/index.html`)
- Add mounting target `#react-auth-root` in `index.html`.
- Create clean bidirectional bridge in `index.ts`:
  - If user is not authenticated (`!this.isAuthenticated`):
    - Check view preference (`react` vs `lit`).
    - If `react`, render React Lock Screen into `#react-auth-root` using `createRoot`.
    - When authenticated, React component invokes `onAuthenticated(user, token)` callback which updates Lit app's `this.isAuthenticated = true` and `this.currentUser = user`, and unmounts the React root cleanly.
    - Allows user to switch between React and Lit lock screens at any time via the toggle.

### 4. Verification & Testing
- Compile TypeScript (`tsc --noEmit`) to verify 0 syntax or type errors.
- Run `npm run build` with Vite to ensure React + Lit + Tailwind v4 build cleanly into production bundle.
- Verify API interactions:
  - 1-Click Gmail login returns valid session.
  - Send OTP generates active code.
  - 6-box OTP entry and 1-click test code paste verify successfully.
  - Transition from Lock Screen into Action Engine Cockpit is instantaneous without page reload.

---

## Timeline & Deliverables
- **Estimated Completion**: ~1 turn upon approval.
- **Milestone Output**: Complete functional React Lock Screen with live dual-mode toggle, verified 0 build errors, and updated session synchronization.
