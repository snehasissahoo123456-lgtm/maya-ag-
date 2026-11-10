import { html, LitElement } from 'lit';

export class MayaSpecialistWorkspace extends LitElement {
  static properties = {
    agentId: { state: true }, specialists: { state: true }, task: { state: true },
    result: { state: true }, busy: { state: true }, error: { state: true },
  };
  override createRenderRoot() { return this; }
  agentId = 'research';
  specialists: any[] = [];
  task = '';
  result: any = null;
  busy = false;
  error: string | null = null;

  override connectedCallback() { super.connectedCallback(); void this.loadSpecialists(); }
  private async loadSpecialists() {
    try {
      const response = await fetch('/api/agent/specialists', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(response.status === 401 ? 'Founder sign-in is required.' : 'Could not load specialist registry.');
      const data = await response.json();
      this.specialists = Array.isArray(data.specialists) ? data.specialists : [];
    } catch (error: any) { this.error = error.message || String(error); }
  }
  private async runSpecialist() {
    if (!this.task.trim() || this.busy) return;
    this.busy = true; this.error = null; this.result = null;
    try {
      const response = await fetch('/api/agent/specialists/run', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: this.agentId, task: this.task }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Specialist run failed.');
      this.result = data.result;
    } catch (error: any) { this.error = error.message || String(error); }
    finally { this.busy = false; }
  }
  override render() {
    return html`
      <div class='max-w-5xl mx-auto space-y-5'>
        <section class='rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3'>
          <div class='flex items-center justify-between gap-3'><div><h2 class='text-sm font-semibold text-white'>Specialist workforce</h2><p class='text-xs text-slate-400 mt-1'>Run a bounded specialist. Available tools are limited by the selected role's manifest and the authenticated Founder session.</p></div><span class='text-[10px] border border-slate-700 rounded-md px-2 py-1 text-slate-400'>Role-scoped read-only</span></div>
          <label class='block text-[11px] uppercase tracking-wide text-slate-400'>Specialist role</label>
          <select class='w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-sm text-slate-100' .value=${this.agentId} @change=${(event: any) => this.agentId = event.target.value}>
            ${this.specialists.map(agent => html`<option value=${agent.id}>${agent.displayName} — ${agent.purpose}</option>`)}
          </select>
          <label class='block text-[11px] uppercase tracking-wide text-slate-400'>Assigned task</label>
          <textarea class='w-full min-h-32 rounded-xl bg-slate-950 border border-slate-700 p-3 text-sm text-slate-100 outline-none focus:border-indigo-500' .value=${this.task} @input=${(event: any) => this.task = event.target.value} placeholder='Describe the analysis or deliverable for this specialist.'></textarea>
          <div class='flex flex-wrap items-center justify-between gap-2'><span class='text-[11px] text-slate-500'>Only low-risk read tools may be available to this role. Writes, shell, browser control and device actions are disabled. Gemini is required.</span><button class='px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50' ?disabled=${this.busy || !this.task.trim() || this.specialists.length === 0} @click=${() => this.runSpecialist()}>${this.busy ? 'Working…' : 'Run specialist'}</button></div>
          ${this.error ? html`<p class='text-xs text-rose-300'>${this.error}</p>` : ''}
        </section>
        ${this.result ? html`<section class='rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3'><div class='flex items-center justify-between gap-3'><div><h3 class='text-sm font-semibold text-white'>${this.result.displayName}</h3><p class='text-[10px] text-slate-500'>${this.result.role} · ${this.result.executionMode === 'bounded_tools_with_approval_requests' ? 'Approval-gated change proposals' : this.result.executionMode === 'bounded_read_only_tools' ? 'Scoped read-only tools used' : 'Reasoning only'} · ${new Date(this.result.completedAt).toLocaleString()}</p></div><span class='text-[10px] border border-slate-700 rounded px-2 py-1 text-slate-400'>Result</span></div><pre class='whitespace-pre-wrap text-xs leading-relaxed text-slate-200 bg-slate-950 rounded-xl border border-slate-800 p-4 font-sans'>${this.result.output}</pre></section>` : ''}
      </div>
    `;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('maya-specialist-workspace')) {
  customElements.define('maya-specialist-workspace', MayaSpecialistWorkspace);
}
