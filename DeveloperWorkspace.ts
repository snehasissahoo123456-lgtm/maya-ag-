import { html, LitElement } from 'lit';

export class MayaDeveloperWorkspace extends LitElement {
  static properties = {
    task: { state: true }, result: { state: true }, tasks: { state: true }, approvals: { state: true },
    busy: { state: true }, loading: { state: true }, error: { state: true }, notice: { state: true },
  };
  override createRenderRoot() { return this; }
  task = '';
  result: any = null;
  tasks: any[] = [];
  approvals: any[] = [];
  busy = false;
  loading = false;
  error: string | null = null;
  notice: string | null = null;

  override connectedCallback() { super.connectedCallback(); void this.refresh(); }

  private async refresh() {
    this.loading = true;
    this.error = null;
    try {
      const [taskResponse, approvalResponse] = await Promise.all([
        fetch('/api/control-plane/tasks', { credentials: 'same-origin' }),
        fetch('/api/control-plane/approvals', { credentials: 'same-origin' }),
      ]);
      if (taskResponse.status === 401 || approvalResponse.status === 401) throw new Error('Founder sign-in is required.');
      if (!taskResponse.ok || !approvalResponse.ok) throw new Error('Could not load Developer task and approval state.');
      const taskData = await taskResponse.json();
      const approvalData = await approvalResponse.json();
      this.tasks = (Array.isArray(taskData.tasks) ? taskData.tasks : [])
        .filter((item: any) => (item.capability === 'workspace.write_file' && typeof item.args?.expectedSha256 === 'string') || item.capability === 'workspace.run_validation')
        .sort((a: any, b: any) => String(b.task.createdAt).localeCompare(String(a.task.createdAt)));
      this.approvals = Array.isArray(approvalData.approvals) ? approvalData.approvals : [];
    } catch (error: any) { this.error = error.message || String(error); }
    finally { this.loading = false; }
  }

  private async runDeveloper() {
    if (!this.task.trim() || this.busy) return;
    this.busy = true; this.error = null; this.notice = null; this.result = null;
    try {
      const response = await fetch('/api/agent/specialists/run', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'developer', task: this.task }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Developer run failed.');
      this.result = data.result;
      await this.refresh();
    } catch (error: any) { this.error = error.message || String(error); }
    finally { this.busy = false; }
  }

  private async queueValidation() {
    this.error = null; this.notice = null;
    try {
      const response = await fetch('/api/control-plane/tasks', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability: 'workspace.run_validation', instruction: 'Run the fixed lint, test and production build validation suite in the Maya server workspace.' }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not queue repository validation.');
      this.notice = 'Validation task queued. Request and approve it below before execution.';
      await this.refresh();
    } catch (error: any) { this.error = error.message || String(error); }
  }

