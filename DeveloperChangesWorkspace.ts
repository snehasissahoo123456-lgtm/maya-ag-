import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";

interface DeveloperChange {
  id: string; title: string; objective: string; workspaceId: string; status: string;
  files: string[]; diffSha256: string; createdAt: string; updatedAt: string; patch?: string;
  review?: { reviewerId: string; decision: "approved" | "changes_requested"; notes: string; at: string };
  founderApproval?: { founderId: string; at: string };
  execution?: { startedAt: string; finishedAt?: string; taskId?: string; packageSha256?: string };
  verification?: { passed: boolean; summary: string; at: string };
  rollbackSnapshotId?: string;
}
interface PreparedPackage {
  version: number; changeId: string; founderId: string; workspaceId: string;
  baselineCommit: string; diffSha256: string; packageSha256: string;
  files: Array<{path:string;content:string;expectedSha256:string|null;contentSha256:string}>;
  createdAt: string;
}
interface ApplyApproval { id:string; taskId:string; status:string; expiresAt:string; actionDigest:string; }

@customElement("maya-developer-changes-workspace")
export class MayaDeveloperChangesWorkspace extends LitElement {
  @state() private changes: DeveloperChange[] = [];
  @state() private selected: DeveloperChange | null = null;
  @state() private proposalTitle = "";
  @state() private objective = "";
  @state() private workspaceId = "developer-workspace";
  @state() private filesText = "";
  @state() private patch = "";
  @state() private reviewNotes = "";
  @state() private reviewDecision: "approved" | "changes_requested" = "approved";
  @state() private packageFilesText = "";
  @state() private preparedPackageText = "";
  @state() private approvalId = "";
  @state() private approvalTaskId = "";
  @state() private approvalStatus = "";
  @state() private approvalExpiresAt = "";
  @state() private executionText = "";
  @state() private verificationText = "";
  @state() private busy = false;
  @state() private error = "";
  @state() private notice = "";

  static styles = css`
    :host { display:block; color:#e2e8f0; }
    .panel { background:rgba(2,6,23,.72); border:1px solid rgba(100,116,139,.24); border-radius:16px; padding:16px; }
    .muted { color:#94a3b8; font-size:12px; line-height:1.6; }
    .btn { border:1px solid rgba(100,116,139,.45); border-radius:9px; padding:8px 11px; font-size:12px; color:#e2e8f0; }
    .primary { background:#4f46e5; border-color:#6366f1; color:white; }
    .danger { border-color:rgba(244,63,94,.45); color:#fda4af; }
    input, textarea, select { min-width:0; width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:white; font-size:12px; }
    textarea { min-height:110px; resize:vertical; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:300px; overflow:auto; font-size:11px; }
    .status { border:1px solid rgba(148,163,184,.25); border-radius:999px; padding:3px 8px; font-size:10px; text-transform:uppercase; letter-spacing:.05em; }
    .step { border-left:2px solid rgba(99,102,241,.55); padding-left:12px; }
    button:disabled { opacity:.45; cursor:not-allowed; }
  `;

  override createRenderRoot(): HTMLElement { return this; }
  override connectedCallback() { super.connectedCallback(); void this.refresh(); }

