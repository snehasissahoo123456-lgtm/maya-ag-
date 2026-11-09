import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";

interface ControlTask {
  task: {
    id: string; founderId: string; instruction: string; status: string;
    riskLevel: string; requiresApproval: boolean; createdAt: string; updatedAt: string;
    lastError?: string; verificationEvidence: Array<{ kind: string; reference?: string; observedAt: string }>;
  };
  capability: string;
  args: Record<string, unknown>;
  result?: unknown;
}
interface ControlDevice { id: string; name: string; platform: string; online: boolean; revokedAt?: string; }
interface ControlApproval {
  id: string; taskId: string; capability: string; actionDigest: string;
  requestedAt: string; expiresAt: string;
  status: "pending" | "approved" | "rejected" | "consumed" | "expired";
}

function requiresFileContent(capability: string): boolean {
  return ["workspace.write_file", "device.workspace.write_file", "device.workspace.create_file"].includes(capability);
}

@customElement("maya-control-plane-tasks-workspace")
export class MayaControlPlaneTasksWorkspace extends LitElement {
  @state() private tasks: ControlTask[] = [];
  @state() private approvals: ControlApproval[] = [];
  @state() private devices: ControlDevice[] = [];
  @state() private deviceId = "";
  @state() private worker: any = null;
  @state() private instruction = "";
  @state() private filePath = "README.md";
  @state() private capability: "workspace.read_file" | "device.workspace.read_file" | "workspace.write_file" | "device.workspace.write_file" | "device.workspace.create_file" | "device.workspace.create_directory" = "workspace.read_file";
  @state() private content = "";
  @state() private busy = false;
  @state() private busyId = "";
  @state() private message = "";
  @state() private lastResult = "";

  static styles = css`
    :host { display:block; color:#e2e8f0; }
    .panel { background:rgba(2,6,23,.72); border:1px solid rgba(100,116,139,.24); border-radius:16px; padding:16px; }
    .muted { color:#94a3b8; font-size:12px; line-height:1.6; }
    .btn { border:1px solid rgba(100,116,139,.45); border-radius:9px; padding:8px 11px; font-size:12px; }
    .primary { background:#4f46e5; border-color:#6366f1; color:white; }
    .approve { color:#a7f3d0; border-color:rgba(16,185,129,.45); }
    .reject { color:#fda4af; border-color:rgba(244,63,94,.4); }
    input, select, textarea { min-width:0; width:100%; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:9px; color:white; font-size:12px; }
    textarea { min-height:140px; resize:vertical; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:260px; overflow:auto; font-size:11px; }
  `;

  override createRenderRoot() { return this; }
  connectedCallback() { super.connectedCallback(); void this.refresh(); }

