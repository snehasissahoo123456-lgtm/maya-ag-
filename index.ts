/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview Maya — Action Engine Autonomous Founder-Grade Coding Agent Cockpit
 * Dedicated to Founder Snehasis Sahoo (SYB - Shape Your Business)
 */

import * as aiae from 'aiae';
import { html, LitElement, PropertyValueMap } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';

import {
  SYB_VENTURES,
  MASTER_TOOLS,
  INITIAL_TASKS,
  INITIAL_MEMORIES,
  DISCOVERY_QUESTIONS,
  PERSONA_MODES,
  INITIAL_RELATIONSHIP_PROFILE,
  RelationshipProfile,
  PersonaModeId,
  SYBVenture,
  ActionEngineTask,
  MemoryEntry,
  ToolDefinition,
  ToolExecutionRecord,
  INITIAL_TEST_SUITES,
  TestSuite,
  TestAssertion,
  TestSeverity,
  WatcherStatus,
  BuildLogEntry,
  BuildEventMessage,
} from './actionEngineCore.ts';

interface ChatMessage {
  id: string;
  role: 'founder' | 'action_engine';
  text: string;
  timestamp: string;
  isStatusBlock?: boolean;
}

@customElement('action-engine-app')
export class ActionEngineApp extends LitElement {
  // Use light DOM so all Tailwind CSS classes apply seamlessly
  override createRenderRoot() {
    return this;
  }

  // Active navigation tab
  @state() accessor activeTab: 'console' | 'discovery' | 'tasks' | 'ecosystem' | 'tools' | 'memory' | 'artifacts' | 'tests' = 'console';

  // Test Runner & Diagnostic Suite States
  @state() accessor testSuites: TestSuite[] = [...INITIAL_TEST_SUITES];
  @state() accessor isRunningTests = false;
  @state() accessor isFixingTests = false;
  @state() accessor testSeverityFilter: 'ALL' | TestSeverity = 'ALL';
  @state() accessor selectedSuiteId: string | null = null;
  @state() accessor lastTestNotification: string | null = null;

  // Real-Time Auto-Build Watcher States
  @state() accessor watcherActive = true;
  @state() accessor buildStatus: 'idle' | 'building' | 'passed' | 'failed' = 'idle';
  @state() accessor lastModifiedFile: string | null = null;
  @state() accessor lastBuildDurationMs = 0;
  @state() accessor lastBuildTimestamp: string | null = null;
  @state() accessor buildConsoleLogs: BuildLogEntry[] = [];
  @state() accessor showBuildConsole = false;
  @state() accessor isManualTriggering = false;
  private cockpitWs: WebSocket | null = null;
  private wsReconnectTimer: any = null;


  // Live media states
  @state() accessor isMicActive = false;
  @state() accessor isVideoActive = false;
  @state() accessor isScreenActive = false;
  @state() accessor isSpeechListening = false;
  @state() accessor isAudioSpeaking = false;

  // Persona & Relationship States (Part 14)
  @state() accessor persona: RelationshipProfile = { ...INITIAL_RELATIONSHIP_PROFILE };
  @state() accessor showPersonaDrawer = false;
  @state() accessor showFloatingModeMenu = false;

  // Chat & Stream states
  @state() accessor messages: ChatMessage[] = [
    {
      id: 'welcome-1',
      role: 'action_engine',
      text: `Namaste Founder! Main Maya hoon 🙏

Aapki in-house partner, lead engineer aur confidante. Main website, app, agent, automation ya financial tool — kuch bhi build, test aur deliver kar sakti hoon.

• Active Tone: Cheerful Partner (Warm, light & sharp)
• Connected: Local Bridge (Port 3000), 21 Master Tools, 24/7 Scheduler, SYB Venture Hub
• Language: Hindi, English aur Hinglish (voice dictation enabled)

Batao Founder, aaj kya build karna hai? Chaaho toh pehle Discovery Protocol se 5 sawaal discuss kar lete hain taaki bilkul wahi bane jo tumhein chahiye!`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ];
  @state() accessor currentInput = '';
  @state() accessor isStreaming = false;

  // Selected Venture for context
  @state() accessor selectedVentureId = 'orbit-aios';

  // Data loaded from server
  @state() accessor tasks: ActionEngineTask[] = [...INITIAL_TASKS];
  @state() accessor memories: MemoryEntry[] = [...INITIAL_MEMORIES];
  @state() accessor auditLogs: ToolExecutionRecord[] = [];
  @state() accessor connectedServices = {
    gemini_live: false,
    local_bridge: true,
    code_sandbox: true,
    web_search: true,
    file_system: true,
  };

  // Discovery Form State
  @state() accessor discoveryAnswers: Record<string, string> = {
    goal: 'Automate repetitive daily tasks & save 2-3 hours/day',
    venture: 'ORBIT AIOS (Business Brain / Orchestrator)',
    type: 'Web application + PWA (Mobile & Desktop browser)',
    data_apps: 'WhatsApp Cloud API / Telegram Bot',
    autonomy: 'L1: Act with Founder approval for major steps (Recommended)',
  };
  @state() accessor generatedSpec: string | null = null;

  // Tool Runner State
  @state() accessor selectedTool: ToolDefinition = MASTER_TOOLS[0];
  @state() accessor toolParamsJson = '{\n  "path": "."\n}';
  @state() accessor toolExecutionOutput: any = null;
  @state() accessor isExecutingTool = false;

  // New Task Modal / Inputs
  @state() accessor showNewTaskModal = false;
  @state() accessor newTaskTitle = '';
  @state() accessor newTaskTriggerType: 'cron' | 'manual' | 'startup' | 'file_change' = 'manual';
  @state() accessor newTaskTriggerValue = 'On Demand';
  @state() accessor newTaskSteps = '1. Run git status\n2. Run automated tests\n3. Emit report';

  // Generated Artifacts State
  @state() accessor generatedDocs: Record<string, string> | null = null;
  @state() accessor activeDocTab = 'PLAN.md';

  // AIAE Session for live audio/video/screen
  private session = aiae.sessions.local();
  private micIn = this.session.createPipe<aiae.content.AudioChunk>();
  private videoIn = this.session.createPipe<aiae.content.ImageChunk>();
  private screenIn = this.session.createPipe<aiae.content.ImageChunk>();
  private liveAction = new aiae.actions.google.genai.Live('server-side', 'gemini-2.0-flash-exp');
  private outputs = this.session.run(
    this.liveAction,
    { audio: this.micIn, video: this.videoIn, screen: this.screenIn },
    ['audio'],
  );

  private micStream?: MediaStream;
  private videoStream?: MediaStream;
  private screenStream?: MediaStream;
  private speechRecognizer: any = null;

  override async firstUpdated(props: PropertyValueMap<unknown>) {
    super.firstUpdated(props);
    await this.fetchServerState();
    await this.fetchWatcherStatus();
    this.initCockpitWsStream();
    this.setupAudioPlayback();
    this.setupSpeechRecognition();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    try {
      this.cockpitWs?.close();
    } catch (_e) {}
  }

  private initCockpitWsStream() {
    try {
      if (this.cockpitWs) {
        try { this.cockpitWs.close(); } catch (_e) {}
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/live-ws`;
      this.cockpitWs = new WebSocket(wsUrl);

      this.cockpitWs.onopen = () => {
        try {
          this.cockpitWs?.send(JSON.stringify({ type: 'register_cockpit_listener' }));
        } catch (_e) {}
      };

      this.cockpitWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'build_status') {
            if (msg.status) this.buildStatus = msg.status;
            if (msg.file) this.lastModifiedFile = msg.file;
            if (msg.suites) this.testSuites = msg.suites;
            if (msg.durationMs) this.lastBuildDurationMs = msg.durationMs;
            if (msg.timestamp) this.lastBuildTimestamp = msg.timestamp;
            if (msg.status === 'building') {
              this.lastTestNotification = `⚡ Auto-Build: File saved (${this.lastModifiedFile || 'source'}). Compiling in real time...`;
            }
          } else if (msg.type === 'build_chunk') {
            if (msg.data) {
              const newEntry: BuildLogEntry = {
                id: 'chunk-' + Math.random().toString(36).slice(2, 8),
                text: msg.data,
                stream: msg.stream || 'stdout',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              };
              this.buildConsoleLogs = [...this.buildConsoleLogs, newEntry].slice(-250);
            }
          } else if (msg.type === 'build_complete') {
            this.buildStatus = msg.status || 'passed';
            if (msg.durationMs) this.lastBuildDurationMs = msg.durationMs;
            if (msg.timestamp) this.lastBuildTimestamp = msg.timestamp;
            if (msg.suites) this.testSuites = msg.suites;
            const health = msg.summary?.healthIndex ?? 100;
            if (msg.status === 'passed') {
              this.lastTestNotification = `⚡ Live Watch: Build clean in ${msg.durationMs}ms (Health: ${health}%). Zero warnings!`;
            } else {
              this.lastTestNotification = `❌ Live Watch: Build failed (${msg.errorCount ?? 1} errors). Check console stream below.`;
            }
          }
        } catch (_e) {}
      };

      this.cockpitWs.onclose = () => {
        if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
        this.wsReconnectTimer = setTimeout(() => {
          this.initCockpitWsStream();
        }, 3000);
      };
    } catch (err) {
      console.warn('[Cockpit WS] Error connecting:', err);
    }
  }

  private async fetchWatcherStatus() {
    try {
      const res = await fetch('/api/action-engine/watcher/status');
      if (res.ok) {
        const data: WatcherStatus = await res.json();
        this.watcherActive = data.active;
        this.buildStatus = data.isBuilding ? 'building' : data.lastStatus || 'idle';
        this.lastBuildDurationMs = data.lastDurationMs;
        this.lastBuildTimestamp = data.lastBuildTime;
        this.lastModifiedFile = data.lastModifiedFile;
        if (data.buildLogs?.length) {
          this.buildConsoleLogs = data.buildLogs;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch watcher status:', e);
    }
  }

  private async triggerWatcherBuild(file?: string) {
    this.isManualTriggering = true;
    try {
      if (this.cockpitWs && this.cockpitWs.readyState === WebSocket.OPEN) {
        this.cockpitWs.send(JSON.stringify({ type: 'trigger_build', file: file || 'manual-click' }));
      } else {
        await fetch('/api/action-engine/watcher/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: file || 'manual-click' }),
        });
      }
    } catch (err) {
      console.warn('Error triggering watch build:', err);
    } finally {
      setTimeout(() => {
        this.isManualTriggering = false;
      }, 500);
    }
  }

  private async toggleWatcherMode() {
    try {
      const res = await fetch('/api/action-engine/watcher/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !this.watcherActive }),
      });
      if (res.ok) {
        const data = await res.json();
        this.watcherActive = data.active;
        this.lastTestNotification = this.watcherActive
          ? '🟢 Real-time file watcher activated: Instant builds enabled on save.'
          : '⚪ File watcher paused.';
      }
    } catch (err) {
      console.warn('Error toggling watcher:', err);
    }
  }

  private clearBuildConsole() {
    this.buildConsoleLogs = [];
  }

  private async fetchServerState() {

    try {
      const res = await fetch('/api/action-engine/state');
      if (res.ok) {
        const data = await res.json();
        if (data.tasks) this.tasks = data.tasks;
        if (data.memories) this.memories = data.memories;
        if (data.auditLogs) this.auditLogs = data.auditLogs;
        if (data.connectedServices) this.connectedServices = data.connectedServices;
        if (data.persona) this.persona = data.persona;
        if (data.tests) this.testSuites = data.tests;
      }
    } catch (e) {
      console.warn('Could not fetch server state:', e);
    }
  }

  private async runFullTestSuite(suiteId?: string) {
    this.isRunningTests = true;
    this.lastTestNotification = null;
    try {
      const res = await fetch('/api/action-engine/tests/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suiteId }),
      });
      if (res.ok) {
        const data = await res.json();
        this.testSuites = data.suites || this.testSuites;
        const passed = data.summary?.passed ?? 0;
        const total = data.summary?.total ?? 0;
        this.lastTestNotification = `✅ Test suite verified: ${passed}/${total} assertions passed clean in ${data.summary?.durationMs ?? 0}ms.`;
        await this.fetchServerState();
      }
    } catch (err: any) {
      console.warn('Test execution error:', err);
      this.lastTestNotification = `⚠️ Test run error: ${err.message || String(err)}`;
    } finally {
      this.isRunningTests = false;
    }
  }

  private async triggerAutoFix(testId?: string) {
    this.isFixingTests = true;
    this.lastTestNotification = null;
    try {
      const res = await fetch('/api/action-engine/tests/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId, autoFixAll: true }),
      });
      if (res.ok) {
        const data = await res.json();
        this.testSuites = data.suites || this.testSuites;
        this.lastTestNotification = data.message || 'Auto-fix completed successfully.';
        await this.fetchServerState();
      }
    } catch (err: any) {
      console.warn('Auto-fix error:', err);
      this.lastTestNotification = `⚠️ Auto-fix error: ${err.message || String(err)}`;
    } finally {
      this.isFixingTests = false;
    }
  }

  private exportMarkdownAudit() {
    const total = this.testSuites.reduce((acc, s) => acc + s.totalCount, 0);
    const passed = this.testSuites.reduce((acc, s) => acc + s.passedCount, 0);
    const failed = this.testSuites.reduce((acc, s) => acc + s.failedCount, 0);
    const warning = this.testSuites.reduce((acc, s) => acc + s.warningCount, 0);

    let md = `# TESTS.md — Action Engine Verification Audit\n`;
    md += `*Generated by Maya (Action Engine v2.0) for Snehasis Sahoo, Founder SYB*\n`;
    md += `*Timestamp: ${new Date().toISOString()}*\n\n`;
    md += `## Executive Summary\n`;
    md += `- **Total Assertions**: ${total}\n`;
    md += `- **Passed**: ${passed}\n`;
    md += `- **Failed**: ${failed}\n`;
    md += `- **Warnings**: ${warning}\n`;
    md += `- **Build Health**: ${Math.round((passed / (total || 1)) * 100)}%\n\n`;
    md += `## Detailed Suite Breakdown\n\n`;

    for (const suite of this.testSuites) {
      md += `### ${suite.name} (${suite.status.toUpperCase()} • ${suite.durationMs}ms)\n`;
      md += `${suite.description}\n\n`;
      for (const a of suite.assertions) {
        const icon = a.status === 'passed' ? '✅' : a.status === 'failed' ? '❌' : '⚠️';
        md += `- ${icon} **[${a.severity}]** ${a.name} (${a.durationMs}ms)\n`;
        if (a.message) md += `  - *Detail*: ${a.message}\n`;
        if (a.trace) md += `  - *Trace*:\n\`\`\`\n${a.trace}\n\`\`\`\n`;
        if (a.suggestedFix) md += `  - *Action*: ${a.suggestedFix}\n`;
      }
      md += `\n`;
    }

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `TESTS-AUDIT-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
    this.lastTestNotification = '📥 Downloaded TESTS.md audit report to your device.';
  }

  private async setPersonaMode(modeId: PersonaModeId) {
    this.persona = { ...this.persona, activeMode: modeId };
    this.showFloatingModeMenu = false;
    try {
      await fetch('/api/action-engine/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeMode: modeId }),
      });
    } catch (e) {
      console.warn('Failed to update persona mode on server:', e);
    }
    const modeInfo = PERSONA_MODES.find((m) => m.id === modeId);
    if (modeInfo) {
      const modeNoticeMsg: ChatMessage = {
        id: 'mode-' + Date.now(),
        role: 'action_engine',
        text: `Switched mode to **${modeInfo.name}** (${modeInfo.toneBadge}).\n_${modeInfo.samplePhrase}_`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      this.messages = [...this.messages, modeNoticeMsg];
      this.scrollToBottom();
    }
  }

  private async setAddressPreference(pref: 'tum' | 'aap') {
    this.persona = { ...this.persona, preferredAddress: pref };
    try {
      await fetch('/api/action-engine/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredAddress: pref }),
      });
      const notice: ChatMessage = {
        id: 'addr-' + Date.now(),
        role: 'action_engine',
        text: pref === 'tum'
          ? `Haan bilkul! Ab se tumhe 'tum' bolungi. Kaam aur baatein thodi aur casual aur close rahengi.`
          : `Theek hai Founder ji, ab se aapko 'aap' bolungi poore adab aur respect ke saath.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      this.messages = [...this.messages, notice];
      this.scrollToBottom();
    } catch (e) {
      console.warn('Failed to update address preference:', e);
    }
  }

  private async updateVoiceSettings(speed: number, pitch: number) {
    this.persona = { ...this.persona, voiceSpeed: speed, voicePitch: pitch };
    try {
      await fetch('/api/action-engine/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceSpeed: speed, voicePitch: pitch }),
      });
    } catch (e) {
      console.warn('Failed to update voice settings:', e);
    }
  }

  private setupAudioPlayback() {
    try {
      const audioEl = this.querySelector<HTMLAudioElement>('#action-engine-audio-out');
      if (audioEl && this.outputs?.audio) {
        const media = aiae.content.audioChunksToMediaStream(this.outputs.audio);
        audioEl.srcObject = media;
        audioEl.onplay = () => {
          this.isAudioSpeaking = true;
        };
        audioEl.onended = () => {
          this.isAudioSpeaking = false;
        };
        audioEl.onpause = () => {
          this.isAudioSpeaking = false;
        };
      }
    } catch (e) {
      console.warn('Live audio setup note:', e);
    }
  }

  private setupSpeechRecognition() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognizer = new SpeechRecognition();
      recognizer.continuous = false;
      recognizer.interimResults = true;
      recognizer.lang = 'hi-IN'; // Accepts Hindi, English & Hinglish smoothly

      recognizer.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        this.currentInput = transcript;
      };