  private readonly recoveryKey = "maya.developer-change-session.v1";
  private persistRecovery() {
    try {
      const records = JSON.parse(sessionStorage.getItem(this.recoveryKey) || "{}");
      const all = records && typeof records === "object" && !Array.isArray(records) ? records : {};
      if (!this.selected) return;
      if (!this.approvalId || !this.approvalTaskId || !this.preparedPackageText) {
        delete all[this.selected.id];
      } else {
        all[this.selected.id] = {
          approvalId: this.approvalId,
          taskId: this.approvalTaskId,
          status: this.approvalStatus,
          expiresAt: this.approvalExpiresAt,
          packageText: this.preparedPackageText,
          savedAt: new Date().toISOString(),
        };
      }
      sessionStorage.setItem(this.recoveryKey, JSON.stringify(all));
    } catch {
      this.error = "This browser session cannot save Developer approval recovery data. Keep the exact package JSON securely before refreshing.";
    }
  }
  private restoreRecovery(changeId: string) {
    try {
      const records = JSON.parse(sessionStorage.getItem(this.recoveryKey) || "{}");
      const record = records && typeof records === "object" ? records[changeId] : undefined;
      if (!record || typeof record !== "object" ||
          typeof record.approvalId !== "string" || typeof record.taskId !== "string" ||
          typeof record.packageText !== "string" || typeof record.status !== "string" ||
          typeof record.expiresAt !== "string") return;
      const savedAt = Date.parse(record.savedAt);
      if (!Number.isFinite(savedAt) || Date.now() - savedAt > 60 * 60 * 1000 ||
          !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.now()) {
        delete records[changeId];
        sessionStorage.setItem(this.recoveryKey, JSON.stringify(records));
        return;
      }
      const pkg = JSON.parse(record.packageText);
      if (!pkg || pkg.changeId !== changeId || typeof pkg.packageSha256 !== "string" || !Array.isArray(pkg.files)) return;
      this.approvalId = record.approvalId;
      this.approvalTaskId = record.taskId;
      this.approvalStatus = record.status;
      this.approvalExpiresAt = record.expiresAt;
      this.preparedPackageText = record.packageText;
    } catch {
      this.error = "Saved Developer approval recovery data is invalid; prepare a new exact package if the existing approval has expired.";
    }
  }
  private clearRecovery(changeId: string) {
    try {
      const records = JSON.parse(sessionStorage.getItem(this.recoveryKey) || "{}");
      if (records && typeof records === "object") {
        delete records[changeId];
        sessionStorage.setItem(this.recoveryKey, JSON.stringify(records));
      }
    } catch {}
  }


