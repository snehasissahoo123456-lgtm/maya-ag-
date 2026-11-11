import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";

interface DeveloperChange {
  id: string; title: string; objective: string; workspaceId: string; status: string;
  files: string[]; diffSha256: string; createdAt: string; updatedAt: string; patch?: string;
}

@customElement("maya-developer-changes-workspace")
export class MayaDeveloperChangesWorkspace extends LitElement {
  @state() private changes: DeveloperChange[] = [];
  @state() private selected: DeveloperChange | null = null;
  @state() private proposalTitle = "";
  @state() private objective = "";
  @state() private workspaceId = "developer-workspace";
  @state() private filesText = "";
  @state() private patch = "";
  @state() private busy = false;
  @state() private error = "";
  @state() private notice = "";

  static styles = css`
    :host { display:block; color:#e2e8f0; }
    .panel { background:rgba(2,6,23,.72); border:1px solid rgba(100,116,139,.24); border-radius:16px; padding:16px; }
    .muted { color:#94a3b8; font-size:12px; line-height:1.6; }
    .btn { border:1px solid rgba(100,116,139,.45); border-radius:9px; padding:8px 11px; font-size:12px; }
    .primary { background:#4f46e5; border-color:#6366f1; color:white; }
    input, textarea { min-width:0; width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:white; font-size:12px; }
    textarea { min-height:110px; resize:vertical; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:300px; overflow:auto; font-size:11px; }
    .status { border:1px solid rgba(148,163,184,.25); border-radius:999px; padding:3px 8px; font-size:10px; text-transform:uppercase; letter-spacing:.05em; }
  `;

  override createRenderRoot(): HTMLElement { return this; }
  override connectedCallback() { super.connectedCallback(); void this.refresh(); }

  private async request(url: string, init: RequestInit = {}) {
    return fetch(url, { ...init, credentials:"same-origin", headers:{ "content-type":"application/json", ...(init.headers || {}) } });
  }