  private async request(url: string, init: RequestInit = {}) {
    return fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...(init.headers || {}) },
    });
  }

  private async refresh() {
    this.message = "Loading Founder task and approval records…";
    try {
      const [tasksResponse, approvalsResponse, healthResponse] = await Promise.all([
        this.request("/api/control-plane/tasks"),
        this.request("/api/control-plane/approvals"),
        this.request("/api/health"),
      ]);
      const tasksData = await tasksResponse.json();
      if (!tasksResponse.ok) throw new Error(tasksData.error || "Task list unavailable.");
      const approvalsData = await approvalsResponse.json();
      if (!approvalsResponse.ok) throw new Error(approvalsData.error || "Approval list unavailable.");
      const devicesResponse = await this.request("/api/devices").catch(() => undefined);
      const devicesData = devicesResponse?.ok ? await devicesResponse.json() : {};
      this.tasks = Array.isArray(tasksData.tasks) ? tasksData.tasks : [];
      this.approvals = Array.isArray(approvalsData.approvals) ? approvalsData.approvals : [];
      this.devices = Array.isArray(devicesData.devices) ? devicesData.devices : [];
      if (!this.devices.some(device => device.id === this.deviceId && device.online)) {
        this.deviceId = this.devices.find(device => device.online)?.id || "";
      }
      const health = healthResponse.ok ? await healthResponse.json() : {};
      this.worker = health.taskWorker || null;
      this.message = "";
    } catch (error) {
      this.message = error instanceof Error ? error.message : "Unable to load task workspace.";
    }
  }

  private async createTask() {
    if (this.busy || !this.instruction.trim() || !this.filePath.trim()) return;
    const isRead = ["workspace.read_file", "device.workspace.read_file"].includes(this.capability);
    const isMutation = !isRead;
    const requiresContent = requiresFileContent(this.capability);
    if (requiresContent && !this.content.length) {
      this.message = "Enter the exact file content before creating this task.";
      return;
    }
    if (this.capability.startsWith("device.workspace.") && !this.devices.some(device => device.id === this.deviceId && device.online)) {
      this.message = "Select an online paired device before creating a local write task.";
      return;
    }
    this.busy = true;
    this.message = "";
    this.lastResult = "";
    let confirmation = "";
    try {
      const body: Record<string, unknown> = {
        instruction: this.instruction.trim(),
        capability: this.capability,
        path: this.filePath.trim(),
      };
      if (requiresContent) body.content = this.content;
      if (this.capability.startsWith("device.workspace.")) body.deviceId = this.deviceId;
      const response = await this.request("/api/control-plane/tasks", { method: "POST", body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Task creation failed.");
      const taskId = data.task?.id;
      if (isMutation && taskId) {
        const approvalResponse = await this.request(`/api/control-plane/tasks/${encodeURIComponent(taskId)}/request-approval`, { method: "POST" });
        const approvalData = await approvalResponse.json();
        if (!approvalResponse.ok) throw new Error(approvalData.error || "Task was created, but approval request could not be opened.");
        confirmation = "Approved-action task created. Review the exact device and path, then approve or reject it below.";
      } else {
        confirmation = "Read task created. It will run automatically only if the task worker is enabled; otherwise you can execute it manually.";
      }
      this.instruction = "";
      await this.refresh();
      this.message = confirmation;
    } catch (error) {
      const failure = error instanceof Error ? error.message : "Task creation failed.";
      await this.refresh();
      this.message = failure;
    } finally { this.busy = false; }
  }

  private approvalFor(taskId: string, status?: string) {
    return this.approvals
      .filter(item =>
        item.taskId === taskId &&
        (!status || item.status === status) &&
        !(status === "approved" && Date.parse(item.expiresAt) <= Date.now())
      )
      .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))[0];
  }

  private async decideApproval(approval: ControlApproval, approved: boolean) {
    this.busyId = approval.id;
    this.message = "";
    try {
      const response = await this.request(`/api/control-plane/approvals/${encodeURIComponent(approval.id)}/decision`, {
        method: "POST", body: JSON.stringify({ approved }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Approval decision failed.");
      const confirmation = approved
        ? "Approved for this exact task and payload. The worker will execute it if enabled."
        : "Rejected. This task is cancelled and cannot execute.";
      await this.refresh();
      this.message = confirmation;
    } catch (error) {
      const failure = error instanceof Error ? error.message : "Approval decision failed.";
      await this.refresh();
      this.message = failure;
    } finally { this.busyId = ""; }
  }

  private async requestApproval(task: ControlTask) {
    this.busyId = task.task.id;
    try {
      const response = await this.request(`/api/control-plane/tasks/${encodeURIComponent(task.task.id)}/request-approval`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not request approval.");
      await this.refresh();
      this.message = "Approval request created.";
    } catch (error) {
      const failure = error instanceof Error ? error.message : "Approval request failed.";
      await this.refresh();
      this.message = failure;
    } finally { this.busyId = ""; }
  }

  private async executeTask(task: ControlTask) {
    this.busyId = task.task.id;
    this.message = "";
    this.lastResult = "";
    try {
      const approvedGrant = task.task.requiresApproval ? this.approvalFor(task.task.id, "approved") : undefined;
      if (task.task.requiresApproval && !approvedGrant) throw new Error("An active exact Founder approval is required before execution.");
      const response = await this.request(`/api/control-plane/tasks/${encodeURIComponent(task.task.id)}/execute`, {
        method: "POST",
        body: JSON.stringify(approvedGrant ? { approvalId: approvedGrant.id } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Task execution failed.");
      this.lastResult = JSON.stringify({ task: data.task, result: data.result }, null, 2);
      await this.refresh();
      this.message = "Task executed and the server returned its verification evidence.";
    } catch (error) {
      const failure = error instanceof Error ? error.message : "Task execution failed.";
      await this.refresh();
      this.message = failure;
    } finally { this.busyId = ""; }
  }

  private statusClass(status: string) {
    if (status === "completed" || status === "approved") return "text-emerald-300 border-emerald-500/30 bg-emerald-500/10";
    if (status === "failed" || status === "rejected" || status === "cancelled" || status === "requires_recovery") return "text-rose-300 border-rose-500/30 bg-rose-500/10";
    if (status === "awaiting_approval" || status === "pending" || status === "running") return "text-amber-300 border-amber-500/30 bg-amber-500/10";
    return "text-slate-300 border-slate-700 bg-slate-800/70";
  }

  override render() {
    const workerEnabled = this.worker?.enabled === true;
    return html`
      <div class="space-y-4 p-4 md:p-6">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="muted uppercase tracking-[0.18em] text-cyan-300">Founder control plane</p>
            <h2 class="text-xl font-semibold text-white mt-1">Verified task workspace</h2>
            <p class="muted mt-1 max-w-3xl">Create bounded server or paired-PC workspace tasks. Every file write, file creation or directory creation requires your approval for the exact device and path; file actions also bind the complete content.</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="rounded-full border px-2 py-1 text-xs ${workerEnabled ? "text-emerald-300 border-emerald-500/30" : "text-slate-300 border-slate-700"}">Worker ${workerEnabled ? "enabled" : "disabled"}</span>
            <button class="btn" @click=${() => this.refresh()}>Refresh</button>
          </div>
        </header>

        <section class="panel space-y-4">
          <div>
            <h3 class="font-medium text-white">Create a workspace task</h3>
            <p class="muted mt-1">Reads are limited to non-sensitive text files up to 50 KB. File replacement/creation is limited to 100 KB and requires exact approval. Directory creation makes one new folder beneath an existing parent and also requires exact approval; recursive creation, symlinks and shell commands remain blocked.</p>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <label class="space-y-1"><span class="muted">Task instruction</span><input .value=${this.instruction} @input=${(e: Event) => this.instruction = (e.target as HTMLInputElement).value} maxlength="1000" placeholder="Read the project overview"></label>
            <label class="space-y-1"><span class="muted">Capability</span><select .value=${this.capability} @change=${(e: Event) => this.capability = (e.target as HTMLSelectElement).value as any}>
              <option value="workspace.read_file">Read a workspace file</option>
              <option value="device.workspace.read_file">Read a paired-PC text file</option>
              <option value="workspace.write_file">Replace an existing server text file (approval required)</option>
              <option value="device.workspace.write_file">Replace an existing paired-PC text file (approval required)</option>
              <option value="device.workspace.create_file">Create a new paired-PC text file (approval required)</option>
              <option value="device.workspace.create_directory">Create one paired-PC directory (approval required)</option>
            </select></label>
            ${this.capability.startsWith("device.workspace.") ? html`
              <label class="space-y-1 md:col-span-2"><span class="muted">Paired PC (must be online)</span><select .value=${this.deviceId} @change=${(e: Event) => this.deviceId = (e.target as HTMLSelectElement).value}>
                <option value="">Select a paired PC</option>
                ${this.devices.map(device => html`<option value=${device.id} ?disabled=${!device.online || Boolean(device.revokedAt)}>${device.name} · ${device.revokedAt ? "revoked" : device.online ? "online" : "offline"}</option>`)}
              </select></label>
            ` : ""}
            <label class="space-y-1 md:col-span-2"><span class="muted">${this.capability.startsWith("device.workspace.") ? "Device workspace-relative path" : "Workspace-relative path"}</span><input .value=${this.filePath} @input=${(e: Event) => this.filePath = (e.target as HTMLInputElement).value} maxlength="1024" placeholder="docs/status.md"></label>
            ${requiresFileContent(this.capability) ? html`
              <label class="space-y-1 md:col-span-2"><span class="muted">Exact file content (maximum 100 KB)</span><textarea .value=${this.content} @input=${(e: Event) => this.content = (e.target as HTMLTextAreaElement).value} maxlength="100000" placeholder="Paste the complete file content…"></textarea></label>
            ` : ""}
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="muted">${["workspace.read_file", "device.workspace.read_file"].includes(this.capability) ? "Read tasks do not modify files; local reads require an online paired PC." : "Creating this task opens an approval request; it does not perform the action."}</p>
            <button class="btn primary" ?disabled=${this.busy || !this.instruction.trim() || !this.filePath.trim() || (this.capability.startsWith("device.workspace.") && !this.devices.some(device => device.id === this.deviceId && device.online))} @click=${() => this.createTask()}>${this.busy ? "Creating…" : "Create task"}</button>
          </div>
        </section>

        ${this.message ? html`<p class="muted" role="status">${this.message}</p>` : ""}
        <section class="space-y-3">
          <div class="flex items-center justify-between gap-3"><h3 class="font-medium text-white">Founder task queue</h3><span class="muted">${this.tasks.length} records</span></div>
          ${this.tasks.length ? this.tasks.map(item => {
            const task = item.task;
            const pending = this.approvalFor(task.id, "pending");
            const approved = this.approvalFor(task.id, "approved");
            const taskDevice = this.devices.find(device => device.id === String(item.args.deviceId || ""));
            const deviceRevoked = Boolean(taskDevice?.revokedAt);
            const deviceOnline = !item.capability.startsWith("device.") || Boolean(taskDevice?.online && !deviceRevoked);
            const canExecute = task.status === "queued" && (!task.requiresApproval || Boolean(approved)) && !workerEnabled && deviceOnline;
            return html`
              <article class="panel space-y-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <h4 class="text-sm font-semibold text-white">${task.instruction}</h4>
                    <p class="muted mt-1">${item.capability} · ${String(item.args.path || "")} · ${item.capability.startsWith("device.") ? "Device " + String(item.args.deviceId || "") : "Server workspace"} · ${task.riskLevel} risk</p>
                    <p class="muted font-mono mt-1">${task.id}</p>
                  </div>
                  <span class="rounded-full border px-2 py-1 text-[10px] uppercase ${this.statusClass(task.status)}">${task.status.replaceAll("_", " ")}</span>
                </div>
                ${requiresFileContent(item.capability) ? html`
                  <details class="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <summary class="cursor-pointer text-xs text-amber-200">Review exact replacement content before approval</summary>
                    <pre class="mt-3 text-slate-200">${String(item.args.content || "")}</pre>
                  </details>
                ` : ""}
                ${pending ? html`
                  <div class="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 space-y-2">
                    <div class="flex flex-wrap justify-between gap-2"><span class="text-xs text-amber-200">Founder approval required</span><span class="muted">Expires ${new Date(pending.expiresAt).toLocaleString()}</span></div>
                    <p class="muted">Approval is bound to the exact path, capability and payload digest. Any argument change invalidates it.</p>
                    <div class="flex flex-wrap gap-2">
                      <button class="btn approve" ?disabled=${this.busyId === pending.id} @click=${() => this.decideApproval(pending, true)}>Approve exact action</button>
                      <button class="btn reject" ?disabled=${this.busyId === pending.id} @click=${() => this.decideApproval(pending, false)}>Reject</button>
                    </div>
                  </div>
                ` : ""}
                ${approved ? html`<p class="muted text-emerald-300">Approved exact action · ${new Date(approved.expiresAt).toLocaleString()} expiry</p>` : ""}
                ${task.requiresApproval && task.status === "queued" && !pending && !approved ? html`<button class="btn" ?disabled=${this.busyId === task.id} @click=${() => this.requestApproval(item)}>Request Founder approval</button>` : ""}
                ${canExecute ? html`<button class="btn primary" ?disabled=${this.busyId === task.id} @click=${() => this.executeTask(item)}>${this.busyId === task.id ? "Executing…" : task.requiresApproval ? "Execute approved replacement" : "Execute read task"}</button>` : ""}
                ${workerEnabled && task.status === "queued" ? html`<p class="muted">${item.capability.startsWith("device.") && deviceRevoked ? "This paired PC was revoked. This task cannot execute; pair a replacement PC and create a new task." : item.capability.startsWith("device.") && !deviceOnline ? "Waiting for the paired PC to reconnect; this worker will skip the task until that device is online." : "The background worker will process this queued task. Approval-gated writes remain paused until you approve them."}</p>` : ""}
                ${task.status === "requires_recovery" ? html`<p class="text-xs text-amber-200">Execution outcome is uncertain. Verify the target file on its host before creating another write task; Maya will not replay this action automatically.</p>` : ""}
                ${task.lastError ? html`<p class="text-xs text-rose-300">${task.lastError}</p>` : ""}
                ${item.result !== undefined ? html`
                  <details class="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                    <summary class="cursor-pointer text-xs text-cyan-200">View verified execution result</summary>
                    <pre class="mt-3 text-slate-200">${JSON.stringify(item.result, null, 2)}</pre>
                  </details>
                ` : ""}
                ${task.verificationEvidence?.length ? html`<div class="rounded-lg bg-slate-950/60 p-3"><div class="muted mb-1">Verification evidence</div>${task.verificationEvidence.map(evidence => html`<p class="text-[11px] text-emerald-300">${evidence.kind} · ${evidence.reference || "verified"} · ${new Date(evidence.observedAt).toLocaleString()}</p>`)}</div>` : ""}
              </article>
            `;
          }) : html`<div class="panel muted">No control-plane tasks yet. Create a bounded read or approval-gated write above.</div>`}
        </section>
        ${this.lastResult ? html`<section class="panel"><h3 class="muted uppercase tracking-wide mb-2">Last execution result</h3><pre>${this.lastResult}</pre></section>` : ""}
        <p class="muted text-amber-200/80">Safety boundary: local PC reads use the read-only bridge; file replacement, file creation and one-level directory creation require exact Founder approval. No file deletion, shell execution, authenticated browser access, external publishing or arbitrary desktop control is enabled.</p>
      </div>
    `;
  }
}