  private async request(url: string, init: RequestInit = {}) {
    return fetch(url, { ...init, credentials:"same-origin", headers:{ "content-type":"application/json", ...(init.headers || {}) } });
  }
  private async post(url:string,body:unknown) {
    const response=await this.request(url,{method:"POST",body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error || "Developer lifecycle request failed.");
    return data;
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
    if (this.selected?.id !== id) {
      this.preparedPackageText = "";
      this.approvalId = "";
      this.approvalTaskId = "";
      this.approvalStatus = "";
      this.executionText = "";
      this.verificationText = "";
      this.restoreRecovery(id);
    }
    const response = await this.request("/api/developer/changes/" + encodeURIComponent(id));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Developer change details unavailable.");
    this.selected = data.change;
  }
  private async withBusy(action:()=>Promise<void>) {
    if(this.busy)return;
    this.busy=true;this.error="";this.notice="";
    try{await action();}
    catch(error){this.error=error instanceof Error?error.message:"Developer action failed.";}
    finally{this.busy=false;}
  }
  private async createDraft() {
    const files = this.filesText.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!this.proposalTitle.trim() || !this.objective.trim() || !this.workspaceId.trim() || !files.length || !this.patch.trim()) {
      this.error = "Complete the title, objective, workspace ID, file list and proposed patch."; return;
    }
    await this.withBusy(async()=>{
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(this.patch));
      const diffSha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2,"0")).join("");
      const response = await this.request("/api/developer/changes", { method:"POST", body:JSON.stringify({
        title:this.proposalTitle.trim(), objective:this.objective.trim(), workspaceId:this.workspaceId.trim(),
        files, patch:this.patch, diffSha256,
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Draft creation failed.");
      this.proposalTitle="";this.objective="";this.filesText="";this.patch="";
      this.notice="Draft saved. No files have been changed.";
      await this.refresh();await this.loadDetail(data.change.id);
    });
  }
  private async submitDraft(change:DeveloperChange) {
    await this.withBusy(async()=>{await this.post("/api/developer/changes/"+encodeURIComponent(change.id)+"/submit",{});
      this.notice="Submitted for independent review.";await this.refresh();await this.loadDetail(change.id);});
  }
  private async reviewChange(change:DeveloperChange) {
    await this.withBusy(async()=>{await this.post("/api/developer/changes/"+encodeURIComponent(change.id)+"/review",{
      decision:this.reviewDecision,notes:this.reviewNotes,
    });this.notice="Independent review decision recorded.";this.reviewNotes="";await this.refresh();await this.loadDetail(change.id);});
  }
  private async founderApprove(change:DeveloperChange) {
    if(!confirm("Approve this independently reviewed change? This is not yet approval to apply files."))return;
    await this.withBusy(async()=>{await this.post("/api/developer/changes/"+encodeURIComponent(change.id)+"/approve",{});
      this.notice="Change approved. A separate exact-package approval is still required.";await this.refresh();await this.loadDetail(change.id);});
  }
  private async requestApplyApproval(change:DeveloperChange) {
    let files:unknown;
    try{files=JSON.parse(this.packageFilesText);}catch{this.error="File contents must be valid JSON.";return;}
    if(!Array.isArray(files)){this.error="Provide a JSON array of file objects.";return;}
    await this.withBusy(async()=>{
      const taskId="developer-"+crypto.randomUUID();
      const data=await this.post("/api/developer/changes/"+encodeURIComponent(change.id)+"/request-apply-approval",{
        taskId,files,
      });
      this.approvalTaskId=taskId;
      this.preparedPackageText=JSON.stringify(data.package,null,2);
      this.approvalId=data.approval.id;
      this.approvalStatus=data.approval.status;
      this.approvalExpiresAt=data.approval.expiresAt;
      this.persistRecovery();
      this.notice="Exact package prepared and approval requested. No files have been applied.";
    });
  }
  private async decideApply(approved:boolean) {
    const change=this.selected;if(!change||!this.approvalId)return;
    await this.withBusy(async()=>{
      const data=await this.post("/api/developer/changes/"+encodeURIComponent(change.id)+"/apply-approval/"+encodeURIComponent(this.approvalId)+"/decision",{approved});
      this.approvalStatus=data.approval.status;
      this.persistRecovery();
      this.notice=approved?"Exact package approved. Execution has not started.":"Exact package rejected. No files were applied.";
    });
  }
  private readPackage():PreparedPackage {
    const pkg=JSON.parse(this.preparedPackageText);
    if(!pkg||typeof pkg!=="object"||!Array.isArray(pkg.files)||typeof pkg.packageSha256!=="string")throw new Error("Paste the exact prepared package JSON before continuing.");
    return pkg as PreparedPackage;
  }
  private async executePackage() {
    const change=this.selected;if(!change||!this.approvalId)return;
    await this.withBusy(async()=>{
      const pkg=this.readPackage();
      const data=await this.post("/api/developer/changes/"+encodeURIComponent(change.id)+"/execute",{
        taskId:this.approvalTaskId,approvalId:this.approvalId,package:pkg,
      });
      this.executionText=JSON.stringify(data.execution,null,2);
      this.clearRecovery(change.id);
      this.approvalId="";this.approvalTaskId="";this.approvalStatus="";this.approvalExpiresAt="";this.preparedPackageText="";
      this.notice="Execution request completed. Independent QA is still required.";
      await this.refresh();await this.loadDetail(change.id);
    });
  }
  private async verifyPackage() {
    const change=this.selected;if(!change)return;
    await this.withBusy(async()=>{
      const pkg=this.readPackage();
      const data=await this.post("/api/developer/changes/"+encodeURIComponent(change.id)+"/verify",{package:pkg});
      this.verificationText=JSON.stringify(data.verification,null,2);
      if (data.verification.passed || data.verification.status === "rolled_back") this.clearRecovery(change.id);
      this.notice=data.verification.passed?"QA passed.":"QA did not pass; inspect evidence and rollback state.";
      await this.refresh();await this.loadDetail(change.id);
    });
  }
  private async deleteDraft(change:DeveloperChange) {
    if(change.status!=="draft"||!confirm("Delete this unsubmitted Developer draft?"))return;
    await this.withBusy(async()=>{const response=await this.request("/api/developer/changes/"+encodeURIComponent(change.id),{method:"DELETE"});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Draft deletion failed.");
      this.selected=null;this.notice="Draft deleted.";await this.refresh();});
  }

  override render() {
    const change=this.selected;
    let pkg:PreparedPackage|undefined;
    try{if(this.preparedPackageText)pkg=this.readPackage();}catch{}
    return html`
      <div class="space-y-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><h2 class="text-xl font-bold text-white">Developer Change Workspace</h2><p class="muted mt-1">Founder-controlled change lifecycle with independent review, exact package approval, isolated apply and QA.</p></div>
          <button class="btn" @click=${()=>this.refresh()} ?disabled=${this.busy}>Refresh</button>
        </div>
        ${this.error ? html`<div class="panel border-rose-500/40 text-rose-200 text-sm">${this.error}</div>` : ""}
        ${this.notice ? html`<div class="panel border-emerald-500/30 text-emerald-200 text-sm">${this.notice}</div>` : ""}
        <div class="panel space-y-3">
          <h3 class="font-semibold text-white">New change proposal</h3>
          <p class="muted">Draft creation stores a proposal only. It does not modify repository or workspace files.</p>
          <div class="grid md:grid-cols-2 gap-3">
            <label class="muted">Title<input .value=${this.proposalTitle} @input=${(e:Event)=>this.proposalTitle=(e.target as HTMLInputElement).value} maxlength="160" placeholder="Improve agent task routing"></label>
            <label class="muted">Workspace ID<input .value=${this.workspaceId} @input=${(e:Event)=>this.workspaceId=(e.target as HTMLInputElement).value} maxlength="80"></label>
          </div>
          <label class="muted">Objective<textarea .value=${this.objective} @input=${(e:Event)=>this.objective=(e.target as HTMLTextAreaElement).value} maxlength="4000" placeholder="Describe the intended outcome and acceptance criteria."></textarea></label>
          <label class="muted">Affected file paths (one per line)<textarea .value=${this.filesText} @input=${(e:Event)=>this.filesText=(e.target as HTMLTextAreaElement).value} placeholder="agent-core/example.ts"></textarea></label>
          <label class="muted">Proposed patch / diff<textarea .value=${this.patch} @input=${(e:Event)=>this.patch=(e.target as HTMLTextAreaElement).value} maxlength="120000" placeholder="Paste the proposed diff."></textarea></label>
          <div class="flex justify-end"><button class="btn primary" @click=${()=>this.createDraft()} ?disabled=${this.busy}>Save draft</button></div>
        </div>
        <div class="grid lg:grid-cols-2 gap-4">
          <section class="panel space-y-3">
            <div class="flex items-center justify-between"><h3 class="font-semibold text-white">Change requests</h3><span class="muted">${this.changes.length} records</span></div>
            ${this.changes.length ? this.changes.map(item=>html`
              <button class="w-full text-left rounded-xl border border-slate-700/70 p-3 hover:border-indigo-400/60" @click=${()=>this.loadDetail(item.id)}>
                <div class="flex justify-between items-start gap-2"><strong class="text-sm text-white">${item.title}</strong><span class="status">${item.status}</span></div>
                <p class="muted mt-1">${item.files.length} file(s) · ${new Date(item.updatedAt).toLocaleString()}</p>
              </button>`) : html`<p class="muted">No Developer change proposals yet.</p>`}
          </section>
          <section class="panel space-y-3">
            <h3 class="font-semibold text-white">Selected proposal</h3>
            ${change ? html`
              <div class="flex items-start justify-between gap-2"><strong>${change.title}</strong><span class="status">${change.status}</span></div>
              <p class="muted">${change.objective}</p>
              <p class="muted">Workspace: ${change.workspaceId}</p>
              <p class="muted">Files: ${change.files.join(", ")}</p>
              <p class="muted">Diff SHA-256: <code>${change.diffSha256}</code></p>
              ${change.review?html`<div class="step muted"><strong>Independent review:</strong> ${change.review.decision} by ${change.review.reviewerId}<p>${change.review.notes}</p><p>${change.review.at}</p></div>`:""}
              ${change.founderApproval?html`<p class="muted">Founder approval recorded: ${change.founderApproval.at}</p>`:""}
              ${change.execution?html`<p class="muted">Execution started: ${change.execution.startedAt} · Snapshot: ${change.rollbackSnapshotId||"not reported"}</p>`:""}
              ${change.verification?html`<p class="muted">QA: ${change.verification.passed?"passed":"not passed"} · ${change.verification.summary}</p>`:""}
              ${change.patch?html`<details><summary class="cursor-pointer text-xs text-indigo-300">View proposed diff</summary><pre>${change.patch}</pre></details>`:""}
              <div class="flex flex-wrap gap-2">
                ${change.status==="draft"?html`<button class="btn primary" @click=${()=>this.submitDraft(change)} ?disabled=${this.busy}>Submit for review</button><button class="btn danger" @click=${()=>this.deleteDraft(change)} ?disabled=${this.busy}>Delete draft</button>`:""}
                ${change.status==="submitted"?html`
                  <div class="w-full space-y-2"><p class="muted">Reviewer controls · available only to authenticated CTO/Admin sessions.</p>
                    <select .value=${this.reviewDecision} @change=${(e:Event)=>this.reviewDecision=(e.target as HTMLSelectElement).value as "approved"|"changes_requested"}>
                      <option value="approved">Approve review</option><option value="changes_requested">Request changes</option>
                    </select>
                    <textarea .value=${this.reviewNotes} @input=${(e:Event)=>this.reviewNotes=(e.target as HTMLTextAreaElement).value} placeholder="Reviewer notes and rationale"></textarea>
                    <button class="btn primary" @click=${()=>this.reviewChange(change)} ?disabled=${this.busy}>Record independent review</button>
                  </div>`:""}
                ${change.status==="reviewed"?html`<button class="btn primary" @click=${()=>this.founderApprove(change)} ?disabled=${this.busy}>Founder approve change</button>`:""}
              </div>
            ` : html`<p class="muted">Select a proposal to inspect its details.</p>`}
          </section>
        </div>
        ${change?.status==="approved"||change?.status==="executing"||change?.status==="verifying"||change?.status==="completed"||change?.status==="rolled_back"?html`
          <section class="panel space-y-3">
            <h3 class="font-semibold text-white">Exact package and apply controls</h3>
            <p class="muted">Prepare file contents matching the reviewed file list. Each entry requires path, full content and expectedSha256 (use null only for a new file). The server binds the package hash to the exact approval.</p>
            ${change.status==="approved"?html`
              <label class="muted">Proposed file contents · JSON array<textarea .value=${this.packageFilesText} @input=${(e:Event)=>this.packageFilesText=(e.target as HTMLTextAreaElement).value} placeholder='[{"path":"agent-core/example.ts","content":"...","expectedSha256":null}]'></textarea></label>
              <button class="btn primary" @click=${()=>this.requestApplyApproval(change)} ?disabled=${this.busy}>Prepare package and request apply approval</button>`:""}
            <div class="step space-y-2">
              <p class="muted">Package SHA-256: <code>${pkg?.packageSha256||"not loaded"}</code></p>
              <p class="muted">Approval ID: <code>${this.approvalId||"not loaded"}</code> · Status: ${this.approvalStatus||"unknown"}</p>
              <label class="muted">Exact package JSON · paste the unchanged package here after a page refresh<textarea .value=${this.preparedPackageText} @input=${(e:Event)=>this.preparedPackageText=(e.target as HTMLTextAreaElement).value} placeholder='Paste the exact JSON package returned by the server.'></textarea></label>
              ${this.approvalStatus==="pending"?html`<div class="flex gap-2"><button class="btn primary" @click=${()=>this.decideApply(true)} ?disabled=${this.busy}>Approve exact package</button><button class="btn danger" @click=${()=>this.decideApply(false)} ?disabled=${this.busy}>Reject package</button></div>`:""}
              ${this.approvalStatus==="approved"&&change.status==="approved"?html`<button class="btn primary" @click=${()=>this.executePackage()} ?disabled=${this.busy||!pkg}>Apply approved package to isolated workspace</button>`:""}
            </div>
            ${change.status==="executing"||change.status==="verifying"?html`<button class="btn primary" @click=${()=>this.verifyPackage()} ?disabled=${this.busy||!this.preparedPackageText}>Run independent QA verification</button>`:""}
            ${this.executionText?html`<details open><summary class="text-xs text-indigo-300">Execution result</summary><pre>${this.executionText}</pre></details>`:""}
            ${this.verificationText?html`<details open><summary class="text-xs text-indigo-300">QA evidence</summary><pre>${this.verificationText}</pre></details>`:""}
            <p class="muted">The API does not deploy or merge code. If the sandbox worker or host isolation attestation is unavailable, execution/QA must fail closed.</p>
          </section>`:""}
        <div class="panel"><p class="muted"><strong class="text-amber-200">Safety boundary:</strong> this screen exposes the backend lifecycle controls, but does not itself prove that the host supervisor or sandbox worker is installed, healthy or connected. No action runs automatically on page load.</p></div>
      </div>
    `;
  }
}
