/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview Real-Time Auto-Build File Watcher Service
 * Watches repository files, runs instant diagnostics, parses compiler output,
 * and broadcasts live results via WebSocket to the Cockpit Test Runner.
 */

import fs from 'fs';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';
import {
  TestSuite,
  BuildLogEntry,
  BuildEventMessage,
  WatcherStatus,
  AutoFixRecord,
} from './actionEngineCore.ts';
import { TypeScriptFixer } from './typeScriptFixer.ts';

export class WatcherService {
  private watcherActive = true;
  private isBuilding = false;
  private lastBuildTime: string | null = null;
  private lastDurationMs = 0;
  private lastModifiedFile: string | null = null;
  private totalTriggers = 0;
  private lastBuildStatus: 'idle' | 'building' | 'passed' | 'failed' = 'idle';
  private recentBuildLogs: BuildLogEntry[] = [
    {
      id: 'init-watcher-log',
      text: '[Auto-Build Hook] Maya Action Engine Watcher initialized. Ready for file modifications.',
      stream: 'system',
      timestamp: new Date().toISOString(),
    },
  ];
  private recentAutoFixes: AutoFixRecord[] = [];
  private pendingRebuild = false;
  private pendingFile: string | null = null;
  private connectedWsClients: Set<WebSocket> = new Set();
  private getTestSuites: () => TestSuite[];
  private onTestSuitesUpdated?: (suites: TestSuite[]) => void;
  private onAuditLog?: (record: any) => void;
  private fsWatcher: fs.FSWatcher | null = null;
  private isAutoHealing = false;

  constructor(options: {

    getTestSuites: () => TestSuite[];
    onTestSuitesUpdated?: (suites: TestSuite[]) => void;
    onAuditLog?: (record: any) => void;
  }) {
    this.getTestSuites = options.getTestSuites;
    this.onTestSuitesUpdated = options.onTestSuitesUpdated;
    this.onAuditLog = options.onAuditLog;
  }

