/**
 * Passive workspace change monitor.
 *
 * This service never executes build/test commands and never edits source files.
 * Validation is requested through the authenticated, Founder-approval-gated
 * task control plane.
 */
import fs from "fs";
import { WebSocket } from "ws";
import type {
  TestSuite,
  BuildLogEntry,
  BuildEventMessage,
  WatcherStatus,
  AutoFixRecord,
} from "./actionEngineCore.ts";

export class WatcherService {
  private watcherActive = true;
  private lastBuildTime: string | null = null;
  private lastDurationMs = 0;
  private lastModifiedFile: string | null = null;
  private totalTriggers = 0;
  private lastBuildStatus: "idle" | "building" | "passed" | "failed" = "idle";
  private recentBuildLogs: BuildLogEntry[] = [{
    id: "init-file-monitor",
    text: "[Workspace Monitor] Passive file monitoring initialized. Automatic builds and source edits are disabled; validation requires Founder approval.",
    stream: "system",
    timestamp: new Date().toISOString(),
  }];
  private readonly recentAutoFixes: AutoFixRecord[] = [];
  private connectedWsClients: Set<WebSocket> = new Set();
  private getTestSuites: () => TestSuite[];
  private onAuditLog?: (record: any) => void;
  private fsWatcher: fs.FSWatcher | null = null;

  constructor(options: {
    getTestSuites: () => TestSuite[];
    onTestSuitesUpdated?: (suites: TestSuite[]) => void;
    onAuditLog?: (record: any) => void;
  }) {
    this.getTestSuites = options.getTestSuites;
    this.onAuditLog = options.onAuditLog;
  }

  public registerClient(ws: WebSocket) {
    this.connectedWsClients.add(ws);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "build_status",
        status: this.lastBuildStatus,
        file: this.lastModifiedFile,
        durationMs: this.lastDurationMs,
        suites: this.getTestSuites(),
        data: "Passive file monitor only. Queue validation through the Developer workspace for Founder approval.",
        timestamp: this.lastBuildTime,
      }));
    }
  }

  public unregisterClient(ws: WebSocket) {
    this.connectedWsClients.delete(ws);
  }

  public broadcast(event: BuildEventMessage) {
    const payload = JSON.stringify(event);
    for (const ws of this.connectedWsClients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try { ws.send(payload); } catch {}
    }
  }

  public getStatus(): WatcherStatus {
    return {
      active: this.watcherActive,
      isBuilding: false,
      lastBuildTime: this.lastBuildTime,
      lastDurationMs: this.lastDurationMs,
      lastModifiedFile: this.lastModifiedFile,
      totalTriggers: this.totalTriggers,
      lastStatus: this.lastBuildStatus,
      buildLogs: this.recentBuildLogs.slice(-100),
      recentAutoFixes: this.recentAutoFixes.slice(-20),
    };
  }

  public toggleWatcher(active?: boolean): boolean {
    this.watcherActive = typeof active === "boolean" ? active : !this.watcherActive;
    const message = `Passive workspace monitor ${this.watcherActive ? "activated" : "paused"}; no commands or source edits will run automatically.`;
    this.appendLog(message);
    this.broadcast({
      type: "build_status",
      status: "idle",
      data: message,
      timestamp: new Date().toISOString(),
    });
    return this.watcherActive;
  }

  public recordValidationRequested(taskId: string, triggerFile?: string) {
    this.totalTriggers++;
    this.lastModifiedFile = triggerFile || this.lastModifiedFile;
    const timestamp = new Date().toISOString();
    const message = `Validation task ${taskId} queued. No commands executed; a Founder must approve the task before the fixed validation suite can run.`;
    this.appendLog(message);
    this.broadcast({
      type: "build_status",
      status: "idle",
      file: this.lastModifiedFile || undefined,
      data: message,
      timestamp,
    });
    this.onAuditLog?.({
      id: "validation-request-" + taskId,
      toolName: "validation.task_queued",
      params: { taskId, triggerFile: this.lastModifiedFile },
      status: "success",
      result: { queued: true, requiresFounderApproval: true, executed: false },
      timestamp,
      durationMs: 0,
    });
  }

  /**
   * Legacy callers are deliberately prevented from executing commands.
   * The authenticated HTTP route queues a workspace.run_validation task instead.
   */
  public async runDiagnostics(triggerFile?: string): Promise<{
    success: boolean;
    durationMs: number;
    errorCount: number;
    warningCount: number;
    output: string;
  }> {
    const message = "Direct diagnostics execution is disabled. Queue the fixed validation suite in the Developer workspace; Founder approval is required.";
    this.appendLog(message);
    this.broadcast({
      type: "build_status",
      status: "idle",
      file: triggerFile,
      data: message,
      timestamp: new Date().toISOString(),
    });
    return { success: false, durationMs: 0, errorCount: 0, warningCount: 0, output: message };
  }

  private appendLog(message: string) {
    this.recentBuildLogs.push({
      id: "monitor-" + Date.now().toString(36),
      text: message,
      stream: "system",
      timestamp: new Date().toISOString(),
    });
    if (this.recentBuildLogs.length > 300) this.recentBuildLogs.shift();
  }

  private recordFileChange(file: string, eventType: string) {
    this.totalTriggers++;
    this.lastModifiedFile = file;
    const message = `File change observed (${eventType}): ${file}. No build, test command or auto-fix was executed. Use the Developer workspace to request Founder-approved validation.`;
    this.appendLog(message);
    this.broadcast({
      type: "build_status",
      status: "idle",
      file,
      data: message,
      timestamp: new Date().toISOString(),
    });
  }

  public start() {
    if (this.fsWatcher) return;
    try {
      this.fsWatcher = fs.watch(process.cwd(), { recursive: true }, (eventType, filename) => {
        if (!this.watcherActive || !filename) return;
        const cleanPath = String(filename).replace(/\\/g, "/");
        const ignored = [
          "dist/", "node_modules/", ".git/", ".aistudio/", ".temp/",
          ".maya-data/", "coverage/", ".next/", ".vite/",
        ];
        if (ignored.some(prefix => cleanPath.startsWith(prefix)) ||
            cleanPath.endsWith(".map") || cleanPath.endsWith(".log") ||
            cleanPath === "bun.lock" || cleanPath.includes(".DS_Store") ||
            cleanPath.endsWith("~") || cleanPath.endsWith(".tmp")) return;
        this.recordFileChange(cleanPath, eventType);
      });
      this.fsWatcher.on("error", error => {
        console.warn("[Workspace Monitor] File watcher error:", error);
        this.appendLog("Workspace monitor error: " + error.message);
      });
      console.log("[Workspace Monitor] Passive monitoring active; automatic build and auto-fix are disabled.");
    } catch (error) {
      console.warn("[Workspace Monitor] Failed to initialize fs.watch:", error);
    }
  }

  public stop() {
    if (!this.fsWatcher) return;
    this.fsWatcher.close();
    this.fsWatcher = null;
  }
}
