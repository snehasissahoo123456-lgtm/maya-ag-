# Implementation Plan — Real-Time File-Watcher & Automated Build Hook

Implement an instant file-watching service in the backend that captures file modifications across the repository (excluding `dist/`, `node_modules/`, and `.git/`), runs typecheck and build diagnostics, parses compiler stdout/stderr, and streams live updates over WebSocket to the Cockpit's `🧪 Diagnostic Test Suite` dashboard in real time.

---

## 1. Architecture & Real-Time Flow

```
[ File Saved / Modified ]
       │
       ▼
[ Node.js File Watcher in server.ts ] (ignores node_modules, dist, .git, .temp)
       │
       ├─► Broadcasts status: { type: 'build_status', status: 'building', timestamp }
       │
       ▼
[ Child Process Execution: npm run build / tsc --noEmit ]
       │
       ├─► Real-time stdout / stderr stream parser
       │   - TypeScript diagnostics: file, line, col, code (TSxxxx), message, severity
       │   - Vite build metrics: chunk sizes, bundle time, transform warnings
       │   - Test assertion verification: passes, failures, health index
       │
       ▼
[ WebSocket Broadcast (/api/live-ws & client connections) ]
       │
       ▼
[ Action Engine Cockpit (index.ts - Lit 3.2) ]
       ├─► Live Watcher Status Indicator (Active / Building / Idle / Error)
       ├─► Real-time Console Log Drawer (Live stdout/stderr stream)
       ├─► Dynamic Test Suite Assertions updated with zero page reload
       └─► Sound / Visual Tone Pulse based on Selected Maya Persona
```

---

## 2. Proposed Changes

### Backend (`/server.ts`)
- **File Watcher Service**:
  - Implement a recursive directory watcher using Node.js `fs.watch` with guard filters ignoring:
    - `node_modules/**`, `dist/**`, `.git/**`, `.temp/**`, `*.log`, `*.map`, `coverage/**`
  - Maintain a non-blocking execution queue with a micro-coalescer (preventing OS double-firing while honoring instant trigger).
  - Execute diagnostics via `child_process.spawn('npm', ['run', 'build'])` or `child_process.exec`.
- **Live Output Parser & Diagnostic Analyzer**:
  - Parse compiler output line-by-line for TypeScript diagnostics (`TS\d+`), Vite warnings, and syntax errors.
  - Dynamically map any compiler errors directly into the diagnostic `TestSuite` assertions with severity (`CRITICAL`, `HIGH`, `MEDIUM`, `INFO`).
- **WebSocket Broadcast Integration**:
  - Broadcast payload to all connected frontend clients:
    - `build_status`: `'idle' | 'building' | 'passed' | 'failed'`
    - `build_output`: Incremental chunks + full log
    - `build_metrics`: Duration, timestamp, files modified
    - `test_suites`: Updated live assertions reflecting current codebase health.
- **REST Fallback / Control Endpoints**:
  - `GET /api/action-engine/watcher/status`: Return watcher active state and last build timestamp.
  - `POST /api/action-engine/watcher/toggle`: Enable/disable watch mode on demand.
  - `POST /api/action-engine/watcher/trigger`: Force manual trigger from UI.

### Frontend (`/index.ts`)
- **WebSocket Listener Expansion**:
  - Intercept `build_status`, `build_chunk`, and `test_update` events in the existing WebSocket client.
- **Cockpit UI Enhancements in `🧪 Diagnostic Test Suite` Tab**:
  - **Live Watcher Header Pill**: Indicates `Watcher: Active` with glowing emerald pulse when idle, amber spinning pulse when compiling, and ruby badge when errors are caught.
  - **Live Build Console Drawer**: Collapsible real-time terminal stream displaying compiler stdout/stderr lines with syntax coloring.
  - **Reactive Test Assertion Re-render**: Updates test suite cards, pass rates, and health index live without browser refresh.
  - **Tone Voice / Audio Feedback**: Plays Maya's discrete audio tone or notification badge when build succeeds or fails.

---

## 3. Verification Plan

1. **Compilation & Linting**:
   - Run `compile_applet` and `lint_applet` to ensure zero TypeScript errors and zero lint warnings.
2. **File Watch Trigger Verification**:
   - Touch/edit a test file and verify in console logs that the watcher triggers immediately.
   - Verify that ignoring rules prevent cyclic loops when `dist/` or build artifacts update.
3. **Live UI Real-Time Updates**:
   - Confirm WebSocket message transmission from server to Lit frontend.
   - Verify that modifying code dynamically updates the Test Runner tab cards, health score, and console drawer.
4. **Zero-Warning Compliance**:
   - Confirm builds complete with zero warnings, satisfying SYB founder standards.