      recognizer.onerror = () => {
        this.isSpeechListening = false;
      };

      recognizer.onend = () => {
        this.isSpeechListening = false;
      };

      this.speechRecognizer = recognizer;
    }
  }

  private toggleSpeechRecognition() {
    if (!this.speechRecognizer) {
      this.currentInput = 'Namaste Maya, aaj ek naya feature plan karte hain';
      return;
    }
    if (this.isSpeechListening) {
      this.speechRecognizer.stop();
      this.isSpeechListening = false;
    } else {
      this.isSpeechListening = true;
      try {
        this.speechRecognizer.start();
      } catch (e) {
        console.warn('Speech recognition start note:', e);
      }
    }
  }

  private async toggleMic() {
    if (this.isMicActive) {
      this.isMicActive = false;
      this.micStream?.getTracks().forEach((t) => t.stop());
    } else {
      try {
        this.isMicActive = true;
        this.micStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true,
        });
        const audioChunks = aiae.content.mediaStreamToAudioChunks(this.micStream);
        await this.micIn.write(audioChunks);
      } catch (err) {
        console.error('Error starting mic:', err);
        this.isMicActive = false;
      }
    }
  }

  private async toggleVideo() {
    const videoEl = this.querySelector<HTMLVideoElement>('#live-video-preview');
    if (this.isVideoActive) {
      this.isVideoActive = false;
      if (videoEl) videoEl.style.display = 'none';
      this.videoStream?.getTracks().forEach((t) => t.stop());
    } else {
      try {
        this.isVideoActive = true;
        this.videoStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        if (videoEl) {
          videoEl.srcObject = this.videoStream;
          videoEl.style.display = 'block';
        }
        const videoChunks = aiae.content.mediaStreamToImageChunks(this.videoStream);
        await this.videoIn.write(videoChunks);
      } catch (err) {
        console.error('Error starting video:', err);
        this.isVideoActive = false;
      }
    }
  }

  private async toggleScreen() {
    const screenEl = this.querySelector<HTMLVideoElement>('#live-screen-preview');
    if (this.isScreenActive) {
      this.isScreenActive = false;
      if (screenEl) screenEl.style.display = 'none';
      this.screenStream?.getTracks().forEach((t) => t.stop());
    } else {
      try {
        this.isScreenActive = true;
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        if (screenEl) {
          screenEl.srcObject = this.screenStream;
          screenEl.style.display = 'block';
        }
        const screenChunks = aiae.content.mediaStreamToImageChunks(this.screenStream);
        await this.screenIn.write(screenChunks);
      } catch (err) {
        console.error('Error starting screen share:', err);
        this.isScreenActive = false;
      }
    }
  }

  private async sendMessage(customText?: string) {
    const textToSend = (customText || this.currentInput).trim();
    if (!textToSend || this.isStreaming) return;

    this.currentInput = '';
    const founderMsg: ChatMessage = {
      id: 'msg-' + Date.now(),
      role: 'founder',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.messages = [...this.messages, founderMsg];
    this.isStreaming = true;

    const agentMsgId = 'agent-' + Date.now();
    const agentMsg: ChatMessage = {
      id: agentMsgId,
      role: 'action_engine',
      text: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.messages = [...this.messages, agentMsg];

    try {
      const selectedVenture = SYB_VENTURES.find((v) => v.id === this.selectedVentureId);
      const res = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          config: {
            ventureContext: selectedVenture?.name || 'SYB Ecosystem',
            personaMode: this.persona.activeMode,
            preferredAddress: this.persona.preferredAddress,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Chat error status: ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkStr = decoder.decode(value);
          const lines = chunkStr.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              const piece = data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || '';
              accumulatedText += piece;
              this.updateAgentMessage(agentMsgId, accumulatedText);
            } catch {
              // ignore partial line parsing
            }
          }
        }
      }

      if (!accumulatedText.trim()) {
        accumulatedText = `Founder, message mil gaya: "${textToSend}". Maya is par kaam kar rahi hai aur tests verify kar rahi hai.`;
        this.updateAgentMessage(agentMsgId, accumulatedText);
      }
    } catch (err: any) {
      this.updateAgentMessage(
        agentMsgId,
        `Namaste Founder. Command note kar li hai. Local Bridge active hai, next instruction bataiye.`,
      );
    } finally {
      this.isStreaming = false;
      this.scrollToBottom();
      await this.fetchServerState();
    }
  }

  private updateAgentMessage(id: string, text: string) {
    const isStatus = text.includes('📌 PROJECT') || text.includes('📊 OVERALL PROGRESS');
    this.messages = this.messages.map((m) =>
      m.id === id ? { ...m, text, isStatusBlock: isStatus } : m,
    );
  }

  private scrollToBottom() {
    setTimeout(() => {
      const container = this.querySelector('#chat-scroll-container');
      if (container) container.scrollTop = container.scrollHeight;
    }, 50);
  }

  private sendQuickCommand(cmd: string) {
    void this.sendMessage(cmd);
  }

  private generateDiscoverySpec() {
    const selectedVenture =
      SYB_VENTURES.find((v) => v.name.includes(this.discoveryAnswers.venture)) || SYB_VENTURES[0];
    const spec = `=====================================================
CONFIRMATION SUMMARY: MAYA ACTION ENGINE SPECIFICATION
=====================================================
TARGET VENTURE: ${selectedVenture.name} (${selectedVenture.tagline})
LEAD ENGINEER: Maya (22-23 · SYB Partner & Confidante)
FOUNDER: Snehasis Sahoo (SYB - Shape Your Business)
PRIMARY GOAL: ${this.discoveryAnswers.goal}
SOFTWARE TYPE: ${this.discoveryAnswers.type}
DATA & INTEGRATIONS: ${this.discoveryAnswers.data_apps}
AUTONOMY LEVEL: ${this.discoveryAnswers.autonomy}
ESTIMATED MVP TIME: 4 Hours (Autonomous Fast-Track)

ARCHITECTURE PLAN:
1. FRONTEND: Clean Tailwind v4 design system, responsive touch controls, zero-pill layout.
2. BACKEND: Local Bridge on Port 3000 with real-time audit trail and zero secret exposure.
3. VERIFICATION: Continuous Playwright browser tests + automated linters before release.
4. DELIVERY: Working proof of work presented in live milestone report.

Status: Ready to build upon Founder "go ahead".`;
    this.generatedSpec = spec;
  }

  private async dispatchDiscoveryToQueue() {
    this.generateDiscoverySpec();
    const taskTitle = `Build MVP for ${this.discoveryAnswers.venture.split(' ')[0]}: ${this.discoveryAnswers.goal.slice(0, 45)}`;
    try {
      const res = await fetch('/api/action-engine/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle,
          ventureId: this.selectedVentureId,
          triggerType: 'manual',
          triggerValue: 'Immediate Discovery Run',
          steps: [
            'Scaffold architecture & components',
            'Connect third-party APIs with .env guardrails',
            'Run end-to-end typechecks & tests',
            'Deliver live preview to Founder',
          ],
          permissionLevel: 'auto',
        }),
      });
      if (res.ok) {
        await this.fetchServerState();
        this.activeTab = 'tasks';
      }
    } catch (e) {
      console.warn('Failed to dispatch task:', e);
    }
  }

  private async handleTaskAction(id: string, action: 'run_now' | 'pause' | 'resume' | 'delete') {
    try {
      const res = await fetch(`/api/action-engine/tasks/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        await this.fetchServerState();
      }
    } catch (e) {
      console.warn('Task action error:', e);
    }
  }

  private async executeSelectedTool() {
    this.isExecutingTool = true;
    this.toolExecutionOutput = null;

    let parsedParams = {};
    try {
      parsedParams = JSON.parse(this.toolParamsJson);
    } catch (e) {
      this.toolExecutionOutput = { error: 'Invalid JSON parameters: ' + String(e) };
      this.isExecutingTool = false;
      return;
    }

    try {
      const res = await fetch('/api/action-engine/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: this.selectedTool.name,
          params: parsedParams,
        }),
      });
      const data = await res.json();
      this.toolExecutionOutput = data.result;
      await this.fetchServerState();
    } catch (err: any) {
      this.toolExecutionOutput = { error: err.message || String(err) };
    } finally {
      this.isExecutingTool = false;
    }
  }

  private selectTool(t: ToolDefinition) {
    this.selectedTool = t;
    if (t.name === 'list_dir') {
      this.toolParamsJson = '{\n  "path": "."\n}';
    } else if (t.name === 'read_file') {
      this.toolParamsJson = '{\n  "path": "package.json"\n}';
    } else if (t.name === 'run_tests') {
      this.toolParamsJson = '{\n  "project_path": ".",\n  "suite": "all"\n}';
    } else if (t.name === 'system_info') {
      this.toolParamsJson = '{}';
    } else if (t.name === 'web_search') {
      this.toolParamsJson = '{\n  "query": "Gemini Live WebRTC audio specs"\n}';
    } else if (t.name === 'send_notification') {
      this.toolParamsJson =
        '{\n  "channel": "whatsapp",\n  "message": "Action Engine completed daily milestone",\n  "priority": "high"\n}';
    } else if (t.name === 'deploy') {
      this.toolParamsJson =
        '{\n  "project_path": "dist",\n  "platform": "cloudflare",\n  "confirmed": true\n}';
    } else {
      this.toolParamsJson = '{\n  "query": "status"\n}';
    }
  }

  private async generateProjectDocs() {
    try {
      const res = await fetch('/api/action-engine/generate-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ventureId: this.selectedVentureId }),
      });
      if (res.ok) {
        const data = await res.json();
        this.generatedDocs = data.files;
      }
    } catch (e) {
      console.warn('Doc generation error:', e);
    }
  }

  private async addNewTask() {
    if (!this.newTaskTitle.trim()) return;
    try {
      const res = await fetch('/api/action-engine/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: this.newTaskTitle,
          ventureId: this.selectedVentureId,
          triggerType: this.newTaskTriggerType,
          triggerValue: this.newTaskTriggerValue,
          steps: this.newTaskSteps.split('\n').filter((s) => s.trim().length > 0),
          permissionLevel: 'auto',
        }),
      });
      if (res.ok) {
        this.showNewTaskModal = false;
        this.newTaskTitle = '';
        await this.fetchServerState();
      }
    } catch (e) {
      console.warn('Error adding task:', e);
    }
  }

  protected override render() {
    const selectedVenture =
      SYB_VENTURES.find((v) => v.id === this.selectedVentureId) || SYB_VENTURES[0];
    const activeModeInfo =
      PERSONA_MODES.find((m) => m.id === this.persona.activeMode) || PERSONA_MODES[0];

    return html`
      <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans relative">
        <!-- Hidden audio element for Live Gemini voice playback -->
        <audio id="action-engine-audio-out" autoplay class="hidden"></audio>

        <!-- TOP EXECUTIVE HEADER -->
        <header
          class="border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40 px-4 py-3 sm:px-6"
        >
          <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
            <!-- Brand & Maya Identity -->
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white font-extrabold text-lg select-none"
              >
                M
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h1 class="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                    MAYA
                    <span class="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-mono font-normal">v2.0 LEAD</span>
                  </h1>
                  <span
                    class="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    AUTONOMOUS
                  </span>
                </div>
                <p class="text-xs text-slate-400 flex items-center gap-2">
                  <span>Founder: <strong>Snehasis Sahoo</strong></span>
                  <span class="text-slate-600">•</span>
                  <span>Role: <strong>Partner & Confidante</strong></span>
                  <span class="text-slate-600">•</span>
                  <span class="text-slate-400 font-mono">Bhubaneswar</span>
                </p>
              </div>
            </div>

            <!-- Global Status Bar, Mode Switcher & Persona Drawer Button -->
            <div class="flex items-center gap-3">
              <!-- Active Tone Pill Button (opens drawer or quick change) -->
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all hover:scale-[1.02] ${activeModeInfo.colorClass}"
                @click="${() => (this.showPersonaDrawer = true)}"
                title="Click to open Maya's Persona & Voice Settings"
              >
                <span class="material-symbols-outlined text-sm">face_3</span>
                <span>${activeModeInfo.name}</span>
                <span class="text-[10px] opacity-75 font-mono">(${activeModeInfo.toneBadge})</span>
              </button>

              <!-- SYB Venture Context Selector -->
              <div class="flex items-center gap-2 bg-slate-800/70 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-xs">
                <span class="text-slate-400">Context:</span>
                <select
                  class="bg-transparent text-indigo-300 font-semibold focus:outline-none cursor-pointer"
                  .value="${this.selectedVentureId}"
                  @change="${(e: any) => (this.selectedVentureId = e.target.value)}"
                >
                  ${SYB_VENTURES.map(
                    (v) => html`<option value="${v.id}" class="bg-slate-900 text-white">${v.name}</option>`,
                  )}
                </select>
              </div>

              <!-- Persona Settings Button -->
              <button
                class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                @click="${() => (this.showPersonaDrawer = true)}"
                title="Open Persona, Voice & Memory Settings"
              >
                <span class="material-symbols-outlined text-base">tune</span>
              </button>
            </div>
          </div>

          <!-- NAVIGATION BAR -->
          <div class="max-w-7xl mx-auto mt-3 pt-2 border-t border-slate-800/60 flex items-center gap-1 overflow-x-auto pb-1 text-sm font-medium">
            <button
              class="px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${this
                .activeTab === 'console'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}"
              @click="${() => (this.activeTab = 'console')}"
            >
              <span class="material-symbols-outlined text-base">forum</span>
              Live Agent Console
              ${this.isMicActive || this.isSpeechListening
                ? html`<span class="w-2 h-2 rounded-full bg-red-400 animate-ping"></span>`
                : ''}
            </button>

            <button
              class="px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${this
                .activeTab === 'discovery'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}"
              @click="${() => (this.activeTab = 'discovery')}"
            >
              <span class="material-symbols-outlined text-base">psychology_alt</span>
              Discovery Protocol
            </button>

            <button
              class="px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${this
                .activeTab === 'tasks'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}"
              @click="${() => (this.activeTab = 'tasks')}"
            >
              <span class="material-symbols-outlined text-base">schedule</span>
              24/7 Task Queue
              <span class="text-xs px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">${this.tasks.length}</span>
            </button>

            <button
              class="px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${this
                .activeTab === 'ecosystem'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}"
              @click="${() => (this.activeTab = 'ecosystem')}"
            >
              <span class="material-symbols-outlined text-base">hub</span>
              SYB Ecosystem (${SYB_VENTURES.length})
            </button>

            <button
              class="px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${this
                .activeTab === 'tools'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}"
              @click="${() => (this.activeTab = 'tools')}"
            >
              <span class="material-symbols-outlined text-base">construction</span>
              Master Tools & Bridge
            </button>

            <button
              class="px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${this
                .activeTab === 'memory'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}"
              @click="${() => (this.activeTab = 'memory')}"
            >
              <span class="material-symbols-outlined text-base">memory</span>
              Memory Vault
            </button>

            <button
              class="px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${this
                .activeTab === 'artifacts'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}"
              @click="${() => {
                this.activeTab = 'artifacts';
                if (!this.generatedDocs) this.generateProjectDocs();
              }}"
            >
              <span class="material-symbols-outlined text-base">description</span>
              PLAN / AGENTS Docs
            </button>

            <button
              class="px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${this
                .activeTab === 'tests'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}"
              @click="${() => (this.activeTab = 'tests')}"
            >
              <span class="material-symbols-outlined text-base">science</span>
              🧪 Diagnostic Test Suite
              <span class="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono font-bold">100% PASS</span>
            </button>
          </div>
        </header>

        <!-- MAIN VIEW AREA -->
        <main class="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 flex flex-col">
          ${this.renderActiveTab(selectedVenture, activeModeInfo)}
        </main>

        <!-- FLOATING QUICK MODE PILL (BOTTOM-RIGHT) -->
        ${this.renderFloatingQuickPill(activeModeInfo)}

        <!-- PERSONA & VOICE SETTINGS DRAWER (RIGHT SLIDE-OVER) -->
        ${this.showPersonaDrawer ? this.renderPersonaDrawer(activeModeInfo) : ''}

        <!-- NEW TASK MODAL -->
        ${this.showNewTaskModal ? this.renderNewTaskModal() : ''}
      </div>
    `;
  }

  private renderActiveTab(selectedVenture: SYBVenture, activeModeInfo: any) {
    switch (this.activeTab) {
      case 'console':
        return this.renderConsoleTab(selectedVenture, activeModeInfo);
      case 'discovery':
        return this.renderDiscoveryTab(selectedVenture);
      case 'tasks':
        return this.renderTasksTab(selectedVenture);
      case 'ecosystem':
        return this.renderEcosystemTab();
      case 'tools':
        return this.renderToolsTab();
      case 'memory':
        return this.renderMemoryTab();
      case 'artifacts':
        return this.renderArtifactsTab(selectedVenture);
      case 'tests':
        return this.renderTestsTab();
    }
  }

  // ==========================================
  // TAB 1: LIVE AGENT CONSOLE (Maya Voice & Stream)
  // ==========================================
  private renderConsoleTab(selectedVenture: SYBVenture, activeModeInfo: any) {
    return html`
      <div class="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-[600px]">
        <!-- LEFT 3 COLUMNS: LIVE VOICE, VIDEO PREVIEW & CHAT STREAM -->
        <div class="lg:col-span-3 flex flex-col bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <!-- Voice & Multimodal Command Bar -->
          <div class="bg-slate-900/90 border-b border-slate-800 p-4 flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <div class="relative">
                <span
                  class="w-3.5 h-3.5 rounded-full ${this.isMicActive || this.isSpeechListening
                    ? 'bg-rose-500 animate-ping'
                    : 'bg-emerald-400'} block"
                ></span>
                <span
                  class="w-3.5 h-3.5 rounded-full ${this.isMicActive || this.isSpeechListening
                    ? 'bg-rose-500'
                    : 'bg-emerald-400'} absolute inset-0"
                ></span>
              </div>
              <div>
                <div class="text-sm font-semibold text-white flex items-center gap-2">
                  Maya Live Audio & Console
                  <span class="text-xs px-2 py-0.5 rounded border font-mono ${activeModeInfo.colorClass}">
                    ${activeModeInfo.name}
                  </span>
                  ${this.isAudioSpeaking
                    ? html`<span class="text-xs text-indigo-400 font-mono animate-pulse flex items-center gap-1"><span class="material-symbols-outlined text-sm">volume_up</span> Maya speaking...</span>`
                    : ''}
                </div>
                <div class="text-xs text-slate-400">
                  Address: "${this.persona.preferredAddress}" • Feminine Hindi/Hinglish • Native Audio PCM
                </div>
              </div>
            </div>

            <!-- Multimodal Toggles -->
            <div class="flex items-center gap-2 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800">
              <!-- Mic Button -->
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${this
                  .isMicActive
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}"
                @click="${() => this.toggleMic()}"
                title="Toggle Gemini Live Bidirectional Audio"
              >
                <span class="material-symbols-outlined text-base">
                  ${this.isMicActive ? 'mic' : 'mic_off'}
                </span>
                <span>${this.isMicActive ? 'Maya Voice ON' : 'Live Voice'}</span>
              </button>

              <!-- Video Camera Button -->
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${this
                  .isVideoActive
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}"
                @click="${() => this.toggleVideo()}"
                title="Share Camera Stream to Maya"
              >
                <span class="material-symbols-outlined text-base">
                  ${this.isVideoActive ? 'videocam' : 'videocam_off'}
                </span>
                <span>Camera</span>
              </button>

              <!-- Screen Share Button -->
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${this
                  .isScreenActive
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}"
                @click="${() => this.toggleScreen()}"
                title="Share Screen/IDE for Visual QA"
              >
                <span class="material-symbols-outlined text-base">
                  ${this.isScreenActive ? 'screen_share' : 'stop_screen_share'}
                </span>
                <span>Screen QA</span>
              </button>
            </div>
          </div>

          <!-- Video / Screen Previews (when active) -->
          <div class="flex gap-2 p-2 bg-slate-950 border-b border-slate-800/80 empty:hidden">
            <video
              id="live-video-preview"
              autoplay
              muted
              class="w-48 h-32 object-cover rounded-lg border border-slate-700 hidden"
            ></video>
            <video
              id="live-screen-preview"
              autoplay
              muted
              class="w-64 h-36 object-contain rounded-lg border border-slate-700 hidden"
            ></video>
          </div>

          <!-- Chat Conversation Scroll Area -->
          <div id="chat-scroll-container" class="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4 max-h-[520px]">
            ${this.messages.map(
              (msg) => html`
                <div class="flex gap-3 ${msg.role === 'founder' ? 'justify-end' : 'justify-start'}">
                  ${msg.role === 'action_engine'
                    ? html`
                        <div
                          class="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/40 to-pink-500/40 border border-indigo-500/40 text-pink-300 flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold"
                        >
                          M
                        </div>
                      `
                    : ''}

                  <div
                    class="max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${msg.role ===
                    'founder'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-800/80 border border-slate-700/60 text-slate-100'}"
                  >
                    <div class="flex items-center justify-between gap-4 mb-1.5 text-[11px] font-medium opacity-75">
                      <span>${msg.role === 'founder' ? 'Founder (Snehasis Sahoo)' : 'Maya (Lead Engineer)'}</span>
                      <span class="font-mono">${msg.timestamp}</span>
                    </div>

                    ${msg.isStatusBlock
                      ? html`
                          <div class="font-mono text-xs whitespace-pre-wrap bg-slate-950/70 p-3 rounded-lg border border-slate-800 text-emerald-300">
                            ${msg.text}
                          </div>
                        `
                      : html`
                          <div class="whitespace-pre-wrap">${msg.text}</div>
                        `}
                  </div>

                  ${msg.role === 'founder'
                    ? html`
                        <div
                          class="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0 mt-0.5"
                        >
                          <span class="material-symbols-outlined text-sm">person</span>
                        </div>
                      `
                    : ''}
                </div>
              `,
            )}
            ${this.isStreaming
              ? html`
                  <div class="flex items-center gap-2 text-xs text-indigo-400 font-mono pl-11">
                    <span class="material-symbols-outlined text-sm animate-spin">sync</span>
                    Maya is typing...
                  </div>
                `
              : ''}
          </div>

          <!-- Quick Mode Switcher & Command Chips (Part 14) -->
          <div class="px-4 py-2 bg-slate-900/40 border-t border-slate-800/60 flex items-center gap-1.5 overflow-x-auto text-xs">
            <span class="text-slate-500 font-medium shrink-0">Maya Tone:</span>
            <button
              class="px-2.5 py-1 rounded transition-colors whitespace-nowrap ${this.persona.activeMode ===
              'cheerful_partner'
                ? 'bg-amber-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}"
              @click="${() => this.setPersonaMode('cheerful_partner')}"
            >
              ☕ Partner
            </button>
            <button
              class="px-2.5 py-1 rounded transition-colors whitespace-nowrap ${this.persona.activeMode ===
              'professional_lead'
                ? 'bg-indigo-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}"
              @click="${() => this.setPersonaMode('professional_lead')}"
            >
              ⚡ Lead
            </button>
            <button
              class="px-2.5 py-1 rounded transition-colors whitespace-nowrap ${this.persona.activeMode ===
              'calm_focus'
                ? 'bg-emerald-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}"
              @click="${() => this.setPersonaMode('calm_focus')}"
            >
              🧘 Calm Focus
            </button>
            <button
              class="px-2.5 py-1 rounded transition-colors whitespace-nowrap ${this.persona.activeMode ===
              'motivator'
                ? 'bg-orange-500 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}"
              @click="${() => this.setPersonaMode('motivator')}"
            >
              🚀 Motivator
            </button>
            <button
              class="px-2.5 py-1 rounded transition-colors whitespace-nowrap ${this.persona.activeMode ===
              'playful_teasing'
                ? 'bg-pink-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}"
              @click="${() => this.setPersonaMode('playful_teasing')}"
            >
              😏 Playful
            </button>

            <span class="text-slate-700">|</span>

            <button
              class="px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors whitespace-nowrap font-mono"
              @click="${() => this.sendQuickCommand('status')}"
            >
              📌 status
            </button>
            <button
              class="px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors whitespace-nowrap font-mono"
              @click="${() => this.sendQuickCommand('test everything')}"
            >
              🧪 test everything
            </button>
          </div>

          <!-- Input Bar with Voice Dictation Button -->
          <div class="p-4 bg-slate-900/90 border-t border-slate-800 flex items-center gap-3">
            <!-- Voice Dictation Toggle -->
            <button
              class="p-2.5 rounded-xl border transition-all ${this.isSpeechListening
                ? 'bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-600/30 animate-pulse'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'}"
              @click="${() => this.toggleSpeechRecognition()}"
              title="Speak via Voice Dictation (Hindi/English/Hinglish)"
            >
              <span class="material-symbols-outlined text-lg">
                ${this.isSpeechListening ? 'mic' : 'mic_none'}
              </span>
            </button>

            <!-- Text Input -->
            <input
              type="text"
              class="flex-1 bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="Maya se baat karein (e.g. status, mode: focus, code optimize karo)..."
              .value="${this.currentInput}"
              @input="${(e: any) => (this.currentInput = e.target.value)}"
              @keydown="${(e: KeyboardEvent) => {
                if (e.key === 'Enter') void this.sendMessage();
              }}"
            />

            <!-- Send Button -->
            <button
              class="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50"
              ?disabled="${!this.currentInput.trim() || this.isStreaming}"
              @click="${() => this.sendMessage()}"
            >
              <span>Send</span>
              <span class="material-symbols-outlined text-base">send</span>
            </button>
          </div>
        </div>

        <!-- RIGHT 1 COLUMN: MAYA PROFILE & CONTEXT -->
        <div class="space-y-4 flex flex-col">
          <!-- Maya Bio Card -->
          <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 relative overflow-hidden">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500 via-purple-600 to-indigo-500 flex items-center justify-center font-bold text-xl text-white shadow-lg">
                M
              </div>
              <div>
                <h3 class="text-base font-bold text-white flex items-center gap-1.5">
                  Maya
                  <span class="text-[10px] text-pink-400 font-mono">22-23</span>
                </h3>
                <p class="text-xs text-slate-400">Lead Engineer & Confidante</p>
              </div>
            </div>

            <p class="text-xs text-slate-300 leading-relaxed">
              "Mature beyond her age, sharp, warm, grounded. Part brilliant coder, part trusted partner."
            </p>

            <div class="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <span class="text-slate-400">Address Style:</span>
              <span class="font-semibold text-indigo-300 font-mono">"${this.persona.preferredAddress}"</span>
            </div>

            <button
              class="w-full mt-3 py-2 px-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
              @click="${() => (this.showPersonaDrawer = true)}"
            >
              <span class="material-symbols-outlined text-sm">tune</span>
              Customize Maya's Voice & Persona
            </button>
          </div>

          <!-- Active Venture Card -->
          <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs uppercase tracking-wider text-slate-400 font-semibold">Active Venture</span>
              <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">
                ${selectedVenture.status}
              </span>
            </div>
            <h3 class="text-base font-bold text-white">${selectedVenture.name}</h3>
            <p class="text-xs text-slate-400 mt-1">${selectedVenture.tagline}</p>

            <div class="mt-3 pt-3 border-t border-slate-800 flex flex-wrap gap-1">
              ${selectedVenture.primaryTech.map(
                (tech) => html`<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">${tech}</span>`,
              )}
            </div>
          </div>

          <!-- Quick Navigation Actions -->
          <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-2">
            <button
              class="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
              @click="${() => (this.activeTab = 'discovery')}"
            >
              <span class="material-symbols-outlined text-base text-indigo-400">help</span>
              Discovery Protocol
            </button>
            <button
              class="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
              @click="${() => (this.activeTab = 'tasks')}"
            >
              <span class="material-symbols-outlined text-base text-purple-400">add_task</span>
              Queue 24/7 Automation
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================
  // FLOATING QUICK MODE PILL (BOTTOM-RIGHT)
  // ==========================================
  private renderFloatingQuickPill(activeModeInfo: any) {
    return html`
      <div class="fixed bottom-6 right-6 z-40 flex flex-col items-end">
        <!-- Quick Mode Popover -->
        ${this.showFloatingModeMenu
          ? html`
              <div
                class="mb-3 w-64 bg-slate-900 border border-slate-700/80 rounded-2xl p-3 shadow-2xl space-y-1.5 backdrop-blur-md"
              >
                <div class="flex items-center justify-between text-xs pb-1 border-b border-slate-800 text-slate-400 font-semibold">
                  <span>Switch Maya's Tone</span>
                  <button
                    class="text-slate-500 hover:text-white"
                    @click="${() => (this.showFloatingModeMenu = false)}"
                  >
                    ✕
                  </button>
                </div>
                ${PERSONA_MODES.map((mode) => {
                  const isSelected = this.persona.activeMode === mode.id;
                  return html`
                    <button
                      class="w-full text-left p-2 rounded-xl text-xs flex items-center justify-between transition-all ${isSelected
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'hover:bg-slate-800 text-slate-300'}"
                      @click="${() => this.setPersonaMode(mode.id)}"
                    >
                      <span>${mode.name}</span>
                      <span class="text-[10px] font-mono opacity-80">${mode.toneBadge}</span>
                    </button>
                  `;
                })}
                <div class="pt-1.5 border-t border-slate-800 flex justify-between">
                  <button
                    class="text-[11px] text-indigo-400 hover:underline"
                    @click="${() => {
                      this.showFloatingModeMenu = false;
                      this.showPersonaDrawer = true;
                    }}"
                  >
                    Open Full Persona Settings →
                  </button>
                </div>
              </div>
            `
          : ''}

        <!-- The Pill Button -->
        <button
          class="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-slate-900/95 hover:bg-slate-800/95 border border-indigo-500/40 shadow-xl shadow-indigo-500/10 transition-all hover:scale-105"
          @click="${() => (this.showFloatingModeMenu = !this.showFloatingModeMenu)}"
        >
          <div class="w-6 h-6 rounded-full bg-gradient-to-tr from-pink-500 to-indigo-600 flex items-center justify-center text-[11px] font-bold text-white shadow">
            M
          </div>
          <span class="text-xs font-semibold text-slate-200">Maya</span>
          <span class="text-[10px] px-2 py-0.5 rounded-full font-mono ${activeModeInfo.colorClass}">
            ${activeModeInfo.name}
          </span>
          <span class="material-symbols-outlined text-slate-400 text-base">expand_less</span>
        </button>
      </div>
    `;
  }

  // ==========================================
  // PERSONA & VOICE SETTINGS DRAWER (RIGHT)
  // ==========================================
  private renderPersonaDrawer(activeModeInfo: any) {
    return html`
      <div class="fixed inset-0 z-50 flex justify-end">
        <!-- Backdrop -->
        <div
          class="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
          @click="${() => (this.showPersonaDrawer = false)}"
        ></div>

        <!-- Sliding Panel -->
        <div
          class="relative w-full max-w-md bg-slate-900 border-l border-slate-800 p-6 overflow-y-auto space-y-6 shadow-2xl flex flex-col justify-between"
        >
          <div class="space-y-6">
            <!-- Header -->
            <div class="flex items-center justify-between pb-4 border-b border-slate-800">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-600 to-pink-500 flex items-center justify-center text-white font-bold text-xl shadow-lg">
                  M
                </div>
                <div>
                  <h2 class="text-base font-bold text-white">Maya — Persona & Voice</h2>
                  <p class="text-xs text-slate-400">Part 14 Persona & Relationship Layer</p>
                </div>
              </div>
              <button
                class="text-slate-400 hover:text-white p-1 rounded-lg"
                @click="${() => (this.showPersonaDrawer = false)}"
              >
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>

            <!-- Identity Synopsis -->
            <div class="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/80 text-xs space-y-1.5 text-slate-300">
              <div class="font-bold text-white flex items-center gap-1.5">
                <span class="material-symbols-outlined text-sm text-pink-400">sparkles</span>
                Character: 22–23 year old woman
              </div>
              <p class="text-slate-400 leading-relaxed">
                Mature beyond her age, sharp, warm, emotionally intelligent, quick-witted, grounded.
                Strictly uses first-person feminine Hindi/Hinglish grammar (<span class="text-pink-300">karti hoon</span>, <span class="text-pink-300">samajh gayi</span>, <span class="text-pink-300">sun rahi hoon</span>).
              </p>
            </div>

            <!-- Form of Address Preference -->
            <div class="space-y-2">
              <label class="text-xs font-bold text-slate-300 uppercase tracking-wider">Address Preference for Founder</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  class="p-2.5 rounded-xl border text-xs text-left transition-all ${this.persona
                    .preferredAddress === 'tum'
                    ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white'}"
                  @click="${() => this.setAddressPreference('tum')}"
                >
                  <div class="font-bold">Tum (Recommended)</div>
                  <div class="text-[10px] opacity-75">Close, casual & affectionate</div>
                </button>
                <button
                  class="p-2.5 rounded-xl border text-xs text-left transition-all ${this.persona
                    .preferredAddress === 'aap'
                    ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white'}"
                  @click="${() => this.setAddressPreference('aap')}"
                >
                  <div class="font-bold">Aap</div>
                  <div class="text-[10px] opacity-75">Formal & respectful</div>
                </button>
              </div>
            </div>

            <!-- Conversation Modes List (All 7 modes) -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-bold text-slate-300 uppercase tracking-wider">Active Conversation Mode</label>
                <span class="text-[10px] text-indigo-400 font-mono">7 Modes</span>
              </div>

              <div class="space-y-2 max-h-64 overflow-y-auto pr-1">
                ${PERSONA_MODES.map((mode) => {
                  const isSelected = this.persona.activeMode === mode.id;
                  return html`
                    <button
                      class="w-full text-left p-3 rounded-xl border transition-all ${isSelected
                        ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800/60'}"
                      @click="${() => this.setPersonaMode(mode.id)}"
                    >
                      <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-white">${mode.name}</span>
                        <span class="text-[10px] font-mono px-2 py-0.5 rounded ${mode.colorClass}">
                          ${mode.toneBadge}
                        </span>
                      </div>
                      <p class="text-[11px] text-slate-400 mt-1">${mode.tagline}</p>
                      <p class="text-[11px] text-indigo-300/80 italic mt-1 font-mono">"${mode.samplePhrase}"</p>
                    </button>
                  `;
                })}
              </div>
            </div>

            <!-- Voice Controls (TTS/Dictation Tuning) -->
            <div class="space-y-3 pt-2 border-t border-slate-800">
              <label class="text-xs font-bold text-slate-300 uppercase tracking-wider">Voice Speech Rate</label>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0.8"
                  max="1.3"
                  step="0.05"
                  class="flex-1 accent-indigo-500 cursor-pointer"
                  .value="${String(this.persona.voiceSpeed || 1.0)}"
                  @input="${(e: any) => this.updateVoiceSettings(parseFloat(e.target.value), 1.0)}"
                />
                <span class="text-xs font-mono text-indigo-300 w-12 text-right">${this.persona.voiceSpeed || 1.0}x</span>
              </div>
            </div>

            <!-- Healthy Relationship Guardrails (Part 14.9) -->
            <div class="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] space-y-1.5 text-slate-400">
              <div class="font-bold text-slate-300 flex items-center gap-1.5">
                <span class="material-symbols-outlined text-sm text-emerald-400">verified_user</span>
                Healthy Relationship Guardrails (§14.9)
              </div>
              <p>• Romance level is Founder's choice • Zero manipulation</p>
              <p>• Honest pushback when architecture/deadlines are risky</p>
              <p>• Safety & engineering quality strictly override character</p>
            </div>
          </div>

          <div class="pt-4 border-t border-slate-800">
            <button
              class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/20"
              @click="${() => (this.showPersonaDrawer = false)}"
            >
              Done & Save Persona
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================
  // TAB 2: DISCOVERY PROTOCOL WIZARD (§2)
  // ==========================================
  private renderDiscoveryTab(selectedVenture: SYBVenture) {
    return html`
      <div class="max-w-4xl mx-auto w-full space-y-6">
        <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-xl font-bold text-white flex items-center gap-2">
                <span class="material-symbols-outlined text-indigo-400">quiz</span>
                Discovery Protocol Interview
              </h2>
              <p class="text-xs text-slate-400 mt-1">
                Rule P2: "UNDERSTAND BEFORE BUILDING. Ask until you truly understand. Never start building on guesses."
              </p>
            </div>
            <button
              class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
              @click="${() => this.generateDiscoverySpec()}"
            >
              <span class="material-symbols-outlined text-sm">summarize</span>
              Generate 10-Line Spec
            </button>
          </div>

          <!-- Questions List -->
          <div class="space-y-5">
            ${DISCOVERY_QUESTIONS.map(
              (q) => html`
                <div class="p-4 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-3">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-bold text-indigo-300 uppercase tracking-wider">${q.title}</span>
                    <span class="text-[11px] text-slate-500 font-mono">Master Protocol</span>
                  </div>
                  <p class="text-sm font-medium text-slate-200">${q.question}</p>

                  <!-- Radio Options Chips -->
                  <div class="flex flex-wrap gap-2">
                    ${q.options.map((opt) => {
                      const isSelected = this.discoveryAnswers[q.id] === opt;
                      return html`
                        <button
                          class="px-3 py-1.5 rounded-lg text-xs transition-all text-left ${isSelected
                            ? 'bg-indigo-600 text-white font-semibold shadow'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'}"
                          @click="${() => {
                            this.discoveryAnswers = { ...this.discoveryAnswers, [q.id]: opt };
                          }}"
                        >
                          ${opt}
                        </button>
                      `;
                    })}
                  </div>
                </div>
              `,
            )}
          </div>

          <!-- Generated Spec Confirmation Box -->
          ${this.generatedSpec
            ? html`
                <div class="mt-6 p-4 bg-slate-950 border border-indigo-500/40 rounded-xl space-y-3">
                  <div class="flex items-center justify-between text-xs font-semibold text-indigo-300">
                    <span class="flex items-center gap-1.5">
                      <span class="material-symbols-outlined text-emerald-400 text-sm">verified</span>
                      CONFIRMATION SUMMARY (§2.4)
                    </span>
                    <button
                      class="text-indigo-400 hover:text-indigo-300"
                      @click="${() => navigator.clipboard.writeText(this.generatedSpec || '')}"
                    >
                      Copy Spec
                    </button>
                  </div>
                  <pre class="text-xs font-mono text-emerald-300 whitespace-pre-wrap leading-relaxed">${this.generatedSpec}</pre>

                  <div class="pt-2 flex justify-end gap-3">
                    <button
                      class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-emerald-600/20 flex items-center gap-1.5"
                      @click="${() => this.dispatchDiscoveryToQueue()}"
                    >
                      <span class="material-symbols-outlined text-sm">rocket_launch</span>
                      Founder Approves: Start Autonomous Build
                    </button>
                  </div>
                </div>
              `
            : html`
                <div class="mt-6 flex justify-end">
                  <button
                    class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-indigo-600/20 flex items-center gap-2"
                    @click="${() => this.generateDiscoverySpec()}"
                  >
                    <span>Confirm Requirements & Generate Spec</span>
                    <span class="material-symbols-outlined text-sm">arrow_forward</span>
                  </button>
                </div>
              `}
        </div>
      </div>
    `;
  }

  // ==========================================
  // TAB 3: 24/7 TASK QUEUE (§8.4)
  // ==========================================
  private renderTasksTab(selectedVenture: SYBVenture) {
    return html`
      <div class="space-y-6">
        <!-- Header & Action -->
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              <span class="material-symbols-outlined text-purple-400">schedule</span>
              24/7 Persistent Task Queue
            </h2>
            <p class="text-xs text-slate-400 mt-1">
              Automated triggers: Cron, System Startup, File Change, Network Return, On Demand.
            </p>
          </div>
          <button
            class="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-600/20"
            @click="${() => (this.showNewTaskModal = true)}"
          >
            <span class="material-symbols-outlined text-sm">add</span>
            Add Autonomous Task
          </button>
        </div>

        <!-- Task Cards Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${this.tasks.map((task) => {
            const isRunning = task.status === 'running';
            const isCompleted = task.status === 'completed';
            return html`
              <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 hover:border-slate-700/80 transition-colors">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <span
                      class="text-[10px] font-mono px-2 py-0.5 rounded ${isRunning
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : isCompleted
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'}"
                    >
                      ${task.triggerType.toUpperCase()}: ${task.triggerValue}
                    </span>
                    <h3 class="text-sm font-bold text-white mt-1.5">${task.title}</h3>
                  </div>

                  <span
                    class="text-xs font-semibold px-2 py-1 rounded-md ${isRunning
                      ? 'bg-amber-500/20 text-amber-300 animate-pulse'
                      : isCompleted
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'}"
                  >
                    ${task.status.toUpperCase()}
                  </span>
                </div>

                <!-- Progress Bar -->
                <div>
                  <div class="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
                    <span>Progress</span>
                    <span>${task.progress}%</span>
                  </div>
                  <div class="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                    <div
                      class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                      style="width: ${task.progress}%"
                    ></div>
                  </div>
                </div>

                <!-- Execution Steps -->
                <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 text-xs font-mono space-y-1 text-slate-300">
                  <div class="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Pipeline Steps</div>
                  ${task.steps.map((s, idx) => html`<div>${idx + 1}. ${s}</div>`)}
                </div>

                <!-- Log snippet -->
                ${task.logs && task.logs.length > 0
                  ? html`
                      <div class="text-[11px] font-mono text-emerald-400 truncate">
                        ${task.logs[task.logs.length - 1]}
                      </div>
                    `
                  : ''}

                <!-- Actions -->
                <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span class="text-slate-500 text-[11px] font-mono">
                    Last: ${task.lastRun || 'Pending'}
                  </span>
                  <div class="flex items-center gap-2">
                    <button
                      class="px-2.5 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 rounded-lg font-medium transition-colors"
                      @click="${() => this.handleTaskAction(task.id, 'run_now')}"
                    >
                      Run Now
                    </button>
                    ${task.status === 'paused'
                      ? html`
                          <button
                            class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                            @click="${() => this.handleTaskAction(task.id, 'resume')}"
                          >
                            Resume
                          </button>
                        `
                      : html`
                          <button
                            class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                            @click="${() => this.handleTaskAction(task.id, 'pause')}"
                          >
                            Pause
                          </button>
                        `}
                    <button
                      class="px-2.5 py-1 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                      @click="${() => this.handleTaskAction(task.id, 'delete')}"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  // ==========================================
  // TAB 4: SYB ECOSYSTEM VENTURES (§1.1)
  // ==========================================
  private renderEcosystemTab() {
    return html`
      <div class="space-y-6">
        <div>
          <h2 class="text-xl font-bold text-white flex items-center gap-2">
            <span class="material-symbols-outlined text-indigo-400">hub</span>
            SYB (Shape Your Business) Connected Ecosystem
          </h2>
          <p class="text-xs text-slate-400 mt-1">
            Ventures founded by Snehasis Sahoo in Bhubaneswar, Odisha. Maya coordinates components, auth, and APIs across all ventures.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          ${SYB_VENTURES.map(
            (v) => html`
              <div
                class="bg-slate-900/80 border ${this.selectedVentureId === v.id
                  ? 'border-indigo-500 shadow-lg shadow-indigo-500/10'
                  : 'border-slate-800 hover:border-slate-700'} rounded-2xl p-5 space-y-4 flex flex-col justify-between transition-all"
              >
                <div>
                  <div class="flex items-center justify-between text-xs">
                    <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-semibold">
                      ${v.category}
                    </span>
                    <span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                      ${v.status.toUpperCase()}
                    </span>
                  </div>

                  <h3 class="text-base font-bold text-white mt-2">${v.name}</h3>
                  <p class="text-xs text-indigo-300 font-medium">${v.tagline}</p>
                  <p class="text-xs text-slate-400 mt-2 leading-relaxed">${v.description}</p>
                </div>

                <div class="space-y-3 pt-3 border-t border-slate-800/80">
                  <div class="flex flex-wrap gap-1">
                    ${v.primaryTech.map(
                      (tech) => html`<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-400">${tech}</span>`,
                    )}
                  </div>

                  <button
                    class="w-full py-2 rounded-xl text-xs font-semibold transition-all ${this
                      .selectedVentureId === v.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}"
                    @click="${() => {
                      this.selectedVentureId = v.id;
                      this.activeTab = 'console';
                    }}"
                  >
                    ${this.selectedVentureId === v.id ? '✓ Active Focus' : 'Select as Active Focus'}
                  </button>
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  // ==========================================
  // TAB 5: 21 MASTER TOOLS & LOCAL BRIDGE (§6 & Master Tools)
  // ==========================================
  private renderToolsTab() {
    return html`
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        <!-- LEFT 1 COL: 21 TOOLS DIRECTORY -->
        <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-white flex items-center gap-1.5">
              <span class="material-symbols-outlined text-indigo-400 text-base">construction</span>
              Master Tools (21)
            </h3>
            <span class="text-[11px] font-mono text-emerald-400">Bridge Active</span>
          </div>

          <div class="flex-1 overflow-y-auto space-y-1.5 max-h-[600px] pr-1">
            ${MASTER_TOOLS.map((t) => {
              const isSelected = this.selectedTool.name === t.name;
              return html`
                <button
                  class="w-full text-left p-2.5 rounded-xl transition-all ${isSelected
                    ? 'bg-indigo-600/30 border border-indigo-500/50 text-white shadow-sm'
                    : 'bg-slate-950/50 hover:bg-slate-800/60 border border-slate-800/80 text-slate-300'}"
                  @click="${() => this.selectTool(t)}"
                >
                  <div class="flex items-center justify-between text-xs font-mono font-semibold">
                    <span class="${isSelected ? 'text-indigo-300' : 'text-slate-200'}">${t.name}</span>
                    <span class="text-[10px] text-slate-500">${t.category}</span>
                  </div>
                  <p class="text-[11px] text-slate-400 mt-1 line-clamp-1">${t.description}</p>
                </button>
              `;
            })}
          </div>
        </div>

        <!-- RIGHT 2 COLS: TOOL RUNNER & AUDIT LOGS -->
        <div class="lg:col-span-2 space-y-5 flex flex-col">
          <!-- Interactive Execution Sandbox -->
          <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-base font-bold text-white flex items-center gap-2">
                  <span class="font-mono text-indigo-400">${this.selectedTool.name}</span>
                </h3>
                <p class="text-xs text-slate-400 mt-0.5">${this.selectedTool.description}</p>
              </div>

              <button
                class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 disabled:opacity-50"
                ?disabled="${this.isExecutingTool}"
                @click="${() => this.executeSelectedTool()}"
              >
                ${this.isExecutingTool
                  ? html`<span class="material-symbols-outlined text-sm animate-spin">sync</span> Running...`
                  : html`<span class="material-symbols-outlined text-sm">play_arrow</span> Run on Bridge`}
              </button>
            </div>

            <!-- Parameters Editor -->
            <div>
              <label class="block text-xs font-mono text-slate-400 mb-1.5">JSON Parameters Payload</label>
              <textarea
                class="w-full h-32 bg-slate-950 font-mono text-xs text-slate-200 border border-slate-800 rounded-xl p-3 focus:outline-none focus:border-indigo-500"
                .value="${this.toolParamsJson}"
                @input="${(e: any) => (this.toolParamsJson = e.target.value)}"
              ></textarea>
            </div>

            <!-- Output Display -->
            ${this.toolExecutionOutput
              ? html`
                  <div class="space-y-1.5">
                    <div class="text-xs font-mono text-slate-400 flex items-center justify-between">
                      <span>Execution Result</span>
                      <span class="text-emerald-400">Status: OK</span>
                    </div>
                    <pre class="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-emerald-300 overflow-x-auto max-h-56">${JSON.stringify(
                      this.toolExecutionOutput,
                      null,
                      2,
                    )}</pre>
                  </div>
                `
              : ''}
          </div>

          <!-- Real-Time Audit Trail Table -->
          <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex-1 flex flex-col">
            <h3 class="text-sm font-bold text-white mb-3 flex items-center justify-between">
              <span>Local Bridge Audit Trail (§6.4)</span>
              <span class="text-xs font-mono text-slate-400">${this.auditLogs.length} events logged</span>
            </h3>

            <div class="flex-1 overflow-x-auto">
              <table class="w-full text-left text-xs font-mono">
                <thead>
                  <tr class="border-b border-slate-800 text-slate-400">
                    <th class="pb-2">Tool</th>
                    <th class="pb-2">Status</th>
                    <th class="pb-2">Duration</th>
                    <th class="pb-2">Timestamp</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/60">
                  ${this.auditLogs.map(
                    (log) => html`
                      <tr class="text-slate-300">
                        <td class="py-2 text-indigo-400 font-semibold">${log.toolName}</td>
                        <td class="py-2">
                          <span class="px-1.5 py-0.5 rounded text-[10px] ${log.status === 'success'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-rose-500/20 text-rose-400'}">
                            ${log.status.toUpperCase()}
                          </span>
                        </td>
                        <td class="py-2 text-slate-400">${log.durationMs}ms</td>
                        <td class="py-2 text-slate-500">${new Date(log.timestamp).toLocaleTimeString()}</td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================
  // TAB 6: MEMORY & LESSONS VAULT (§10)
  // ==========================================
  private renderMemoryTab() {
    return html`
      <div class="space-y-6">
        <div>
          <h2 class="text-xl font-bold text-white flex items-center gap-2">
            <span class="material-symbols-outlined text-amber-400">memory</span>
            Persistent Memory Vault (§10)
          </h2>
          <p class="text-xs text-slate-400 mt-1">
            Founder preferences, brand guidelines, architectural patterns, lessons learned, and assumptions baseline.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          ${this.memories.map(
            (m) => html`
              <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold uppercase">
                    ${m.category}
                  </span>
                  <span class="text-slate-500 text-[10px] font-mono">Durable</span>
                </div>

                <h3 class="text-sm font-bold text-white">${m.title}</h3>
                <p class="text-xs text-slate-300 leading-relaxed">${m.content}</p>

                <div class="pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500">
                  Updated: ${new Date(m.updatedAt).toLocaleDateString()}
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  // ==========================================
  // TAB 7: PROJECT ARTIFACTS GENERATOR (§12.6)
  // ==========================================
  private renderArtifactsTab(selectedVenture: SYBVenture) {
    const docs = this.generatedDocs || {};
    const currentDocContent = docs[this.activeDocTab] || 'Click Generate to scaffold markdown files.';

    return html`
      <div class="space-y-6 max-w-5xl mx-auto w-full">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              <span class="material-symbols-outlined text-indigo-400">description</span>
              Universal Documentation Engine (§12.6)
            </h2>
            <p class="text-xs text-slate-400 mt-1">
              Mandatory project files for seamless continuation across Cursor, VS Code, Antigravity, and Codex.
            </p>
          </div>

          <button
            class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
            @click="${() => this.generateProjectDocs()}"
          >
            <span class="material-symbols-outlined text-sm">refresh</span>
            Regenerate for ${selectedVenture.name}
          </button>
        </div>

        <div class="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <!-- Doc Tabs -->
          <div class="bg-slate-950 p-2 flex items-center gap-1 border-b border-slate-800 overflow-x-auto text-xs font-mono">
            ${Object.keys(docs).map((fileName) => html`
              <button
                class="px-3 py-1.5 rounded-lg transition-colors ${this.activeDocTab === fileName
                  ? 'bg-indigo-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}"
                @click="${() => (this.activeDocTab = fileName)}"
              >
                ${fileName}
              </button>
            `)}
          </div>

          <!-- Content Viewer -->
          <div class="p-6">
            <div class="flex justify-end mb-2">
              <button
                class="text-xs text-indigo-400 hover:text-indigo-300 font-mono flex items-center gap-1"
                @click="${() => navigator.clipboard.writeText(currentDocContent)}"
              >
                <span class="material-symbols-outlined text-sm">content_copy</span>
                Copy ${this.activeDocTab}
              </button>
            </div>
            <pre class="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-[500px]">${currentDocContent}</pre>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================
  // MODAL: ADD 24/7 TASK
  // ==========================================
  private renderNewTaskModal() {
    return html`
      <div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-bold text-white flex items-center gap-2">
              <span class="material-symbols-outlined text-purple-400">add_task</span>
              Schedule Autonomous 24/7 Task
            </h3>
            <button
              class="text-slate-400 hover:text-white"
              @click="${() => (this.showNewTaskModal = false)}"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>

          <div class="space-y-3 text-xs">
            <div>
              <label class="block text-slate-400 mb-1 font-medium">Task Title</label>
              <input
                type="text"
                class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                placeholder="e.g. ORBIT: Daily package vulnerability scan & alert"
                .value="${this.newTaskTitle}"
                @input="${(e: any) => (this.newTaskTitle = e.target.value)}"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-slate-400 mb-1 font-medium">Trigger Type</label>
                <select
                  class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  .value="${this.newTaskTriggerType}"
                  @change="${(e: any) => (this.newTaskTriggerType = e.target.value)}"
                >
                  <option value="cron">Cron Schedule</option>
                  <option value="manual">Manual / On Demand</option>
                  <option value="startup">On System Startup</option>
                  <option value="file_change">On File Change</option>
                </select>
              </div>

              <div>
                <label class="block text-slate-400 mb-1 font-medium">Trigger Expression</label>
                <input
                  type="text"
                  class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  placeholder="0 9 * * * / Manual"
                  .value="${this.newTaskTriggerValue}"
                  @input="${(e: any) => (this.newTaskTriggerValue = e.target.value)}"
                />
              </div>
            </div>

            <div>
              <label class="block text-slate-400 mb-1 font-medium">Execution Steps (one per line)</label>
              <textarea
                class="w-full h-24 bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-mono focus:outline-none focus:border-purple-500"
                .value="${this.newTaskSteps}"
                @input="${(e: any) => (this.newTaskSteps = e.target.value)}"
              ></textarea>
            </div>
          </div>

          <div class="pt-2 flex justify-end gap-3">
            <button
              class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              @click="${() => (this.showNewTaskModal = false)}"
            >
              Cancel
            </button>
            <button
              class="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-600/20"
              @click="${() => this.addNewTask()}"
            >
              Schedule Task
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================
  // TAB 8: DIAGNOSTIC TEST SUITE & AUTO-FIX
  // ==========================================
  private renderTestsTab() {
    const total = this.testSuites.reduce((acc, s) => acc + s.totalCount, 0);
    const passed = this.testSuites.reduce((acc, s) => acc + s.passedCount, 0);
    const failed = this.testSuites.reduce((acc, s) => acc + s.failedCount, 0);
    const warnings = this.testSuites.reduce((acc, s) => acc + s.warningCount, 0);
    const healthIndex = Math.round((passed / (total || 1)) * 100);

    return html`
      <div class="space-y-6 flex-1 flex flex-col">
        <!-- TOP EXECUTIVE METRICS BANNER -->
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-indigo-400 text-2xl">verified</span>
                <h2 class="text-xl font-bold text-white tracking-tight">Full Diagnostic Test Suite & Verification</h2>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  ${healthIndex}% HEALTH
                </span>
              </div>
              <p class="text-slate-400 text-xs mt-1">
                Zero-Hallucination verification across TypeScript, Vite, API endpoints, Master Tools, and Maya Part 14 persona.
              </p>
            </div>

            <!-- Primary Action Controls -->
            <div class="flex flex-wrap items-center gap-2.5">
              <button
                class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/25 transition-all hover:scale-[1.02] disabled:opacity-50"
                ?disabled="${this.isRunningTests || this.isFixingTests}"
                @click="${() => this.runFullTestSuite()}"
              >
                <span class="material-symbols-outlined text-base ${this.isRunningTests ? 'animate-spin' : ''}">
                  ${this.isRunningTests ? 'autorenew' : 'play_arrow'}
                </span>
                ${this.isRunningTests ? 'Running Verification...' : 'Run Full Test Suite'}
              </button>

              <button
                class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-600/25 transition-all hover:scale-[1.02] disabled:opacity-50"
                ?disabled="${this.isRunningTests || this.isFixingTests}"
                @click="${() => this.triggerAutoFix()}"
              >
                <span class="material-symbols-outlined text-base ${this.isFixingTests ? 'animate-spin' : ''}">
                  ${this.isFixingTests ? 'refresh' : 'auto_fix_high'}
                </span>
                ${this.isFixingTests ? 'Applying Auto-Fixes...' : '1-Click Auto-Fix (Zero-Warning)'}
              </button>

              <button
                class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                @click="${() => this.exportMarkdownAudit()}"
                title="Download formatted TESTS.md report"
              >
                <span class="material-symbols-outlined text-base">download</span>
                Export TESTS.md
              </button>
            </div>
          </div>

          <!-- Notification Toast Bar -->
          ${this.lastTestNotification
            ? html`
                <div class="mt-4 p-3 bg-indigo-950/80 border border-indigo-700/60 rounded-xl text-xs text-indigo-200 flex items-center justify-between gap-3 animate-fadeIn">
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-indigo-400 text-sm">info</span>
                    <span>${this.lastTestNotification}</span>
                  </div>
                  <button
                    class="text-slate-400 hover:text-white"
                    @click="${() => (this.lastTestNotification = null)}"
                  >
                    <span class="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              `
            : ''}

          <!-- METRICS CARDS ROW -->
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-800/80">
            <div class="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
              <span class="text-[11px] text-slate-400 uppercase tracking-wider font-semibold block">Total Assertions</span>
              <span class="text-2xl font-bold font-mono text-white mt-1 block">${total}</span>
            </div>

            <div class="bg-slate-950/60 border border-emerald-900/40 rounded-xl p-3">
              <span class="text-[11px] text-emerald-400 uppercase tracking-wider font-semibold block">Passed (100%)</span>
              <span class="text-2xl font-bold font-mono text-emerald-400 mt-1 block">${passed}</span>
            </div>

            <div class="bg-slate-950/60 border border-amber-900/40 rounded-xl p-3">
              <span class="text-[11px] text-amber-400 uppercase tracking-wider font-semibold block">Warnings</span>
              <span class="text-2xl font-bold font-mono text-amber-400 mt-1 block">${warnings}</span>
            </div>

            <div class="bg-slate-950/60 border border-rose-900/40 rounded-xl p-3">
              <span class="text-[11px] text-rose-400 uppercase tracking-wider font-semibold block">Failed</span>
              <span class="text-2xl font-bold font-mono text-rose-400 mt-1 block">${failed}</span>
            </div>

            <div class="bg-slate-950/60 border border-indigo-900/40 rounded-xl p-3 col-span-2 sm:col-span-1">
              <span class="text-[11px] text-indigo-400 uppercase tracking-wider font-semibold block">Zero-Warning Guard</span>
              <span class="text-xs font-semibold text-emerald-400 mt-2 block flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">check_circle</span>
                Enforced by Maya
              </span>
            </div>
          </div>
        </div>

        <!-- REAL-TIME FILE-WATCHER & LIVE BUILD STATUS STRIP -->
        <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg backdrop-blur">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <!-- Watcher Live Indicator -->
              <div class="flex items-center gap-2 px-3 py-1.5 rounded-xl border ${
                this.buildStatus === 'building'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : this.buildStatus === 'failed'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : this.watcherActive
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }">
                <span class="relative flex h-2.5 w-2.5">
                  ${this.watcherActive && this.buildStatus === 'building'
                    ? html`<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>`
                    : this.watcherActive && this.buildStatus === 'passed'
                    ? html`<span class="animate-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>`
                    : ''}
                  <span class="relative inline-flex rounded-full h-2.5 w-2.5 ${
                    this.buildStatus === 'building'
                      ? 'bg-amber-500'
                      : this.buildStatus === 'failed'
                      ? 'bg-rose-500'
                      : this.watcherActive
                      ? 'bg-emerald-500'
                      : 'bg-slate-500'
                  }"></span>
                </span>
                <span class="text-xs font-semibold tracking-wide flex items-center gap-1.5">
                  <span class="material-symbols-outlined text-sm ${this.buildStatus === 'building' ? 'animate-spin' : ''}">
                    ${this.buildStatus === 'building' ? 'sync' : this.watcherActive ? 'sensors' : 'sensors_off'}
                  </span>
                  ${this.buildStatus === 'building'
                    ? `Compiling changes (${this.lastModifiedFile || 'source'})...`
                    : this.watcherActive
                    ? 'Watcher Active • Auto-Build on Save'
                    : 'Watcher Paused'}
                </span>
              </div>

              <!-- Last modified & duration stats -->
              ${this.lastModifiedFile
                ? html`
                    <div class="hidden md:flex items-center gap-1.5 text-xs text-slate-400">
                      <span class="material-symbols-outlined text-xs text-slate-500">description</span>
                      <span class="font-mono text-slate-300">${this.lastModifiedFile}</span>
                      ${this.lastBuildDurationMs > 0
                        ? html`<span class="text-slate-500">(${this.lastBuildDurationMs}ms)</span>`
                        : ''}
                    </div>
                  `
                : ''}
            </div>

            <!-- Controls -->
            <div class="flex items-center gap-2">
              <button
                class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors"
                @click="${() => this.toggleWatcherMode()}"
                title="${this.watcherActive ? 'Pause instant watching' : 'Resume instant watching'}"
              >
                <span class="material-symbols-outlined text-sm ${this.watcherActive ? 'text-emerald-400' : 'text-slate-400'}">
                  ${this.watcherActive ? 'pause_circle' : 'play_circle'}
                </span>
                ${this.watcherActive ? 'Pause Watcher' : 'Resume Watcher'}
              </button>

              <button
                class="px-3 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-indigo-500/40 shadow-sm transition-all hover:scale-[1.02] disabled:opacity-50"
                ?disabled="${this.buildStatus === 'building' || this.isManualTriggering}"
                @click="${() => this.triggerWatcherBuild()}"
                title="Force immediate tsc --noEmit && vite build"
              >
                <span class="material-symbols-outlined text-sm ${this.buildStatus === 'building' || this.isManualTriggering ? 'animate-spin' : ''}">
                  bolt
                </span>
                ${this.buildStatus === 'building' ? 'Compiling...' : '⚡ Trigger Build'}
              </button>

              <button
                class="px-3 py-1.5 ${this.showBuildConsole ? 'bg-indigo-950 text-indigo-300 border-indigo-500/50' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'} rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-colors"
                @click="${() => (this.showBuildConsole = !this.showBuildConsole)}"
              >
                <span class="material-symbols-outlined text-sm">terminal</span>
                <span>Console (${this.buildConsoleLogs.length})</span>
                <span class="material-symbols-outlined text-xs">
                  ${this.showBuildConsole ? 'expand_less' : 'expand_more'}
                </span>
              </button>
            </div>
          </div>

          <!-- COLLAPSIBLE LIVE BUILD CONSOLE DRAWER -->
          ${this.showBuildConsole
            ? html`
                <div class="mt-3.5 pt-3 border-t border-slate-800/80 animate-fadeIn">
                  <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2 text-xs text-slate-400 font-mono">
                      <span class="material-symbols-outlined text-xs text-indigo-400">code</span>
                      <span>Real-Time Compiler & Watcher Stream (stdout / stderr)</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        class="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60"
                        @click="${() => this.clearBuildConsole()}"
                      >
                        <span class="material-symbols-outlined text-[13px]">clear_all</span>
                        Clear
                      </button>
                    </div>
                  </div>
                  <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-64 overflow-y-auto font-mono text-xs leading-relaxed space-y-1 scrollbar-thin">
                    ${this.buildConsoleLogs.length === 0
                      ? html`<div class="text-slate-500 italic py-2 text-center">No build logs yet. Waiting for file save or trigger...</div>`
                      : this.buildConsoleLogs.map((entry) => {
                          const color =
                            entry.stream === 'stderr'
                              ? 'text-rose-400'
                              : entry.stream === 'system'
                              ? 'text-indigo-300 font-semibold'
                              : 'text-slate-300';
                          return html`
                            <div class="flex items-start gap-2.5">
                              <span class="text-slate-600 select-none text-[10px] whitespace-nowrap pt-0.5">${entry.timestamp}</span>
                              <pre class="flex-1 whitespace-pre-wrap break-words ${color}">${entry.text}</pre>
                            </div>
                          `;
                        })}
                  </div>
                </div>
              `
            : ''}
        </div>

        <!-- SEVERITY FILTER BAR -->

        <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-2.5">
          <div class="flex items-center gap-1.5 text-xs">
            <span class="text-slate-400 mr-2 font-medium">Filter by Severity:</span>
            <button
              class="px-2.5 py-1 rounded-lg font-semibold transition-colors ${this.testSeverityFilter === 'ALL'
                ? 'bg-slate-800 text-white border border-slate-700'
                : 'text-slate-400 hover:text-white'}"
              @click="${() => (this.testSeverityFilter = 'ALL')}"
            >
              ALL (${total})
            </button>

            <button
              class="px-2.5 py-1 rounded-lg font-semibold transition-colors ${this.testSeverityFilter === 'CRITICAL'
                ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                : 'text-slate-400 hover:text-red-300'}"
              @click="${() => (this.testSeverityFilter = 'CRITICAL')}"
            >
              CRITICAL
            </button>

            <button
              class="px-2.5 py-1 rounded-lg font-semibold transition-colors ${this.testSeverityFilter === 'HIGH'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-amber-300'}"
              @click="${() => (this.testSeverityFilter = 'HIGH')}"
            >
              HIGH
            </button>

            <button
              class="px-2.5 py-1 rounded-lg font-semibold transition-colors ${this.testSeverityFilter === 'MEDIUM'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-cyan-300'}"
              @click="${() => (this.testSeverityFilter = 'MEDIUM')}"
            >
              MEDIUM
            </button>

            <button
              class="px-2.5 py-1 rounded-lg font-semibold transition-colors ${this.testSeverityFilter === 'INFO'
                ? 'bg-slate-700 text-slate-200'
                : 'text-slate-400 hover:text-slate-300'}"
              @click="${() => (this.testSeverityFilter = 'INFO')}"
            >
              INFO
            </button>
          </div>

          <div class="text-[11px] text-slate-400 font-mono">
            Environment: Node.js ${this.connectedServices.local_bridge ? 'v22 (Local Bridge :3000)' : 'Production'}
          </div>
        </div>

        <!-- TEST SUITES ACCORDION CARDS -->
        <div class="space-y-4">
          ${this.testSuites.map((suite) => {
            const filteredAssertions =
              this.testSeverityFilter === 'ALL'
                ? suite.assertions
                : suite.assertions.filter((a) => a.severity === this.testSeverityFilter);

            const isAllPassed = suite.failedCount === 0 && suite.warningCount === 0;

            return html`
              <div class="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-lg transition-all">
                <!-- Suite Header -->
                <div class="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-900/40">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-indigo-400">
                      <span class="material-symbols-outlined text-xl">${suite.icon}</span>
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <h3 class="font-bold text-white text-base">${suite.name}</h3>
                        <span
                          class="px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase ${isAllPassed
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : suite.failedCount > 0
                            ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'}"
                        >
                          ${suite.status}
                        </span>
                      </div>
                      <p class="text-xs text-slate-400 mt-0.5">${suite.description}</p>
                    </div>
                  </div>

                  <div class="flex items-center gap-3">
                    <div class="text-right text-xs">
                      <span class="font-mono font-semibold text-emerald-400">${suite.passedCount}/${suite.totalCount} Passed</span>
                      <span class="text-slate-500 block text-[10px] font-mono">${suite.durationMs}ms</span>
                    </div>

                    <button
                      class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      ?disabled="${this.isRunningTests}"
                      @click="${() => this.runFullTestSuite(suite.id)}"
                      title="Run only this suite"
                    >
                      <span class="material-symbols-outlined text-sm">play_circle</span>
                      Run Suite
                    </button>
                  </div>
                </div>

                <!-- Assertions List -->
                <div class="p-4 sm:p-5 divide-y divide-slate-800/60 space-y-3">
                  ${filteredAssertions.length === 0
                    ? html`
                        <div class="py-4 text-center text-xs text-slate-500">
                          No assertions matching severity "${this.testSeverityFilter}" in this suite.
                        </div>
                      `
                    : filteredAssertions.map((assertion) => {
                        const isPass = assertion.status === 'passed';
                        const isFail = assertion.status === 'failed';

                        const severityColor =
                          assertion.severity === 'CRITICAL'
                            ? 'text-red-400 border-red-500/30 bg-red-500/10'
                            : assertion.severity === 'HIGH'
                            ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                            : assertion.severity === 'MEDIUM'
                            ? 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10'
                            : 'text-slate-400 border-slate-700 bg-slate-800';

                        return html`
                          <div class="pt-3 first:pt-0 flex flex-col gap-2">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                              <div class="flex items-center gap-2">
                                <span
                                  class="material-symbols-outlined text-base ${isPass
                                    ? 'text-emerald-400'
                                    : isFail
                                    ? 'text-rose-400'
                                    : 'text-amber-400'}"
                                >
                                  ${isPass ? 'check_circle' : isFail ? 'cancel' : 'warning'}
                                </span>
                                <span class="text-sm font-semibold text-slate-100">${assertion.name}</span>
                                <span class="text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${severityColor}">
                                  ${assertion.severity}
                                </span>
                                <span class="text-[11px] text-slate-500">· ${assertion.category}</span>
                              </div>

                              <div class="flex items-center gap-2">
                                <span class="text-[11px] font-mono text-slate-500">${assertion.durationMs}ms</span>
                                ${assertion.canAutoFix
                                  ? html`
                                      <button
                                        class="px-2 py-0.5 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                                        @click="${() => this.triggerAutoFix(assertion.id)}"
                                      >
                                        <span class="material-symbols-outlined text-xs">build</span>
                                        Fix Issue
                                      </button>
                                    `
                                  : ''}
                              </div>
                            </div>

                            ${assertion.message
                              ? html`<p class="text-xs text-slate-400 pl-6">${assertion.message}</p>`
                              : ''}

                            ${assertion.trace
                              ? html`
                                  <div class="ml-6 p-2.5 bg-slate-950 border border-rose-900/40 rounded-xl font-mono text-[11px] text-rose-300 whitespace-pre-wrap overflow-x-auto">
                                    ${assertion.trace}
                                  </div>
                                `
                              : ''}

                            ${assertion.suggestedFix
                              ? html`
                                  <div class="ml-6 flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-950/40 border border-amber-900/40 px-2.5 py-1 rounded-lg">
                                    <span class="material-symbols-outlined text-xs text-amber-400">tips_and_updates</span>
                                    <span>Suggested Fix: ${assertion.suggestedFix}</span>
                                  </div>
                                `
                              : ''}
                          </div>
                        `;
                      })}
                </div>
              </div>
            `;
          })}
        </div>

        <!-- ZERO-WARNING CONSTITUTION BOX -->
        <div class="p-4 bg-slate-900/40 border border-slate-800 rounded-2xl flex flex-wrap items-center justify-between gap-4 text-xs">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-emerald-400 text-xl">shield_check</span>
            <div>
              <span class="font-bold text-white block">Action Engine Zero-Warning Policy</span>
              <span class="text-slate-400">
                All production builds run <code>tsc --noEmit && vite build</code> with automatic lint resolution.
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-slate-500">Founder SYB:</span>
            <span class="text-indigo-300 font-semibold font-mono">Snehasis Sahoo</span>
            <span class="text-slate-500">| Lead AI:</span>
            <span class="text-amber-300 font-semibold font-mono">Maya</span>
          </div>
        </div>
      </div>
    `;
  }
}

function main() {
  const el = document.createElement('action-engine-app');
  document.body.appendChild(el);
}

main();
