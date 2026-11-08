import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";

interface ScheduledJob {
  id: string; title: string; path: string; status: string; nextRunAt: string;
  intervalMs: number | null; runCount: number; failureCount: number; lastRunAt?: string; lastError?: string;
}

@customElement("maya-schedules-workspace")
export class MayaSchedulesWorkspace extends LitElement {
  @state() private schedules: ScheduledJob[] = [];
  @state() private jobTitle = "";
  @state() private filePath = "README.md";
  @state() private runAt = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);
  @state() private repeat: "once" | "hourly" | "daily" | "weekly" = "once";
  @state() private message = "";
  @state() private busy = false;
  @state() private scheduleWorker: any = null;
  @state() private taskWorker: any = null;

  static styles = css`
    :host { display:block; color:#e2e8f0; }
    .panel { background:rgba(2,6,23,.72); border:1px solid rgba(100,116,139,.24); border-radius:16px; padding:16px; }
    .muted { color:#94a3b8; font-size:12px; line-height:1.6; }
    .btn { border:1px solid rgba(100,116,139,.45); border-radius:9px; padding:8px 11px; font-size:12px; }
    .primary { background:#4f46e5; border-color:#6366f1; color:white; }
    input, select { min-width:0; width:100%; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:9px; color:white; font-size:12px; }
  `;

  connectedCallback() { super.connectedCallback(); void this.refresh(); }

  private async request(url: string, init: RequestInit = {}) {
    return fetch(url, { ...init, credentials: "same-origin", headers: { "content-type": "application/json", ...(init.headers || {}) } });
  }

  private async refresh() {
    try {
      const [scheduleResponse, healthResponse] = await Promise.all([this.request("/api/schedules"), this.request("/api/health")]);
      const scheduleData = await scheduleResponse.json();
      if (!scheduleResponse.ok) throw new Error(scheduleData.error || "Schedule list unavailable.");
      this.schedules = Array.isArray(scheduleData.schedules) ? scheduleData.schedules : [];
      const health = healthResponse.ok ? await healthResponse.json() : {};
      this.scheduleWorker = health.scheduleWorker || scheduleData.worker || null;
      this.taskWorker = health.taskWorker || null;
      this.message = "";
    } catch (error) { this.message = error instanceof Error ? error.message : "Unable to load schedules."; }
  }

  private async createSchedule() {
    if (!this.jobTitle.trim() || !this.filePath.trim() || this.busy) return;
    this.busy = true; this.message = "";
    try {
      const intervalMs = this.repeat === "once" ? null : this.repeat === "hourly" ? 60 * 60_000 : this.repeat === "daily" ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
      const response = await this.request("/api/schedules", {
        method: "POST",
        body: JSON.stringify({ title: this.jobTitle, path: this.filePath, runAt: new Date(this.runAt).toISOString(), intervalMs }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Schedule creation failed.");
      this.jobTitle = "";
      await this.refresh();
      this.message = "Schedule created. It will enqueue a read-only task when due.";
    } catch (error) { this.message = error instanceof Error ? error.message : "Schedule creation failed."; }
    finally { this.busy = false; }
  }

  private async pauseSchedule(id: string) {
    try {
      const response = await this.request(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not pause schedule.");
      await this.refresh();
      this.message = "Schedule paused.";
    } catch (error) { this.message = error instanceof Error ? error.message : "Pause failed."; }
  }

  private intervalLabel(ms: number | null) {
    if (ms === null) return "One time";
    if (ms === 60 * 60_000) return "Hourly";
    if (ms === 24 * 60 * 60_000) return "Daily";
    if (ms === 7 * 24 * 60 * 60_000) return "Weekly";
    return `Every ${Math.round(ms / 60_000)} minutes`;
  }

  render() {
    return html`
      <div class="space-y-4 p-4 md:p-6">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div><h2 class="text-xl font-semibold text-white">Scheduled jobs</h2><p class="muted mt-1 max-w-2xl">Create one-time or recurring read-only workspace checks. When due, Maya queues a task for its safe task worker.</p></div>
          <button class="btn" @click=${() => this.refresh()}>Refresh</button>
        </header>
        <section class="panel space-y-4">
          <div><h3 class="font-medium text-white">Create schedule</h3><p class="muted">Current scheduler supports reading one enrolled workspace file only (maximum 50 KB). It does not run arbitrary instructions.</p></div>
          <div class="grid gap-3 md:grid-cols-2">
            <label class="space-y-1"><span class="muted">Job title</span><input .value=${this.jobTitle} @input=${(e: Event) => this.jobTitle = (e.target as HTMLInputElement).value} placeholder="Daily project status check"></label>
            <label class="space-y-1"><span class="muted">Workspace-relative file path</span><input .value=${this.filePath} @input=${(e: Event) => this.filePath = (e.target as HTMLInputElement).value} placeholder="README.md"></label>
            <label class="space-y-1"><span class="muted">First run time</span><input type="datetime-local" .value=${this.runAt} @input=${(e: Event) => this.runAt = (e.target as HTMLInputElement).value}></label>
            <label class="space-y-1"><span class="muted">Repeat</span><select .value=${this.repeat} @change=${(e: Event) => this.repeat = (e.target as HTMLSelectElement).value as any}>
              <option value="once">One time</option><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
            </select></label>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="muted">Scheduler: ${this.scheduleWorker?.enabled ? "enabled" : "disabled"} · Task worker: ${this.taskWorker?.enabled ? "enabled" : "disabled"}</div>
            <button class="btn primary" ?disabled=${this.busy || !this.jobTitle.trim() || !this.filePath.trim()} @click=${() => this.createSchedule()}>${this.busy ? "Saving…" : "Create schedule"}</button>
          </div>
          ${this.message ? html`<p class="muted">${this.message}</p>` : ""}
        </section>
        <section class="space-y-3">
          <h3 class="font-medium text-white">Your schedules</h3>
          ${this.schedules.length ? this.schedules.map(job => html`
            <article class="panel">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0"><div class="font-medium text-white">${job.title}</div><div class="muted mt-1">${job.path} · ${this.intervalLabel(job.intervalMs)}</div><div class="muted">Next run: ${job.status === "completed" ? "Completed" : new Date(job.nextRunAt).toLocaleString()}</div></div>
                <div class="flex items-center gap-2"><span class="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">${job.status}</span>${job.status === "active" ? html`<button class="btn" @click=${() => this.pauseSchedule(job.id)}>Pause</button>` : ""}</div>
              </div>
              <div class="muted mt-3">Runs: ${job.runCount} · Failures: ${job.failureCount}${job.lastRunAt ? ` · Last queued: ${new Date(job.lastRunAt).toLocaleString()}` : ""}</div>
              ${job.lastError ? html`<p class="mt-2 text-xs text-rose-300">${job.lastError}</p>` : ""}
            </article>
          `) : html`<p class="muted">No schedules created yet.</p>`}
        </section>
        <p class="muted text-amber-200/80">To execute scheduled jobs automatically, enable both MAYA_SCHEDULE_WORKER_ENABLED and MAYA_TASK_WORKER_ENABLED on a single-instance server with file storage. Both are disabled by default. The scheduler cannot write files, run shell commands, browse the web or send messages.</p>
      </div>
    `;
  }
}