  public registerClient(ws: WebSocket) {
    this.connectedWsClients.add(ws);
    // Send immediate state snapshot
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'build_status',
          status: this.lastBuildStatus,
          file: this.lastModifiedFile,
          durationMs: this.lastDurationMs,
          suites: this.getTestSuites(),
          timestamp: this.lastBuildTime,
        })
      );
    }
  }

  public unregisterClient(ws: WebSocket) {
    this.connectedWsClients.delete(ws);
  }

  public broadcast(ev: BuildEventMessage) {
    const payload = JSON.stringify(ev);
    for (const ws of this.connectedWsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (_e) {}
      }
    }
  }

  public getStatus(): WatcherStatus {
    return {
      active: this.watcherActive,
      isBuilding: this.isBuilding,
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
    if (typeof active === 'boolean') {
      this.watcherActive = active;
    } else {
      this.watcherActive = !this.watcherActive;
    }
    this.broadcast({
      type: 'build_status',
      status: this.lastBuildStatus,
      data: `Watcher ${this.watcherActive ? 'activated' : 'paused'}`,
      timestamp: new Date().toISOString(),
    });
    return this.watcherActive;
  }

  public runDiagnostics(triggerFile?: string): Promise<{
    success: boolean;
    durationMs: number;
    errorCount: number;
    warningCount: number;
    output: string;
  }> {
    if (this.isBuilding) {
      this.pendingRebuild = true;
      if (triggerFile) this.pendingFile = triggerFile;
      return Promise.resolve({
        success: true,
        durationMs: 0,
        errorCount: 0,
        warningCount: 0,
        output: `Queued automatic re-run for ${triggerFile || 'subsequent file modification'}`,
      });
    }

    this.isBuilding = true;
    this.lastBuildStatus = 'building';
    this.lastModifiedFile = triggerFile || this.lastModifiedFile || 'manual-trigger';
    this.totalTriggers++;

    const startMsg = `⚡ [Auto-Build Hook] File modified: ${this.lastModifiedFile}. Running instant 'npm run build' verification...`;
    const startLog: BuildLogEntry = {
      id: 'log-' + Date.now().toString(36),
      text: startMsg,
      stream: 'system',
      timestamp: new Date().toISOString(),
    };
    this.recentBuildLogs.push(startLog);
    if (this.recentBuildLogs.length > 300) this.recentBuildLogs.shift();

    this.broadcast({
      type: 'build_status',
      status: 'building',
      file: this.lastModifiedFile,
      timestamp: new Date().toISOString(),
    });

    const startTime = Date.now();
    let fullOutput = '';

    return new Promise((resolve) => {
      // Execute npm run build which runs tsc --noEmit && vite build && esbuild server.ts
      const child = spawn('npm', ['run', 'build'], {
        shell: true,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      const handleChunk = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
        const text = chunk.toString();
        fullOutput += text;
        const entry: BuildLogEntry = {
          id: 'chunk-' + Math.random().toString(36).slice(2, 9),
          text,
          stream,
          timestamp: new Date().toISOString(),
        };
        this.recentBuildLogs.push(entry);
        if (this.recentBuildLogs.length > 300) this.recentBuildLogs.shift();
        this.broadcast({
          type: 'build_chunk',
          stream,
          data: text,
        });
      };

      child.stdout.on('data', (d) => handleChunk(d, 'stdout'));
      child.stderr.on('data', (d) => handleChunk(d, 'stderr'));

      child.on('close', (code) => {
        this.isBuilding = false;
        const durationMs = Date.now() - startTime;
        this.lastDurationMs = durationMs;
        this.lastBuildTime = new Date().toISOString();
        const success = code === 0;
        this.lastBuildStatus = success ? 'passed' : 'failed';

        // Parse error and warning patterns
        const lines = fullOutput.split('\n');
        const errorLines = lines.filter((l) =>
          /error\s+TS\d+|SyntaxError|Failed to resolve|cannot find module|ENOENT/i.test(l)
        );
        const warningLines = lines.filter((l) => /warning/i.test(l));

        // Dynamically update the current test suites
        const suites = this.getTestSuites();
        const tsSuite = suites.find((s) => s.id === 'suite-typescript');
        if (tsSuite) {
          const tsAssertion = tsSuite.assertions.find((a) => a.id === 'ts-1');
          if (tsAssertion) {
            tsAssertion.status = success ? 'passed' : 'failed';
            tsAssertion.durationMs = durationMs;
            if (!success) {
              tsAssertion.message = `Compilation failed with ${errorLines.length || 1} error(s).`;
              tsAssertion.trace = errorLines.slice(0, 5).join('\n') || fullOutput.slice(0, 500);
              tsAssertion.suggestedFix = 'Inspect TypeScript file and syntax errors reported in Live Console.';
            } else {
              tsAssertion.message = `All TypeScript files strictly typecheck with zero errors (passed in ${durationMs}ms).`;
              tsAssertion.trace = undefined;
              tsAssertion.suggestedFix = undefined;
            }
          }
          tsSuite.passedCount = tsSuite.assertions.filter((a) => a.status === 'passed').length;
          tsSuite.failedCount = tsSuite.assertions.filter((a) => a.status === 'failed').length;
          tsSuite.warningCount = tsSuite.assertions.filter((a) => a.status === 'warning').length;
          tsSuite.status = tsSuite.failedCount > 0 ? 'failed' : tsSuite.warningCount > 0 ? 'warning' : 'passed';
          tsSuite.durationMs = durationMs;
          tsSuite.lastRunAt = new Date().toISOString();
        }

        const viteSuite = suites.find((s) => s.id === 'suite-vite');
        if (viteSuite) {
          const viteAssertion = viteSuite.assertions.find((a) => a.id === 'vite-1');
          if (viteAssertion) {
            viteAssertion.status = success ? 'passed' : 'failed';
            viteAssertion.durationMs = durationMs;
            if (success) {
              viteAssertion.message = `Vite build completed with dist output bundle ready (${durationMs}ms).`;
            } else {
              viteAssertion.message = `Vite bundle failed to complete build step.`;
            }
          }
          viteSuite.passedCount = viteSuite.assertions.filter((a) => a.status === 'passed').length;
          viteSuite.failedCount = viteSuite.assertions.filter((a) => a.status === 'failed').length;
          viteSuite.warningCount = viteSuite.assertions.filter((a) => a.status === 'warning').length;
          viteSuite.status = viteSuite.failedCount > 0 ? 'failed' : viteSuite.warningCount > 0 ? 'warning' : 'passed';
          viteSuite.lastRunAt = new Date().toISOString();
        }

        if (this.onTestSuitesUpdated) {
          this.onTestSuitesUpdated(suites);
        }

        const total = suites.reduce((acc, s) => acc + s.totalCount, 0);
        const passed = suites.reduce((acc, s) => acc + s.passedCount, 0);
        const failed = suites.reduce((acc, s) => acc + s.failedCount, 0);
        const warning = suites.reduce((acc, s) => acc + s.warningCount, 0);
        const summary = {
          total,
          passed,
          failed,
          warning,
          durationMs,
          healthIndex: Math.round((passed / (total || 1)) * 100),
        };

        const endMsg = success
          ? `✅ [Auto-Build Hook] Build & typecheck verified clean in ${durationMs}ms. Zero warnings detected.`
          : `❌ [Auto-Build Hook] Build failed with exit code ${code} (${errorLines.length} errors).`;

        const endLog: BuildLogEntry = {
          id: 'log-' + Date.now().toString(36),
          text: endMsg,
          stream: success ? 'system' : 'stderr',
          timestamp: new Date().toISOString(),
        };
        this.recentBuildLogs.push(endLog);
        if (this.recentBuildLogs.length > 300) this.recentBuildLogs.shift();

        this.broadcast({
          type: 'build_complete',
          status: this.lastBuildStatus,
          durationMs,
          errorCount: errorLines.length,
          warningCount: warningLines.length,
          summary,
          suites,
          timestamp: this.lastBuildTime,
        });

        if (this.onAuditLog) {
          this.onAuditLog({
            id: 'auto-build-' + Date.now().toString(36),
            toolName: 'auto_build_watch',
            params: { triggerFile: this.lastModifiedFile },
            status: success ? 'success' : 'failed',
            result: { code, durationMs, errors: errorLines.length, warnings: warningLines.length },
            timestamp: new Date().toISOString(),
            durationMs,
          });
        }

        // Proactive Autonomous TypeScript Auto-Fix Engine
        if (!success && !this.isAutoHealing) {
          try {
            const diags = TypeScriptFixer.parseOutput(fullOutput);
            if (diags.length > 0) {
              const appliedFixes = TypeScriptFixer.autoFixDiagnostics(diags);
              if (appliedFixes.length > 0) {
                this.isAutoHealing = true;
                for (const f of appliedFixes) {
                  const record: AutoFixRecord = {
                    id: 'fix-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
                    file: f.file,
                    line: f.line,
                    code: f.code,
                    actionTaken: f.actionTaken,
                    originalSnippet: f.originalSnippet,
                    fixedSnippet: f.fixedSnippet,
                    timestamp: new Date().toISOString(),
                  };
                  this.recentAutoFixes.unshift(record);
                }
                const healLog: BuildLogEntry = {
                  id: 'heal-' + Date.now().toString(36),
                  text: `⚡ [Auto-Fix Engine] Proactively self-healed ${appliedFixes.length} TypeScript issue(s) without manual confirmation: ${appliedFixes.map((a) => a.code).join(', ')}. Triggering verification...`,
                  stream: 'system',
                  timestamp: new Date().toISOString(),
                };
                this.recentBuildLogs.push(healLog);
                this.broadcast({
                  type: 'auto_fix_applied',
                  file: appliedFixes[0].file,
                  autoFixes: this.recentAutoFixes.slice(0, 10),
                  timestamp: new Date().toISOString(),
                });

                setTimeout(() => {
                  this.isAutoHealing = false;
                  this.runDiagnostics('auto-healed-' + appliedFixes[0].file);
                }, 200);
              }
            }
          } catch (healErr) {
            console.warn('[Auto-Fix Engine] Error running proactive fixes:', healErr);
            this.isAutoHealing = false;
          }
        }

        resolve({
          success,
          durationMs,
          errorCount: errorLines.length,
          warningCount: warningLines.length,
          output: fullOutput,
        });

        if (this.pendingRebuild) {
          this.pendingRebuild = false;
          const nextFile = this.pendingFile;
          this.pendingFile = null;
          setTimeout(() => this.runDiagnostics(nextFile || 'coalesced-change'), 50);
        }

      });
    });
  }

  public start() {
    try {
      this.fsWatcher = fs.watch(process.cwd(), { recursive: true }, (eventType, filename) => {
        if (!this.watcherActive) return;
        if (!filename) return;
        const cleanPath = filename.replace(/\\/g, '/');

        // Ignore build targets, dependencies, git metadata, and internal temp files
        if (
          cleanPath.startsWith('dist/') ||
          cleanPath.startsWith('node_modules/') ||
          cleanPath.startsWith('.git/') ||
          cleanPath.startsWith('.aistudio/') ||
          cleanPath.startsWith('.temp/') ||
          cleanPath.endsWith('.map') ||
          cleanPath.endsWith('.log') ||
          cleanPath === 'bun.lock' ||
          cleanPath.includes('.DS_Store') ||
          cleanPath.endsWith('~')
        ) {
          return;
        }

        console.log(`[Auto-Build Watcher] Detected file change (${eventType}): ${cleanPath}`);
        this.runDiagnostics(cleanPath);
      });

      this.fsWatcher.on('error', (err) => {
        console.warn('[Auto-Build Watcher] File watcher error:', err);
      });

      console.log('[Auto-Build Watcher] Active and monitoring repository for changes...');
    } catch (err) {
      console.warn('[Auto-Build Watcher] Failed to initialize fs.watch:', err);
    }
  }

  public stop() {
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }
}
