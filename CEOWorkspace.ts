import { html, LitElement } from 'lit';

export class MayaCEOWorkspace extends LitElement {
  static properties = { objective: { state: true }, result: { state: true }, busy: { state: true }, error: { state: true }, runs: { state: true } };
  override createRenderRoot() { return this; }
  objective = '';
  result: any = null;
  busy = false;
  error: string | null = null;
  runs: any[] = [];

  override connectedCallback() { super.connectedCallback(); void this.loadRuns(); }

  private async loadRuns() {
    try {
      const response = await fetch('/api/agent/ceo/runs', { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      this.runs = Array.isArray(data.runs) ? data.runs : [];
    } catch { /* run history remains unavailable until the API responds */ }
  }

  private async viewRun(id: string) {
    try {
      const response = await fetch(`/api/agent/ceo/runs/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not load CEO run.');
      const run = data.run;
      this.result = { summary: run.summary || run.error || 'No synthesis was saved.', completedAt: run.completedAt || run.updatedAt, executionMode: run.status, findings: run.findings || [] };
      this.objective = run.objective;
    } catch (error: any) { this.error = error.message || String(error); }
  }

  private async orchestrate() {
    if (!this.objective.trim() || this.busy) return;
    this.busy = true; this.error = null; this.result = null;
    try {
      const response = await fetch('/api/agent/ceo/orchestrate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objective: this.objective }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'CEO orchestration failed.');
      this.result = data.result;
      await this.loadRuns();
    } catch (error: any) { this.error = error.message || String(error); }
    finally { this.busy = false; }
  }

  override render() {
    return html`
      <div class='max-w-5xl mx-auto space-y-5'>
        <section class='rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3'>
          <div class='flex items-center justify-between gap-3'><div><h2 class='text-sm font-semibold text-white'>CEO orchestration</h2><p class='text-xs text-slate-400 mt-1'>Maya's CEO selects up to four specialists, runs their analyses concurrently and synthesizes a Founder report.</p></div><span class='text-[10px] border border-slate-700 rounded-md px-2 py-1 text-slate-400'>Bounded delegation</span></div>
          <textarea class='w-full min-h-32 rounded-xl bg-slate-950 border border-slate-700 p-3 text-sm text-slate-100 outline-none focus:border-indigo-500' .value=${this.objective} @input=${(event: any) => this.objective = event.target.value} placeholder='Describe a complex objective that needs multiple specialist perspectives.'></textarea>
          <div class='flex flex-wrap items-center justify-between gap-2'><span class='text-[11px] text-slate-500'>Specialists receive only role-scoped low-risk read tools where permitted. Writes, shell, browser control, device actions and self-delegation remain disabled.</span><button class='px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50' ?disabled=${this.busy || !this.objective.trim()} @click=${() => this.orchestrate()}>${this.busy ? 'Coordinating specialists…' : 'Run CEO orchestration'}</button></div>
          ${this.error ? html`<p class='text-xs text-rose-300'>${this.error}</p>` : ''}
        </section>
        <section class='rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3'>
          <div class='flex items-center justify-between'><h3 class='text-xs font-semibold uppercase tracking-wide text-slate-400'>Persistent orchestration history</h3><button class='text-xs text-indigo-300' @click=${() => this.loadRuns()}>Refresh</button></div>
          ${this.runs.length ? this.runs.map((run: any) => html`<article class='flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3'>
            <div class='min-w-0'><div class='text-xs font-medium text-white'>${run.objective}</div><div class='mt-1 text-[10px] text-slate-500'>${new Date(run.createdAt).toLocaleString()} · ${run.assignments?.length || 0} specialists · ${run.status}</div></div>
            <button class='rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200' @click=${() => this.viewRun(run.id)}>View</button>
          </article>`) : html`<p class='text-xs text-slate-500'>No CEO runs have been recorded yet.</p>`}
        </section>
        ${this.result ? html`<section class='rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4'><div><h3 class='text-sm font-semibold text-white'>CEO synthesis</h3><p class='text-[10px] text-slate-500 mt-1'>${this.result.executionMode} · ${new Date(this.result.completedAt).toLocaleString()}</p></div><pre class='whitespace-pre-wrap text-xs leading-relaxed text-slate-200 bg-slate-950 rounded-xl border border-slate-800 p-4 font-sans'>${this.result.summary}</pre><div class='space-y-2'><h4 class='text-xs font-semibold text-slate-300 uppercase tracking-wide'>Specialist findings</h4>${this.result.findings.map((finding: any) => html`<article class='rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2'><div class='flex items-center justify-between'><span class='text-xs font-semibold text-white'>${finding.displayName}</span><span class='text-[10px] text-slate-500'>${finding.role} · ${finding.executionMode === 'bounded_tools_with_approval_requests' ? 'approval-gated proposals' : finding.executionMode === 'bounded_read_only_tools' ? 'read-only tools' : 'reasoning only'}</span></div><pre class='whitespace-pre-wrap text-xs leading-relaxed text-slate-300 font-sans'>${finding.output}</pre></article>`)}</div></section>` : ''}
      </div>
    `;
  }
}
if (typeof customElements !== 'undefined' && !customElements.get('maya-ceo-workspace')) customElements.define('maya-ceo-workspace', MayaCEOWorkspace);
