import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";

interface EnrolledDevice {
  id: string; name: string; platform: string; architecture: string;
  runtimeVersion: string; online: boolean; createdAt: string; lastSeenAt: string;
}

@customElement("maya-devices-workspace")
export class MayaDevicesWorkspace extends LitElement {
  @state() private devices: EnrolledDevice[] = [];
  @state() private pairing: { code: string; expiresAt: string } | null = null;
  @state() private message = "Load devices to check bridge status.";
  @state() private commandResult = "";
  @state() private filePath = "README.md";
  @state() private busy = false;

  static styles = css`
    :host { display:block; color:#e2e8f0; }
    .panel { background:rgba(2,6,23,.72); border:1px solid rgba(100,116,139,.24); border-radius:16px; padding:16px; }
    .muted { color:#94a3b8; font-size:12px; line-height:1.6; }
    .btn { border:1px solid rgba(100,116,139,.45); border-radius:9px; padding:8px 11px; font-size:12px; }
    .primary { background:#4f46e5; border-color:#6366f1; color:white; }
    .danger { color:#fda4af; border-color:rgba(244,63,94,.4); }
    input { min-width:0; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:8px; color:white; font-size:12px; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:320px; overflow:auto; font-size:12px; }
  `;

  connectedCallback() { super.connectedCallback(); void this.refresh(); }

  private async request(url: string, init: RequestInit = {}) {
    return fetch(url, { ...init, credentials: "same-origin", headers: { "content-type": "application/json", ...(init.headers || {}) } });
  }

  private async refresh() {
    this.message = "Loading enrolled devices...";
    try {
      const response = await this.request("/api/devices");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Device registry unavailable.");
      this.devices = Array.isArray(data.devices) ? data.devices : [];
      this.message = this.devices.length ? "" : "No local devices are paired yet.";
    } catch (error) { this.message = error instanceof Error ? error.message : "Unable to load devices."; }
  }

  private async pair() {
    this.busy = true;
    try {
      const response = await this.request("/api/devices/pairing", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create pairing code.");
      this.pairing = { code: data.code, expiresAt: data.expiresAt };
      this.message = "Use this one-time code on your PC. It expires in five minutes.";
    } catch (error) { this.message = error instanceof Error ? error.message : "Pairing failed."; }
    finally { this.busy = false; }
  }

  private async command(device: EnrolledDevice, command: string, args: Record<string, unknown> = {}) {
    this.commandResult = "Waiting for the local bridge...";
    try {
      const response = await this.request(`/api/devices/${encodeURIComponent(device.id)}/commands`, {
        method: "POST", body: JSON.stringify({ command, args }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Device command failed.");
      this.commandResult = JSON.stringify(data.result, null, 2);
    } catch (error) { this.commandResult = error instanceof Error ? error.message : "Device command failed."; }
  }

  private async revoke(device: EnrolledDevice) {
    try {
      const response = await this.request(`/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Device revocation failed.");
      this.message = "Device credential revoked.";
      await this.refresh();
    } catch (error) { this.message = error instanceof Error ? error.message : "Device revocation failed."; }
  }

  render() {
    return html`
      <div class="space-y-4 p-4 md:p-6">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div><h2 class="text-xl font-semibold text-white">Local devices</h2>
            <p class="muted mt-1 max-w-2xl">Pair your Windows PC with a one-time code. The current connector is read-only: system information, workspace listing and text-file reading only.</p>
          </div>
          <button class="btn" @click=${() => this.refresh()}>Refresh</button>
        </header>
        <section class="panel">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div><h3 class="font-medium">Pair a new PC</h3><p class="muted">Code expires after five minutes and can be used once.</p></div>
            <button class="btn primary" ?disabled=${this.busy} @click=${() => this.pair()}>Generate pairing code</button>
          </div>
          ${this.pairing ? html`<div class="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div class="muted text-emerald-300">One-time pairing code</div>
            <div class="mt-1 break-all font-mono text-2xl font-semibold tracking-widest text-white">${this.pairing.code}</div>
            <div class="muted mt-2">Expires: ${new Date(this.pairing.expiresAt).toLocaleString()}</div>
          </div>` : ""}
          <ol class="muted mt-4 list-decimal space-y-1 pl-5">
            <li>On your Windows PC, open PowerShell in the Maya repository.</li>
            <li>Run <code>scripts/Start-Maya-Bridge.ps1</code>.</li>
            <li>Enter the Maya server URL and this one-time code.</li>
            <li>The device credential is saved locally in your Windows user profile.</li>
          </ol>
        </section>
        <section class="space-y-3">
          <h3 class="font-medium">Enrolled devices</h3>
          ${this.message ? html`<p class="muted">${this.message}</p>` : ""}
          ${this.devices.map(device => html`
            <article class="panel">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div><div class="font-medium">${device.name}</div><div class="muted">${device.platform} · ${device.architecture} · ${device.runtimeVersion}</div></div>
                <div class="flex items-center gap-2"><span class="rounded-full px-2 py-1 text-xs ${device.online ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-800 text-slate-400"}">${device.online ? "Online" : "Offline"}</span>
                  <button class="btn danger" @click=${() => this.revoke(device)}>Revoke</button></div>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button class="btn" ?disabled=${!device.online} @click=${() => this.command(device, "system.info")}>System info</button>
                <button class="btn" ?disabled=${!device.online} @click=${() => this.command(device, "workspace.list", { path: "." })}>List workspace</button>
                <input .value=${this.filePath} aria-label="Workspace relative file path" @input=${(event: Event) => this.filePath = (event.target as HTMLInputElement).value}>
                <button class="btn" ?disabled=${!device.online} @click=${() => this.command(device, "workspace.read_file", { path: this.filePath })}>Read file</button>
              </div>
            </article>
          `)}
        </section>
        ${this.commandResult ? html`<section class="panel"><div class="muted mb-2 uppercase tracking-wide">Command result</div><pre>${this.commandResult}</pre></section>` : ""}
        <p class="muted text-amber-200/80">Safety boundary: no shell, file writes/deletes, browser session access, keystrokes, screenshots, payments or arbitrary application control are enabled.</p>
      </div>
    `;
  }
}
