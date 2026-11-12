import { html, LitElement } from 'lit';

/**
 * Honest department index. Status labels describe verified repository capability,
 * not planned features or model-generated claims.
 */
export class MayaDepartmentsWorkspace extends LitElement {
  override createRenderRoot() { return this; }

  private departments = [
    { name: 'Research & Intelligence', status: 'Limited', tone: 'amber', evidence: 'Gemini search grounding and a bounded Research specialist are present. No dedicated source archive, repeatable research jobs or citation-verification pipeline.', next: 'Build a source-backed research brief workflow with saved sources and provenance checks.' },
    { name: 'Software Engineering', status: 'Limited', tone: 'amber', evidence: 'Developer role manifest, workspace inspection and bounded local-PC file capabilities exist. There is no isolated code-edit worktree, complete patch-review flow or VS Code integration.', next: 'Add isolated workspaces, approved patch application, Git diff review and test evidence.' },
    { name: 'Quality Assurance', status: 'Foundation only', tone: 'slate', evidence: 'CI and repository tests provide build evidence. No independent QA agent, test-plan workflow or acceptance gate exists yet.', next: 'Create a QA department that generates test plans, runs allowlisted checks and independently verifies results.' },
    { name: 'Operations', status: 'Limited', tone: 'amber', evidence: 'Founder task queue, schedules and bounded worker foundations exist. They do not yet provide full operational SOPs, ownership or KPI tracking.', next: 'Add operational projects, SOP records, owners, recurring reviews and measurable KPIs.' },
    { name: 'Business & Ventures', status: 'Planned', tone: 'slate', evidence: 'Generic tasks and Founder memory only; no venture CRM or business workflow engine.', next: 'Build project/venture records, lead tracking, decisions, KPIs and reporting.' },
    { name: 'Real Estate & Property', status: 'Planned', tone: 'slate', evidence: 'No property-specific data model, lead pipeline, document vault or due-diligence workflow.', next: 'Build property records, land measurements, lead tracking, document checks and valuation evidence.' },
    { name: 'Hospitality & Travel', status: 'Planned', tone: 'slate', evidence: 'No hotel inventory, booking/PMS, guest messaging or tour-operation integration.', next: 'Build room inventory and reservation workflows before adding external booking or payment integrations.' },
    { name: 'Content & Media', status: 'Planned', tone: 'slate', evidence: 'Content specialist can reason and draft; no asset library, production pipeline or publishing connector.', next: 'Build content calendar, script review, asset tracking and human-approved publishing.' },
    { name: 'Finance & Administration', status: 'Planned', tone: 'slate', evidence: 'No financial-account connector or reconciliation workflow. Payment execution is intentionally absent.', next: 'Start with read-only budgets, cash-flow records and reconciliation reports with Founder review.' },
    { name: 'Personal Productivity', status: 'Limited', tone: 'amber', evidence: 'Memory, tasks and scheduled read-only jobs exist. Calendar, email, push notifications and reliable mobile background sync are not configured.', next: 'Add calendar/email connectors, reminders and mobile notifications with explicit permissions.' },
    { name: 'PC & Device Operations', status: 'Limited', tone: 'amber', evidence: 'Paired Windows bridge supports bounded reads/search/Git status and exact-approved file changes. It is not general desktop or shell control.', next: 'Complete device persistence, connector isolation, VS Code integration and physical-PC acceptance tests.' },
    { name: 'AI Workforce & CEO', status: 'Limited', tone: 'amber', evidence: 'CEO orchestration and specialist runs are bounded to a small registered workforce. Budgets, cancellation, resumable queues and independent QA are incomplete.', next: 'Add durable assignment queues, per-agent budgets, cancellation and independent verification.' },
  ];

  override render() {
    const active = this.departments.filter(item => item.status === 'Limited').length;
    const planned = this.departments.filter(item => item.status === 'Planned' || item.status === 'Foundation only').length;
    return html`
      <main class="max-w-6xl mx-auto space-y-5">
        <header class="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-2">
          <p class="text-[10px] uppercase tracking-[0.22em] text-cyan-300">Maya · Operating structure</p>
          <h2 class="text-xl font-semibold text-white">Department directory</h2>
          <p class="text-sm text-slate-400">A factual map of what exists in the repository today and what each department still needs. A department is not marked complete because a role name, roadmap item or UI card exists.</p>
          <div class="flex flex-wrap gap-2 pt-2">
            <span class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">${active} limited departments</span>
            <span class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300">${planned} planned / foundation-only</span>
            <span class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300">${this.departments.length} total areas</span>
          </div>
        </header>
        <section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          ${this.departments.map((item, index) => html`
            <article class="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-[10px] text-slate-500 tabular-nums">${String(index + 1).padStart(2, '0')}</span>
                  <h3 class="text-sm font-semibold text-slate-100">${item.name}</h3>
                </div>
                <span class="shrink-0 rounded-md border px-2 py-1 text-[10px] ${item.tone === 'amber' ? 'border-amber-500/30 text-amber-200 bg-amber-500/10' : 'border-slate-700 text-slate-300 bg-slate-800'}">${item.status}</span>
              </div>
              <div>
                <p class="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Verified current capability</p>
                <p class="text-xs leading-relaxed text-slate-300">${item.evidence}</p>
              </div>
              <div class="border-t border-slate-800 pt-3">
                <p class="text-[10px] uppercase tracking-wider text-cyan-300 mb-1">Next build target</p>
                <p class="text-xs leading-relaxed text-slate-400">${item.next}</p>
              </div>
            </article>
          `)}
        </section>
        <footer class="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs leading-relaxed text-slate-400">
          Status rule: <strong class="text-slate-200">Limited</strong> means a bounded capability exists but the department is incomplete. <strong class="text-slate-200">Foundation only</strong> means supporting infrastructure exists without a functional department workflow. <strong class="text-slate-200">Planned</strong> means no dedicated implementation has been verified. No live integrations, background execution or external actions are implied by this directory.
        </footer>
      </main>
    `;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('maya-departments-workspace')) {
  customElements.define('maya-departments-workspace', MayaDepartmentsWorkspace);
}