  private async requestApproval(taskId: string) {
    this.error = null; this.notice = null;
    try {
      const response = await fetch(`/api/control-plane/tasks/${encodeURIComponent(taskId)}/request-approval`, {
        method: 'POST', credentials: 'same-origin',
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not request Founder approval.');
      this.notice = `Approval requested for task ${taskId}.`;
      await this.refresh();
    } catch (error: any) { this.error = error.message || String(error); }
  }

  private async decideApproval(approvalId: string, approved: boolean) {
    this.error = null; this.notice = null;
    try {
      const response = await fetch(`/api/control-plane/approvals/${encodeURIComponent(approvalId)}/decision`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Approval decision failed.');
      this.notice = approved ? 'Developer change approved. It is now eligible for execution.' : 'Developer change rejected.';
      await this.refresh();
    } catch (error: any) { this.error = error.message || String(error); }
  }

  private async executeTask(taskId: string, approvalId: string) {
    this.error = null; this.notice = null;
    try {
      const response = await fetch(`/api/control-plane/tasks/${encodeURIComponent(taskId)}/execute`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Approved Developer change could not execute.');
      this.notice = data.task?.status === 'completed' ? 'File replacement completed and its SHA-256 was verified.' : `Execution status: ${data.task?.status || 'unknown'}`;
      await this.refresh();
    } catch (error: any) { this.error = error.message || String(error); await this.refresh(); }
  }

  override render() {
    return html`
      <div class='max-w-6xl mx-auto space-y-5'>
        <section class='rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3'>
          <div class='flex flex-wrap items-start justify-between gap-3'>
            <div><h2 class='text-sm font-semibold text-white'>Developer department</h2><p class='text-xs text-slate-400 mt-1'>Inspect Maya's server workspace and propose exact file replacements. A proposal is queued only; it does not change a file.</p></div>
            <span class='text-[10px] border border-amber-500/30 bg-amber-500/10 rounded-md px-2 py-1 text-amber-200'>Founder approval required</span>
          </div>
          <div class='grid grid-cols-1 md:grid-cols-3 gap-2'>
            <div class='rounded-xl border border-slate-800 bg-slate-950/70 p-3'><div class='text-[10px] uppercase tracking-wide text-slate-500'>Workspace</div><div class='text-xs text-slate-200 mt-1'>Maya server repository</div></div>
            <div class='rounded-xl border border-slate-800 bg-slate-950/70 p-3'><div class='text-[10px] uppercase tracking-wide text-slate-500'>Write policy</div><div class='text-xs text-slate-200 mt-1'>Exact SHA-256 + single-use Founder approval</div></div>
            <div class='rounded-xl border border-slate-800 bg-slate-950/70 p-3'><div class='text-[10px] uppercase tracking-wide text-slate-500'>Execution boundary</div><div class='text-xs text-slate-200 mt-1'>No arbitrary shell, deployment or local-PC writes. The fixed lint/test/build suite requires separate Founder approval</div></div>
          </div>
          <p class='text-[11px] text-amber-200/80'>This first Developer workflow operates on the server-side Maya checkout only. It is not yet connected to arbitrary Windows/VS Code workspaces and does not use an isolated Git worktree. Review each proposed file payload before approval.</p>
          <label class='block text-[11px] uppercase tracking-wide text-slate-400'>Development assignment</label>
          <textarea class='w-full min-h-28 rounded-xl bg-slate-950 border border-slate-700 p-3 text-sm text-slate-100 outline-none focus:border-indigo-500' .value=${this.task} @input=${(event: any) => this.task = event.target.value} placeholder='Example: inspect the task worker and propose a fix for a verified bug. Read the relevant files first, then queue a file proposal with its SHA-256.'></textarea>
          <div class='flex flex-wrap items-center justify-between gap-2'><span class='text-[11px] text-slate-500'>Gemini is required. The Developer can read files, queue exact-hash replacements and request the fixed validation suite; every mutation or command run requires separate Founder approval.</span><button class='px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50' ?disabled=${this.busy || !this.task.trim()} @click=${() => this.runDeveloper()}>${this.busy ? 'Analyzing workspace…' : 'Run Developer'}</button></div>
          ${this.error ? html`<p class='text-xs text-rose-300'>${this.error}</p>` : ''}
          ${this.notice ? html`<p class='text-xs text-emerald-300'>${this.notice}</p>` : ''}
        </section>
        ${this.result ? html`<section class='rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3'><div class='flex items-center justify-between gap-3'><div><h3 class='text-sm font-semibold text-white'>Developer report</h3><p class='text-[10px] text-slate-500'>${this.result.executionMode === 'bounded_tools_with_approval_requests' ? 'Read tools + approval-gated proposal tool' : this.result.executionMode} · ${new Date(this.result.completedAt).toLocaleString()}</p></div><span class='text-[10px] border border-slate-700 rounded px-2 py-1 text-slate-400'>No file changes made by this run</span></div><pre class='whitespace-pre-wrap text-xs leading-relaxed text-slate-200 bg-slate-950 rounded-xl border border-slate-800 p-4 font-sans'>${this.result.output}</pre></section>` : ''}

        <section class='rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3'>
          <div class='flex items-center justify-between gap-3'><div><h3 class='text-sm font-semibold text-white'>Proposed file changes</h3><p class='text-[11px] text-slate-500 mt-1'>Only Developer proposals with an expected file hash are shown.</p></div><button class='text-xs text-indigo-300' @click=${() => this.refresh()}>${this.loading ? 'Refreshing…' : 'Refresh queue'}</button></div>
          ${this.tasks.length ? this.tasks.map((envelope: any) => {
            const task = envelope.task || {};
            const approval = this.approvals.find((item: any) => item.taskId === task.id);
            const isValidation = envelope.capability === 'workspace.run_validation';
            const path = isValidation ? 'Repository lint / test / build' : String(envelope.args?.path || '');
            const content = String(envelope.args?.content || '');
            const expected = String(envelope.args?.expectedSha256 || '');
            return html`<article class='rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3'>
              <div class='flex flex-wrap items-start justify-between gap-3'>
                <div class='min-w-0'><div class='text-xs font-semibold text-white break-all'>${path}</div><div class='text-[10px] text-slate-500 mt-1'>Task ${task.id} · ${task.status} · \${isValidation ? 'fixed validation suite' : content.length.toLocaleString() + ' characters'}</div><div class='text-[10px] text-slate-500 mt-1'>Expected SHA-256: <span class='font-mono text-slate-300'>${expected.slice(0, 20)}…</span></div></div>
                <span class='text-[10px] rounded px-2 py-1 border ${task.status === 'completed' ? 'border-emerald-500/30 text-emerald-300' : task.status === 'failed' || task.status === 'requires_recovery' ? 'border-rose-500/30 text-rose-300' : 'border-amber-500/30 text-amber-200'}'>${task.status}</span>
              </div>
              <details class='rounded-lg border border-slate-800 p-3'><summary class='cursor-pointer text-[11px] text-slate-300'>Review proposed file contents</summary><pre class='whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300 mt-3 max-h-72 overflow-auto'>${content.slice(0, 8000)}${content.length > 8000 ? '\n… preview truncated at 8 KB' : ''}</pre></details>
              <div class='flex flex-wrap gap-2'>
                ${task.status === 'queued' && task.requiresApproval && !approval ? html`<button class='rounded-lg bg-amber-600/20 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-100' @click=${() => this.requestApproval(task.id)}>Request approval</button>` : ''}
                ${approval?.status === 'pending' ? html`<span class='text-[11px] text-amber-200 self-center'>Approval pending</span><button class='rounded-lg border border-rose-500/30 px-3 py-2 text-[11px] text-rose-200' @click=${() => this.decideApproval(approval.id, false)}>Reject</button><button class='rounded-lg bg-emerald-600/20 border border-emerald-500/30 px-3 py-2 text-[11px] text-emerald-200' @click=${() => this.decideApproval(approval.id, true)}>Approve exact change</button>` : ''}
                ${approval?.status === 'approved' && task.status === 'queued' ? html`<button class='rounded-lg bg-indigo-600 px-3 py-2 text-[11px] text-white' @click=${() => this.executeTask(task.id, approval.id)}>Execute approved change</button>` : ''}
                ${approval?.status === 'rejected' ? html`<span class='text-[11px] text-rose-200 self-center'>Founder rejected this proposal</span>` : ''}
                ${task.status === 'completed' ? html`<span class='text-[11px] text-emerald-300 self-center'>Verified SHA-256: ${task.verificationEvidence?.[0]?.reference || 'evidence recorded'}</span>` : ''}
                ${task.status === 'requires_recovery' ? html`<span class='text-[11px] text-rose-200 self-center'>Manual inspection required; no automatic replay</span>` : ''}
              </div>
            </article>`;
          }) : html`<p class='text-xs text-slate-500'>No Developer file proposals are queued.</p>`}
        </section>
      </div>
    `;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('maya-developer-workspace')) {
  customElements.define('maya-developer-workspace', MayaDeveloperWorkspace);
}
