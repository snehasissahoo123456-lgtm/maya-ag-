import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';

@customElement('maya-plan-workspace')
export class MayaPlanWorkspace extends LitElement {
  override createRenderRoot() { return this; }
  @state() accessor objective = '';
  @state() accessor plans: any[] = [];
  @state() accessor busy = false;
  @state() accessor error: string | null = null;

  override connectedCallback() {
    super.connectedCallback();
    void this.loadPlans();
  }

  private async loadPlans() {
    try {
      const response = await fetch('/api/agent/plans', { credentials: 'same-origin' });
      if (response.status === 401) { this.error = 'Founder sign-in is required to view saved plans.'; return; }
      if (!response.ok) throw new Error('Could not load saved plans.');
      const data = await response.json();
      this.plans = Array.isArray(data.plans) ? data.plans : [];
      this.error = null;
    } catch (error: any) { this.error = error.message || String(error); }
  }

  private async generatePlan() {
    const objective = this.objective.trim();
    if (!objective || this.busy) return;
    this.busy = true; this.error = null;
    try {
      const response = await fetch('/api/agent/plan', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Goal planning failed.');
      this.plans = [data.plan, ...this.plans.filter(plan => plan.id !== data.plan.id)];
      this.objective = '';
    } catch (error: any) { this.error = error.message || String(error); }
    finally { this.busy = false; }
  }

  private async approveStep(planId: string, stepId: string) {
    this.error = null;
    try {
      const response = await fetch(`/api/agent/plans/${encodeURIComponent(planId)}/approve`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Step approval failed.');
      this.replacePlan(planId, data.plan);
    } catch (error: any) { this.error = error.message || String(error); }
  }

  private async executePlan(planId: string) {
    this.error = null;
    try {
      const response = await fetch(`/api/agent/plans/${encodeURIComponent(planId)}/execute`, {
        method: 'POST', credentials: 'same-origin',
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Plan execution failed.');
      this.replacePlan(planId, data.plan);
    } catch (error: any) { this.error = error.message || String(error); }
  }

  private replacePlan(id: string, updated: any) {
    this.plans = this.plans.map(plan => plan.id === id ? updated : plan);
  }

  override render() {
    return html`
      <div class='max-w-5xl mx-auto space-y-5'>
        <section class='rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3'>
          <div class='flex items-center justify-between gap-3'>
            <div>
              <h2 class='text-sm font-semibold text-white'>Goal planner & execution</h2>
              <p class='text-xs text-slate-400 mt-1'>Create a bounded plan, review each step, approve state changes and run it sequentially.</p>
            </div>
            <span class='text-[10px] uppercase tracking-wide text-slate-400 border border-slate-700 rounded-md px-2 py-1'>Founder control</span>
          </div>
          <textarea class='w-full min-h-28 rounded-xl bg-slate-950 border border-slate-700 p-3 text-sm text-slate-100 outline-none focus:border-indigo-500'
            .value=${this.objective} @input=${(event: any) => this.objective = event.target.value}
            placeholder='Example: Inspect the repository, read the README and prepare a verified status report.'></textarea>
          <div class='flex flex-wrap items-center justify-between gap-2'>
            <span class='text-[11px] text-slate-500'>Gemini API configuration is required to generate a plan.</span>
            <button class='px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50'
              ?disabled=${this.busy || !this.objective.trim()} @click=${() => this.generatePlan()}>${this.busy ? 'Planning…' : 'Generate plan'}</button>
          </div>
          ${this.error ? html`<p class='text-xs text-rose-300'>${this.error}</p>` : ''}
        </section>
        <div class='flex items-center justify-between'>
          <h3 class='text-xs font-semibold uppercase tracking-wide text-slate-400'>Saved plans</h3>
          <button class='text-xs text-indigo-300 hover:text-indigo-200' @click=${() => this.loadPlans()}>Refresh</button>
        </div>
        ${this.plans.length === 0 ? html`<div class='rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500'>No saved plans yet.</div>` : this.plans.map((plan: any) => html`
          <section class='rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3'>
            <div class='flex flex-wrap items-start justify-between gap-3'>
              <div class='min-w-0'><h4 class='text-sm font-semibold text-white'>${plan.plan?.summary || 'Saved plan'}</h4><p class='text-xs text-slate-400 mt-1'>${plan.plan?.objective || ''}</p></div>
              <span class='text-[10px] uppercase tracking-wide px-2 py-1 rounded-md border border-slate-700 text-slate-300'>${plan.status}</span>
            </div>
            <div class='space-y-2'>
              ${(plan.plan?.steps || []).map((step: any) => {
                const state = plan.stepStates?.[step.id] || { status: 'queued' };
                const approved = Boolean(state.approvedDigest);
                return html`<div class='rounded-xl bg-slate-950/70 border border-slate-800 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2'>
                  <div class='min-w-0'><div class='text-xs text-slate-200 font-medium'>${step.title}</div><div class='text-[10px] text-slate-500 font-mono mt-1'>${step.tool} · ${state.status}</div>
                    ${state.error ? html`<div class='text-[10px] text-rose-300 mt-1'>${state.error}</div>` : ''}
                    ${state.evidence?.sha256 ? html`<div class='text-[10px] text-emerald-400 mt-1'>Verified result digest: ${state.evidence.sha256.slice(0, 16)}…</div>` : ''}
                  </div>
                  ${step.requiresFounderApproval && state.status !== 'completed' && !approved ? html`<button class='shrink-0 px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-300 text-[11px] hover:bg-amber-500/10' @click=${() => this.approveStep(plan.id, step.id)}>Approve exact step</button>` : ''}
                </div>`;
              })}
            </div>
            ${plan.status !== 'completed' && plan.status !== 'failed' ? html`<div class='flex justify-end'><button class='px-3 py-2 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-semibold' @click=${() => this.executePlan(plan.id)}>Run / resume plan</button></div>` : ''}
          </section>
        `)}
      </div>
    `;
  }
}