  private async refresh() {
    this.error = "";
    try {
      const response = await this.request("/api/developer/changes");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Developer changes could not be loaded.");
      this.changes = Array.isArray(data.changes) ? data.changes : [];
      if (this.selected) {
        const current = this.changes.find(change => change.id === this.selected?.id);
        if (current) await this.loadDetail(current.id);
        else this.selected = null;
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Unable to load Developer changes."; }
  }

  private async loadDetail(id: string) {
    const response = await this.request("/api/developer/changes/" + encodeURIComponent(id));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Developer change details unavailable.");
    this.selected = data.change;
  }

  private async createDraft() {
    if (this.busy) return;
    const files = this.filesText.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!this.proposalTitle.trim() || !this.objective.trim() || !this.workspaceId.trim() || !files.length || !this.patch.trim()) {
      this.error = "Complete the title, objective, workspace ID, file list and proposed patch.";
      return;
    }
    this.busy = true; this.error = ""; this.notice = "";
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(this.patch));
      const diffSha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2,"0")).join("");
      const response = await this.request("/api/developer/changes", { method:"POST", body:JSON.stringify({
        title:this.proposalTitle.trim(), objective:this.objective.trim(), workspaceId:this.workspaceId.trim(),
        files, patch:this.patch, diffSha256,
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Draft creation failed.");
      this.proposalTitle = ""; this.objective = ""; this.filesText = ""; this.patch = "";
      this.notice = "Draft saved. It has not been reviewed, approved or executed.";
      await this.refresh();
      await this.loadDetail(data.change.id);
    } catch (error) { this.error = error instanceof Error ? error.message : "Draft creation failed."; }
    finally { this.busy = false; }
  }

  private async submitDraft(change: DeveloperChange) {
    if (this.busy || change.status !== "draft") return;
    this.busy = true; this.error = ""; this.notice = "";
    try {
      const response = await this.request("/api/developer/changes/" + encodeURIComponent(change.id) + "/submit", { method:"POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Submission failed.");
      this.notice = "Submitted for independent review. Founder approval and execution remain unavailable until their separate controls are integrated.";
      await this.refresh();
      await this.loadDetail(change.id);
    } catch (error) { this.error = error instanceof Error ? error.message : "Submission failed."; }
    finally { this.busy = false; }
  }

  private async deleteDraft(change: DeveloperChange) {
    if (this.busy || change.status !== "draft" || !confirm("Delete this unsubmitted Developer draft?")) return;
    this.busy = true; this.error = ""; this.notice = "";
    try {
      const response = await this.request("/api/developer/changes/" + encodeURIComponent(change.id), { method:"DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Draft deletion failed.");
      this.selected = null; this.notice = "Draft deleted."; await this.refresh();
    } catch (error) { this.error = error instanceof Error ? error.message : "Draft deletion failed."; }
    finally { this.busy = false; }
  }

  override render() {
    return html`
      <div class="space-y-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><h2 class="text-xl font-bold text-white">Developer Change Workspace</h2><p class="muted mt-1">Create and track Founder-owned code-change proposals.</p></div>
          <button class="btn" @click=${() => this.refresh()} ?disabled=${this.busy}>Refresh</button>
        </div>
        ${this.error ? html`<div class="panel border-rose-500/40 text-rose-200 text-sm">${this.error}</div>` : ""}
        ${this.notice ? html`<div class="panel border-emerald-500/30 text-emerald-200 text-sm">${this.notice}</div>` : ""}
        <div class="panel space-y-3">
          <h3 class="font-semibold text-white">New change proposal</h3>
          <p class="muted">This creates a draft only. The patch is stored for review; no repository files are changed.</p>
          <div class="grid md:grid-cols-2 gap-3">
            <label class="muted">Title<input .value=${this.proposalTitle} @input=${(e:Event)=>this.proposalTitle=(e.target as HTMLInputElement).value} maxlength="160" placeholder="Improve agent task routing"></label>
            <label class="muted">Workspace ID<input .value=${this.workspaceId} @input=${(e:Event)=>this.workspaceId=(e.target as HTMLInputElement).value} maxlength="80"></label>
          </div>
          <label class="muted">Objective<textarea .value=${this.objective} @input=${(e:Event)=>this.objective=(e.target as HTMLTextAreaElement).value} maxlength="4000" placeholder="Describe the intended outcome and acceptance criteria."></textarea></label>
          <label class="muted">Affected file paths (one per line)<textarea .value=${this.filesText} @input=${(e:Event)=>this.filesText=(e.target as HTMLTextAreaElement).value} placeholder="agent-core/example.ts"></textarea></label>
          <label class="muted">Proposed patch / diff<textarea .value=${this.patch} @input=${(e:Event)=>this.patch=(e.target as HTMLTextAreaElement).value} maxlength="120000" placeholder="Paste the proposed diff."></textarea></label>
          <div class="flex justify-end"><button class="btn primary" @click=${()=>this.createDraft()} ?disabled=${this.busy}>${this.busy?"Working…":"Save draft"}</button></div>
        </div>
        <div class="grid lg:grid-cols-2 gap-4">
          <section class="panel space-y-3">
            <div class="flex items-center justify-between"><h3 class="font-semibold text-white">Your change requests</h3><span class="muted">${this.changes.length} records</span></div>
            ${this.changes.length ? this.changes.map(change=>html`
              <button class="w-full text-left rounded-xl border border-slate-700/70 p-3 hover:border-indigo-400/60" @click=${()=>this.loadDetail(change.id)}>
                <div class="flex justify-between items-start gap-2"><strong class="text-sm text-white">${change.title}</strong><span class="status">${change.status}</span></div>
                <p class="muted mt-1">${change.files.length} file(s) · ${new Date(change.updatedAt).toLocaleString()}</p>
              </button>`) : html`<p class="muted">No Developer change proposals yet.</p>`}
          </section>
          <section class="panel space-y-3">
            <h3 class="font-semibold text-white">Selected proposal</h3>
            ${this.selected ? html`
              <div class="flex items-start justify-between gap-2"><strong>${this.selected.title}</strong><span class="status">${this.selected.status}</span></div>
              <p class="muted">${this.selected.objective}</p>
              <p class="muted">Workspace: ${this.selected.workspaceId}</p>
              <p class="muted">Files: ${this.selected.files.join(", ")}</p>
              <p class="muted">Diff SHA-256: <code>${this.selected.diffSha256}</code></p>
              ${this.selected.patch ? html`<details><summary class="cursor-pointer text-xs text-indigo-300">View proposed diff</summary><pre>${this.selected.patch}</pre></details>` : ""}
              <div class="flex flex-wrap gap-2">
                ${this.selected.status==="draft" ? html`<button class="btn primary" @click=${()=>this.submitDraft(this.selected!)} ?disabled=${this.busy}>Submit for review</button><button class="btn" @click=${()=>this.deleteDraft(this.selected!)} ?disabled=${this.busy}>Delete draft</button>` : ""}
              </div>
            ` : html`<p class="muted">Select a proposal to inspect its details.</p>`}
          </section>
        </div>
        <div class="panel"><p class="muted"><strong class="text-amber-200">Current safety boundary:</strong> independent review identity, explicit Founder approval, production workspace adapter, sandbox worker lifecycle and QA-to-dashboard status integration are not yet wired here. This page cannot execute or deploy code.</p></div>
      </div>
    `;
  }
}
