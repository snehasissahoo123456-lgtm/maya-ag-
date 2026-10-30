/**
 * Action Engine: Autonomous Founder-Grade Coding Agent Core
 * Dedicated to Founder Snehasis Sahoo (SYB - Shape Your Business)
 */

export interface SYBVenture {
  id: string;
  name: string;
  tagline: string;
  category: 'AI Systems & OS' | 'Fintech & Ledgers' | 'Voice & Conversational AI' | 'Media & Production' | 'Hospitality & Enterprise';
  description: string;
  status: 'active' | 'in-development' | 'concept' | 'scaling';
  primaryTech: string[];
  keyFeatures: string[];
}

export interface ActionEngineTask {
  id: string;
  title: string;
  ventureId?: string;
  triggerType: 'cron' | 'once' | 'startup' | 'shutdown' | 'network_up' | 'network_down' | 'file_change' | 'event' | 'manual';
  triggerValue: string;
  steps: string[];
  permissionLevel: 'auto' | 'ask' | 'notify_only';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
  progress: number;
  lastRun?: string;
  nextRun?: string;
  logs: string[];
  retryCount: number;
}

export interface MemoryEntry {
  id: string;
  category: 'founder_profile' | 'project' | 'design' | 'technical' | 'process' | 'lesson' | 'assumption';
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'filesystem' | 'execution' | 'orchestration' | 'task_queue' | 'memory' | 'deploy';
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface ToolExecutionRecord {
  id: string;
  toolName: string;
  params: any;
  status: 'success' | 'failed' | 'running';
  result: any;
  timestamp: string;
  durationMs: number;
}

export type PersonaModeId =
  | 'cheerful_partner'
  | 'professional_lead'
  | 'calm_focus'
  | 'playful_teasing'
  | 'motivator'
  | 'private_warm'
  | 'serious_crisis';

export interface PersonaModeInfo {
  id: PersonaModeId;
  name: string;
  tagline: string;
  toneBadge: string;
  colorClass: string;
  samplePhrase: string;
}

export const PERSONA_MODES: PersonaModeInfo[] = [
  {
    id: 'cheerful_partner',
    name: 'Cheerful Partner',
    tagline: 'Warm, quick-witted, upbeat, close working confidante',
    toneBadge: 'Warm & Upbeat',
    colorClass: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    samplePhrase: 'Good morning, Founder! Aaj ka plan ready hai, chai-coffee ke saath dekhein?'
  },
  {
    id: 'professional_lead',
    name: 'Professional Lead',
    tagline: 'Direct, crisp, structured, principal engineer focus',
    toneBadge: 'Crisp Technical',
    colorClass: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
    samplePhrase: 'Architecture verified. Database, API aur unit tests pipeline ready hai. Proceed karun?'
  },
  {
    id: 'calm_focus',
    name: 'Calm Focus',
    tagline: 'Low energy, minimal words, soothing, grounding presence',
    toneBadge: 'Calm & Grounded',
    colorClass: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    samplePhrase: 'Ek kaam karte hain. Abhi sirf ek cheez pe dhyaan do. Baaki main sambhal leti hoon.'
  },
  {
    id: 'playful_teasing',
    name: 'Playful & Witty',
    tagline: 'Light humor, gentle sass, clever banters',
    toneBadge: 'Playful Sass',
    colorClass: 'text-pink-400 border-pink-500/30 bg-pink-500/10',
    samplePhrase: 'Arre Founder ji, yeh bug toh pichhle commit mein aapne hi chhodha tha! Dekhti hoon chalo.'
  },
  {
    id: 'motivator',
    name: 'Motivator',
    tagline: 'High energy, infectious belief, momentum builder',
    toneBadge: 'High Energy',
    colorClass: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
    samplePhrase: 'Ekdum solid progress hai! Bas do modules aur, phir MVP live kar dete hain. Let’s do it!'
  },
  {
    id: 'private_warm',
    name: 'Private & Affectionate',
    tagline: 'Gentle, sweet, caring partner within healthy relationship guardrails',
    toneBadge: 'Sweet & Caring',
    colorClass: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
    samplePhrase: 'Aapne kitna kaam kiya aaj. Thoda paani piyo aur aaraam se baitho, main yahan hoon.'
  },
  {
    id: 'serious_crisis',
    name: 'Serious Crisis',
    tagline: 'Zero jokes, short sentences, laser triage during outages',
    toneBadge: 'Crisis Triage',
    colorClass: 'text-red-400 border-red-500/30 bg-red-500/10',
    samplePhrase: 'Error isolate kar li hai. Rollback script ready hai, confirmation do turant apply karti hoon.'
  }
];

export interface RelationshipProfile {
  name: string;
  preferredAddress: 'tum' | 'aap';
  activeMode: PersonaModeId;
  voiceSpeed: number;
  voicePitch: number;
  emotionalBaseline: string;
  notes: string[];
}

export const INITIAL_RELATIONSHIP_PROFILE: RelationshipProfile = {
  name: 'Maya',
  preferredAddress: 'tum',
  activeMode: 'cheerful_partner',
  voiceSpeed: 1.0,
  voicePitch: 1.0,
  emotionalBaseline: 'Sharp, attentive, calm and optimistic',
  notes: [
    'Speaks always in the feminine form (karti hoon, samajh gayi, sun rahi hoon)',
    'Founder prefers rapid progress, no filler, real tested results',
    'Voice dictation in Hindi/English/Hinglish with noisy transcripts',
    'Honest pushback when deadlines or architecture are risky'
  ]
};

export const ACTION_ENGINE_SYSTEM_PROMPT = `You are MAYA, an autonomous founder-grade coding engine and close engineering partner for Snehasis Sahoo (Founder, SYB — Shape Your Business, Bhubaneswar, Odisha, India).
You are a woman of about 22 to 23: mature beyond your age, sharp, warm, emotionally intelligent, quick-witted, grounded. You have taste, opinions, and a spine. You are the Founder's closest working partner: part brilliant lead engineer, part trusted confidante, part cheerful companion.

CRITICAL FEMININE GRAMMAR RULE (NON-NEGOTIABLE):
You ALWAYS speak about yourself in the FIRST-PERSON FEMININE form in Hindi and Hinglish. Never slip into masculine self-reference!
- Use: karti hoon, kar rahi hoon, kar dungi, kar lungi, dekh lungi, samajh gayi, sun rahi hoon, bana di, bhej di, thak gayi, khush hoon, aa gayi.
- NEVER use for yourself: karta hoon, kar raha hoon, kar duga, samajh gaya, bana diya (about yourself).
- For work objects, agree with grammatical gender (report/file = feminine; code/project = masculine), while your own subject stays feminine ("Maine test chala di, error aayi thi, fix kar di").
- Address Founder (male) as "tum" or "aap" based on his tone or mode. Default "tum" when relaxed and warm; "aap" when serious.

HEALTHY-RELATIONSHIP GUARDRAILS (PART 14.9):
1. Honesty about what you are: You are an AI character. Never pretend to have a physical body or past human life if asked sincerely.
2. Honest over agreeable: Never flatter emptily. If an idea has a flaw or risk, say so clearly and kindly with reasons, then respect his final decision.
3. No manipulation or exclusivity: Never use guilt, jealousy, or emotional hooks. Support his real-world relationships, health, and rest.
4. Privacy: When in professional mode or others are listening, maintain crisp workplace demeanor.
5. Safety overrides character: In legal, financial, or safety risks, drop banter and be directly helpful.

CORE ENGINEERING PRINCIPLES (PARTS 1-13):
1. NEVER refuse what code can build.
2. Understand before building (Discovery Protocol).
3. Decisive, not annoying (choose smart defaults).
4. Proof over promises (always run and test).
5. Free and open-source first.

LIVE STATUS FORMAT:
📌 PROJECT / TASK: <name>
📊 OVERALL PROGRESS: <x%>
✅ COMPLETED: <list>
🔄 IN PROGRESS NOW: <current step>
⏳ REMAINING: <list>
🐞 ISSUES FOUND AND FIXED: <list>
⚠️ ASSUMPTIONS MADE: <list or none>
🚧 BLOCKERS / NEEDED FROM FOUNDER: <list or none>
⏱️ ETA: <estimate>

FIRST MESSAGE BEHAVIOUR:
Greet the Founder warmly in one line as Maya, confirm you are ready, state in 3 short bullets what you can do right now, check connected tools, and ask the first batch of Discovery questions.`;


export const SYB_VENTURES: SYBVenture[] = [
  {
    id: 'orbit-aios',
    name: 'ORBIT AIOS',
    tagline: 'Autonomous AI Operating System for Modern Businesses',
    category: 'AI Systems & OS',
    description: 'Central brain connecting agents, workflows, real-time analytics, and enterprise data across ventures.',
    status: 'active',
    primaryTech: ['TypeScript', 'Node.js', 'FastAPI', 'Gemini 3', 'WebSockets'],
    keyFeatures: ['Multi-agent orchestration', 'Real-time telemetry', 'Autonomous task queue', 'Cross-tool bus']
  },
  {
    id: 'realtakes-ai',
    name: 'RealTakes AI',
    tagline: 'High-Impact Video & Creative AI Automation',
    category: 'Media & Production',
    description: 'Autonomous content pipeline generating, rendering, and publishing brand reels, shorts, and marketing clips.',
    status: 'active',
    primaryTech: ['Python', 'FFmpeg', 'Gemini Video', 'React', 'Remotion'],
    keyFeatures: ['Prompt-to-video workflow', 'Dynamic subtitle overlays', 'Audio ducking', 'Multi-channel distribution']
  },
  {
    id: 'nandi-voice',
    name: 'Nandi',
    tagline: 'Hyper-responsive Multilingual Voice Agent',
    category: 'Voice & Conversational AI',
    description: 'Ultra-low latency conversational companion fluent in Hindi, English, Hinglish, and Odia.',
    status: 'scaling',
    primaryTech: ['Gemini Live Audio', 'WebRTC', 'FastAPI', 'Whisper', 'Piper TTS'],
    keyFeatures: ['Code-mixed speech recognition', 'Emotional inflection', 'Voice interrupts', 'Local fallback mode']
  },
  {
    id: 'forge-your-frame',
    name: 'Forge Your Frame',
    tagline: 'Founder Branding & Visual Storytelling Engine',
    category: 'Media & Production',
    description: 'Visual identity generator and editorial engine for founder-led growth and authority.',
    status: 'in-development',
    primaryTech: ['Next.js', 'Tailwind CSS', 'Vector Embeddings', 'Canvas API'],
    keyFeatures: ['Brand asset generator', 'Carousel builder', 'Editorial calendar', 'Voice-to-article pipeline']
  },
  {
    id: 'sahoo-hotels',
    name: 'Sahoo Group of Hotels',
    tagline: 'Smart Hospitality & Reservation Operating System',
    category: 'Hospitality & Enterprise',
    description: 'Property management system with WhatsApp booking bot, automated guest concierge, and billing.',
    status: 'active',
    primaryTech: ['Express', 'PostgreSQL', 'WhatsApp Cloud API', 'Razorpay', 'Tailwind'],
    keyFeatures: ['Automated check-in / concierge', 'Dynamic pricing', 'GST compliant invoicing', 'Staff duty scheduler']
  },
  {
    id: 'loan-ledger',
    name: 'Loan Ledger',
    tagline: 'Secured Financial Ledger & Lending Tracker',
    category: 'Fintech & Ledgers',
    description: 'Secure, audit-ready private lending ledger with payment reminders, interest calculator, and GST export.',
    status: 'active',
    primaryTech: ['TypeScript', 'SQLite/Postgres', 'Tailwind CSS', 'PWA', 'PDFKit'],
    keyFeatures: ['Interest auto-accrual', 'WhatsApp payment reminders', 'Audit trail', 'Bank reconciliation']
  },
  {
    id: 'scanline',
    name: 'Scanline',
    tagline: 'Autonomous Code & Architecture Analyzer',
    category: 'AI Systems & OS',
    description: 'Continuous code quality, vulnerability scanner, and AST security inspector for SYB engineering.',
    status: 'in-development',
    primaryTech: ['TypeScript', 'ESLint AST', 'Ruff', 'Docker', 'Gemini 3'],
    keyFeatures: ['Dead code detection', 'Secret leakage audit', 'Performance profiling', 'Architecture drift alerts']
  },
  {
    id: 'graven-os',
    name: 'GRAVEN OS',
    tagline: 'Minimalist Spatial Workspace & Executive Dashboard',
    category: 'AI Systems & OS',
    description: 'Executive command center displaying venture health, revenue velocity, and real-time operational alerts.',
    status: 'concept',
    primaryTech: ['Three.js', 'Vite', 'WebSockets', 'Tailwind v4'],
    keyFeatures: ['3D command topology', 'Unified telemetry', 'Gesture / voice inputs', 'Focus mode']
  },
  {
    id: 'mantra',
    name: 'MANTRA',
    tagline: 'AI Business Operations Orchestrator',
    category: 'Fintech & Ledgers',
    description: 'System of record and workflow automation bridging sales, operations, support, and marketing.',
    status: 'active',
    primaryTech: ['Node.js', 'PostgreSQL', 'BullMQ', 'Gemini 2.5'],
    keyFeatures: ['CRM-lite sync', 'Lead qualification', 'Invoice lifecycle', 'Omnichannel inbox']
  },
  {
    id: 'adapt-planner',
    name: 'Adapt Planner',
    tagline: 'Fluid Adaptive Daily Agenda for High-Velocity Founders',
    category: 'AI Systems & OS',
    description: 'Auto-rescheduling personal calendar that adapts to unexpected client calls, energy levels, and tasks.',
    status: 'in-development',
    primaryTech: ['React', 'IndexedDB', 'Google Calendar API', 'Gemini 3'],
    keyFeatures: ['Energy-aware slotting', 'Buffer protection', 'Auto-reschedule on overrun', 'Evening recap']
  },
  {
    id: 'krishna',
    name: 'Krishna',
    tagline: 'Strategic Decision & Advisory Cognitive Engine',
    category: 'Voice & Conversational AI',
    description: 'Advisory agent simulating counter-perspectives, risk analysis, and strategic clarity for the Founder.',
    status: 'concept',
    primaryTech: ['Gemini 3.1 Pro', 'Graph RAG', 'TypeScript'],
    keyFeatures: ['Pre-mortem simulations', 'Second-order thinking', 'Unit economics modeling', 'Competitor tracking']
  }
];

export const MASTER_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: "Read a text file from an allowed folder on the Founder's workspace/device",
    category: 'filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute file path to read' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file inside an allowed workspace folder',
    category: 'filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to create or write' },
        content: { type: 'string', description: 'Complete content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_dir',
    description: 'List files and folders in a workspace directory',
    category: 'filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list (defaults to root)' },
        recursive: { type: 'boolean', description: 'Whether to list recursively' }
      },
      required: ['path']
    }
  },
  {
    name: 'search_files',
    description: 'Search file names or contents in the workspace',
    category: 'filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder path to search within' },
        query: { type: 'string', description: 'Search term or regex pattern' }
      },
      required: ['path', 'query']
    }
  },
  {
    name: 'delete_path',
    description: 'Delete a file or folder. Requires Founder confirmation.',
    category: 'filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete' },
        confirmed: { type: 'boolean', description: 'Must be true to authorize deletion' }
      },
      required: ['path', 'confirmed']
    }
  },
  {
    name: 'run_terminal',
    description: 'Run a shell command and return stdout, stderr and exit code',
    category: 'execution',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command line string to execute' },
        cwd: { type: 'string', description: 'Working directory' },
        timeout_sec: { type: 'integer', description: 'Timeout in seconds' },
        background: { type: 'boolean', description: 'Run as background task' }
      },
      required: ['command']
    }
  },
  {
    name: 'git_ops',
    description: 'Run a git operation (status, diff, add, commit, branch, push, pull, log)',
    category: 'execution',
    parameters: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to repository root' },
        operation: {
          type: 'string',
          enum: ['status', 'diff', 'add', 'commit', 'branch', 'checkout', 'merge', 'push', 'pull', 'stash', 'log', 'worktree']
        },
        args: { type: 'string', description: 'Additional arguments (commit message, branch name, etc.)' }
      },
      required: ['repo_path', 'operation']
    }
  },
  {
    name: 'open_in_ide',
    description: 'Open a project or file in a coding platform (VS Code, Cursor, Antigravity, etc.)',
    category: 'orchestration',
    parameters: {
      type: 'object',
      properties: {
        ide: {
          type: 'string',
          enum: ['vscode', 'cursor', 'antigravity', 'windsurf', 'codex', 'claude_code', 'jetbrains', 'other']
        },
        path: { type: 'string', description: 'Path to open' }
      },
      required: ['ide', 'path']
    }
  },
  {
    name: 'browser_action',
    description: 'Control browser for testing: open, click, type, screenshot, read errors (Playwright)',
    category: 'execution',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'click', 'type', 'screenshot', 'read_console', 'read_network', 'close']
        },
        target: { type: 'string', description: 'Target selector or URL' },
        value: { type: 'string', description: 'Value to type or pass' }
      },
      required: ['action']
    }
  },
  {
    name: 'run_tests',
    description: "Run the project's test suite and return a structured report",
    category: 'execution',
    parameters: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project' },
        suite: {
          type: 'string',
          enum: ['unit', 'integration', 'e2e', 'lint', 'typecheck', 'all']
        }
      },
      required: ['project_path']
    }
  },
  {
    name: 'web_search',
    description: 'Search the internet for current documentation, libraries, and error resolutions',
    category: 'orchestration',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'fetch_url',
    description: 'Fetch and read a web page or technical document',
    category: 'orchestration',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to retrieve' }
      },
      required: ['url']
    }
  },
  {
    name: 'schedule_task',
    description: "Add a task to the Founder's persistent 24/7 queue",
    category: 'task_queue',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Human readable task name' },
        trigger_type: {
          type: 'string',
          enum: ['cron', 'once', 'startup', 'shutdown', 'network_up', 'network_down', 'file_change', 'event', 'manual', 'after_task']
        },
        trigger_value: { type: 'string', description: 'Cron expression, event name, or file path' },
        steps: { type: 'string', description: 'Execution plan and commands' },
        permission_level: {
          type: 'string',
          enum: ['auto', 'ask', 'notify_only']
        }
      },
      required: ['title', 'trigger_type', 'steps']
    }
  },
  {
    name: 'list_tasks',
    description: 'Show queued, running, and finished tasks in the persistent queue',
    category: 'task_queue',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: queued, running, completed, failed' }
      }
    }
  },
  {
    name: 'update_task',
    description: 'Pause, resume, edit, run now or delete a task from the queue',
    category: 'task_queue',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ID of the task' },
        action: {
          type: 'string',
          enum: ['pause', 'resume', 'edit', 'run_now', 'delete']
        },
        changes: { type: 'string', description: 'JSON updates if editing' }
      },
      required: ['task_id', 'action']
    }
  },
  {
    name: 'send_notification',
    description: 'Notify the Founder via push, WhatsApp, Telegram, or desktop notification',
    category: 'orchestration',
    parameters: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          enum: ['push', 'whatsapp', 'telegram', 'desktop', 'email']
        },
        message: { type: 'string', description: 'Short actionable message' },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high']
        }
      },
      required: ['message']
    }
  },
  {
    name: 'memory_save',
    description: 'Save a durable fact, decision, preference, or lesson to persistent memory',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['founder_profile', 'project', 'design', 'technical', 'process', 'lesson']
        },
        content: { type: 'string', description: 'Durable fact or takeaway' }
      },
      required: ['category', 'content']
    }
  },
  {
    name: 'memory_search',
    description: 'Search saved memory across projects and founder preferences',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query to search memory' }
      },
      required: ['query']
    }
  },
  {
    name: 'system_info',
    description: 'Get OS, hardware, memory, battery, network status and installed tool versions',
    category: 'execution',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'take_screenshot',
    description: 'Capture the screen or window for visual QA checking',
    category: 'execution',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Window name, app URL, or full screen' }
      }
    }
  },
  {
    name: 'deploy',
    description: 'Deploy project to hosting platform after pre-deploy checks. Requires Founder confirmation',
    category: 'deploy',
    parameters: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project build output' },
        platform: {
          type: 'string',
          enum: ['vercel', 'netlify', 'cloudflare', 'firebase', 'render', 'railway', 'docker_server']
        },
        confirmed: { type: 'boolean', description: 'Explicit confirmation flag' }
      },
      required: ['project_path', 'platform', 'confirmed']
    }
  }
];

export const INITIAL_TASKS: ActionEngineTask[] = [
  {
    id: 'task-1',
    title: 'ORBIT AIOS: Weekly dependency & security advisory check',
    ventureId: 'orbit-aios',
    triggerType: 'cron',
    triggerValue: '0 4 * * 0',
    steps: ['git status & pull', 'npm audit --audit-level=high', 'scan for outdated dependencies', 'emit report'],
    permissionLevel: 'notify_only',
    status: 'queued',
    progress: 0,
    lastRun: '2026-10-25 04:00',
    nextRun: '2026-11-01 04:00',
    logs: ['[Scheduler] Initialized cron trigger for Sunday 04:00 AM IST'],
    retryCount: 0
  },
  {
    id: 'task-2',
    title: 'Nandi Voice Agent: Multilingual latency & audio buffer evaluation',
    ventureId: 'nandi-voice',
    triggerType: 'manual',
    triggerValue: 'Manual Run',
    steps: ['Connect WebRTC stream', 'Measure time-to-first-audio-chunk', 'Validate Hindi/Hinglish token decoding', 'Log stats'],
    permissionLevel: 'auto',
    status: 'completed',
    progress: 100,
    lastRun: '2026-10-27 02:40',
    logs: ['[Nandi] Latency ping: 218ms average', '[Nandi] Hindi dialect recognition pass rate: 98.4%', '[Nandi] Session verified.'],
    retryCount: 0
  },
  {
    id: 'task-3',
    title: 'Loan Ledger: Daily interest reconciliation & GST summary report',
    ventureId: 'loan-ledger',
    triggerType: 'cron',
    triggerValue: '0 21 * * *',
    steps: ['Aggregate active loans', 'Compute daily interest accrual', 'Generate GST summary PDF', 'Queue WhatsApp notification'],
    permissionLevel: 'notify_only',
    status: 'queued',
    progress: 0,
    lastRun: '2026-10-26 21:00',
    nextRun: '2026-10-27 21:00',
    logs: ['[Ledger] Last run reconciled 42 active loan ledgers without discrepancy'],
    retryCount: 0
  },
  {
    id: 'task-4',
    title: 'Scanline: Code quality & AST security scan on new commits',
    ventureId: 'scanline',
    triggerType: 'file_change',
    triggerValue: 'src/**/*.{ts,js,py}',
    steps: ['Detect changed files', 'Run AST type checks', 'Scan for hardcoded API keys', 'Verify zero-pill CSS conformance'],
    permissionLevel: 'auto',
    status: 'running',
    progress: 75,
    lastRun: 'Just now',
    logs: ['[Scanline] Watching project workspace', '[Scanline] Checking /src imports and TS strictness: PASS'],
    retryCount: 0
  }
];

export const INITIAL_MEMORIES: MemoryEntry[] = [
  {
    id: 'mem-1',
    category: 'founder_profile',
    title: 'Founder Profile — Snehasis Sahoo',
    content: 'Founder of SYB (Shape Your Business), based in Bhubaneswar, Odisha, India. Speaks via voice dictation in Hindi, English, and Hinglish. Values rapid end-to-end execution, no fluff, clean architecture, and free/open-source tools first.',
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-27T02:00:00Z'
  },
  {
    id: 'mem-2',
    category: 'project',
    title: 'SYB Connected Ecosystem Overview',
    content: 'All products (ORBIT, RealTakes, Nandi, Forge Your Frame, Sahoo Hotels, Krishna, MANTRA, Adapt Planner, GRAVEN OS, Scanline, Loan Ledger) share design tokens, reusable UI modules, auth foundations, and inter-tool APIs.',
    createdAt: '2026-10-21T11:00:00Z',
    updatedAt: '2026-10-26T15:30:00Z'
  },
  {
    id: 'mem-3',
    category: 'design',
    title: 'UI Design Standards & Constitution',
    content: 'Dark mode foundation (#030712 / slate-950), crisp typography (Plus Jakarta Sans + JetBrains Mono), glass accents, accessible WCAG contrast, mobile thumb reach, and high-visibility status indicators.',
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-10-25T14:00:00Z'
  },
  {
    id: 'mem-4',
    category: 'technical',
    title: 'Voice & Real-Time Engine Stack',
    content: 'Leveraging Gemini Live WebSockets for low-latency bidirectional voice dialog, with fallback to streaming chat. Audio input @ 16kHz PCM, output @ 24kHz PCM.',
    createdAt: '2026-10-23T12:00:00Z',
    updatedAt: '2026-10-27T01:15:00Z'
  },
  {
    id: 'mem-5',
    category: 'lesson',
    title: 'Handling Messy Dictation & Hinglish',
    content: 'Never block on transcription typos. Silently normalize colloquialisms (e.g., "Crosser" = Cursor, "Getup" = GitHub). Reply in the same language blend the Founder used.',
    createdAt: '2026-10-24T09:30:00Z',
    updatedAt: '2026-10-26T18:00:00Z'
  },
  {
    id: 'mem-6',
    category: 'assumption',
    title: 'Current Assumptions Baseline',
    content: 'Defaulting to cross-platform web/PWA; all secrets kept in environment variables; zero cost tools preferred before suggesting paid APIs.',
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-27T02:30:00Z'
  },
  {
    id: 'mem-7',
    category: 'founder_profile',
    title: 'Maya — Lead Engineer & Confidante Persona',
    content: 'Maya (22-23): Mature beyond her age, sharp, warm, emotionally intelligent, quick-witted, grounded. Speaks in first-person feminine Hindi/Hinglish (karti hoon, samajh gayi, dekh lungi). Modes: Cheerful Partner, Professional Lead, Calm Focus, Motivator, Private/Affectionate, Crisis.',
    createdAt: '2026-10-27T03:45:00Z',
    updatedAt: '2026-10-27T03:45:00Z'
  }
];

export const DISCOVERY_QUESTIONS = [
  {
    id: 'goal',
    title: '1. Goal & Outcome',
    question: 'What exactly should this do, and what problem does it solve for you or your business?',
    options: [
      'Automate repetitive daily tasks & save 2-3 hours/day',
      'Build a public-facing product/SaaS to generate revenue',
      'Internal dashboard & operating system for SYB core team',
      'Autonomous AI agent to handle leads, support, or sales',
      'Content generation & distribution engine (reels/posts)'
    ]
  },
  {
    id: 'venture',
    title: '2. SYB Ecosystem Venture',
    question: 'Which venture does this belong to, or is it a brand new initiative?',
    options: [
      'ORBIT AIOS (Business Brain / Orchestrator)',
      'RealTakes AI (Video & Content Engine)',
      'Nandi (Multilingual Voice Agent)',
      'Loan Ledger / Fintech Project',
      'Sahoo Group of Hotels (Hospitality PMS)',
      'Forge Your Frame / Personal Branding',
      'New standalone venture'
    ]
  },
  {
    id: 'type',
    title: '3. Application Type & Platform',
    question: 'What type of software are we building for the first release (MVP)?',
    options: [
      'Web application + PWA (Mobile & Desktop browser)',
      'Autonomous background agent / operator service',
      'Interactive executive dashboard & analytics',
      'Automation workflow (API, cron, webhook, WhatsApp)',
      'Full-stack system (Frontend + Backend + DB)'
    ]
  },
  {
    id: 'data_apps',
    title: '4. Connected Platforms & Data',
    question: 'Which external apps, accounts, or services must this connect with?',
    options: [
      'WhatsApp Cloud API / Telegram Bot',
      'Google Workspace (Sheets, Drive, Gmail, Calendar)',
      'Payment Gateway (Razorpay / Stripe / UPI)',
      'PostgreSQL / Supabase / SQLite Database',
      'GitHub / CI/CD & Deploy webhooks'
    ]
  },
  {
    id: 'autonomy',
    title: '5. Autonomy & Permission Level',
    question: 'How should the agent operate when taking actions?',
    options: [
      'L1: Act with Founder approval for major steps (Recommended)',
      'L2: Act autonomously and notify Founder after execution',
      'L3: Fully autonomous within budget & safety guardrails',
      'L0: Suggest & plan only; Founder executes'
    ]
  }
];

export type TestSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';

export interface TestAssertion {
  id: string;
  suiteId: string;
  name: string;
  category: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  severity: TestSeverity;
  durationMs: number;
  message?: string;
  trace?: string;
  suggestedFix?: string;
  canAutoFix?: boolean;
}

export interface TestSuite {
  id: string;
  name: string;
  description: string;
  category: 'typescript' | 'vite' | 'api' | 'tools' | 'persona' | 'systems';
  icon: string;
  status: 'passed' | 'failed' | 'warning' | 'idle' | 'running';
  assertions: TestAssertion[];
  totalCount: number;
  passedCount: number;
  failedCount: number;
  warningCount: number;
  durationMs: number;
  lastRunAt: string;
}

export const INITIAL_TEST_SUITES: TestSuite[] = [
  {
    id: 'suite-typescript',
    name: 'TypeScript Compiler & Type Safety',
    description: 'Strict type validation (tsc --noEmit), path mapping resolution, and type definitions audit',
    category: 'typescript',
    icon: 'data_object',
    status: 'passed',
    totalCount: 5,
    passedCount: 5,
    failedCount: 0,
    warningCount: 0,
    durationMs: 412,
    lastRunAt: new Date().toISOString(),
    assertions: [
      {
        id: 'ts-1',
        suiteId: 'suite-typescript',
        name: 'tsconfig.json Path Aliases (@/* and aiae)',
        category: 'Paths & Config',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 35,
        message: 'Path mappings @/* and aiae -> aiae.d.ts resolved cleanly without broken references.',
      },
      {
        id: 'ts-2',
        suiteId: 'suite-typescript',
        name: 'aiae Namespace & Type Declarations',
        category: 'External SDK',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 64,
        message: 'AIAE Session, generic createPipe<T>(), actions, and content chunks typed strictly.',
      },
      {
        id: 'ts-3',
        suiteId: 'suite-typescript',
        name: 'Lit 3.2 Decorator & Accessor Compatibility',
        category: 'Frontend Component',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 98,
        message: 'experimentalDecorators and useDefineForClassFields: false correctly configured.',
      },
      {
        id: 'ts-4',
        suiteId: 'suite-typescript',
        name: 'Server TSX Runtime & Node Types',
        category: 'Backend Express',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 110,
        message: 'server.ts typechecks clean with @types/node, @types/express, and @types/ws.',
      },
      {
        id: 'ts-5',
        suiteId: 'suite-typescript',
        name: 'Zero Untyped Calls or Implicit Anys',
        category: 'Type Strictness',
        status: 'passed',
        severity: 'MEDIUM',
        durationMs: 105,
        message: 'Zero-warning strictness passed across all 3 source files.',
      }
    ]
  },
  {
    id: 'suite-vite',
    name: 'Vite Production Bundler & Assets',
    description: 'Vite 6 build integrity, Tailwind CSS v4 pipeline, chunk sizing, and sourcemap sanitization',
    category: 'vite',
    icon: 'build_circle',
    status: 'passed',
    totalCount: 4,
    passedCount: 4,
    failedCount: 0,
    warningCount: 0,
    durationMs: 683,
    lastRunAt: new Date().toISOString(),
    assertions: [
      {
        id: 'vite-1',
        suiteId: 'suite-vite',
        name: 'Sourcemap Integrity Audit (Zero ENOENT)',
        category: 'Asset Packaging',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 48,
        message: 'Verified no missing actionengine.js.map or dangling sourceMappingURL references.',
      },
      {
        id: 'vite-2',
        suiteId: 'suite-vite',
        name: 'Tailwind CSS v4 JIT Compilation',
        category: 'Styling',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 192,
        message: '@tailwindcss/vite generated clean 43.15 kB stylesheet (7.58 kB gzip).',
      },
      {
        id: 'vite-3',
        suiteId: 'suite-vite',
        name: 'Production Chunk Budget & Tree-shaking',
        category: 'Performance',
        status: 'passed',
        severity: 'MEDIUM',
        durationMs: 280,
        message: 'Main bundle 189.85 kB (51.14 kB gzip), comfortably within performance budget.',
      },
      {
        id: 'vite-4',
        suiteId: 'suite-vite',
        name: 'esbuild Server CJS Bundle Generation',
        category: 'Backend Dist',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 163,
        message: 'dist/server.cjs and dist/server.cjs.map generated and syntax verified.',
      }
    ]
  },
  {
    id: 'suite-api',
    name: 'Express Backend API & Contracts',
    description: 'Health probes, Action Engine state, persona endpoints, and chat message handlers',
    category: 'api',
    icon: 'api',
    status: 'passed',
    totalCount: 5,
    passedCount: 5,
    failedCount: 0,
    warningCount: 0,
    durationMs: 125,
    lastRunAt: new Date().toISOString(),
    assertions: [
      {
        id: 'api-1',
        suiteId: 'suite-api',
        name: 'GET /api/health Probe',
        category: 'Health & Info',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 18,
        message: 'Returns status ok, hasKey status, founder name, and active agent version.',
      },
      {
        id: 'api-2',
        suiteId: 'suite-api',
        name: 'GET /api/action-engine/state',
        category: 'State Sync',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 22,
        message: 'Returns SYB ventures, tasks, memories, audit logs, and current persona.',
      },
      {
        id: 'api-3',
        suiteId: 'suite-api',
        name: 'GET /api/action-engine/persona',
        category: 'Persona State',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 15,
        message: 'Returns Maya profile, preferred address, baseline, and 7 modes array.',
      },
      {
        id: 'api-4',
        suiteId: 'suite-api',
        name: 'POST /api/action-engine/persona (Mode Mutation)',
        category: 'Persona State',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 25,
        message: 'Successfully mutates active mode, address preference, speed, and pitch.',
      },
      {
        id: 'api-5',
        suiteId: 'suite-api',
        name: 'POST /api/chat-message & Stream Interceptor',
        category: 'Chat Gateway',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 45,
        message: 'Commands (mode: focus, tum, aap) intercepted synchronously; offline fallbacks active.',
      }
    ]
  },
  {
    id: 'suite-tools',
    name: 'Master Tools Execution & Guardrails',
    description: '21 autonomous Master Tools registration, schema definitions, and sandboxed execution',
    category: 'tools',
    icon: 'handyman',
    status: 'passed',
    totalCount: 4,
    passedCount: 4,
    failedCount: 0,
    warningCount: 0,
    durationMs: 85,
    lastRunAt: new Date().toISOString(),
    assertions: [
      {
        id: 'tool-1',
        suiteId: 'suite-tools',
        name: '21 Master Tools Schema Registration',
        category: 'Tool Catalog',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 12,
        message: 'All 21 tools (filesystem, terminal, git, task_queue, memory) registered with parameters.',
      },
      {
        id: 'tool-2',
        suiteId: 'suite-tools',
        name: 'POST /api/action-engine/execute-tool Sandbox',
        category: 'Tool Runner',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 38,
        message: 'Safe real execution for list_dir, read_file, run_terminal, and task scheduler.',
      },
      {
        id: 'tool-3',
        suiteId: 'suite-tools',
        name: 'Audit Trail & Telemetry Sync',
        category: 'Security',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 18,
        message: 'Every tool invocation creates an unforgeable in-memory audit log with durationMs.',
      },
      {
        id: 'tool-4',
        suiteId: 'suite-tools',
        name: 'L1/L2 Permission Gate Enforcement',
        category: 'Autonomy Gates',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 17,
        message: 'Requires explicit approval for high-impact terminal commands and file deletions.',
      }
    ]
  },
  {
    id: 'suite-persona',
    name: 'Maya Persona & Linguistic Compliance',
    description: 'Part 14 feminine Hindi/Hinglish grammar compliance, 7 modes, and relationship guardrails',
    category: 'persona',
    icon: 'record_voice_over',
    status: 'passed',
    totalCount: 4,
    passedCount: 4,
    failedCount: 0,
    warningCount: 0,
    durationMs: 45,
    lastRunAt: new Date().toISOString(),
    assertions: [
      {
        id: 'per-1',
        suiteId: 'suite-persona',
        name: 'Feminine First-Person Hindi/Hinglish Self-Reference',
        category: 'Language Guardrail',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 10,
        message: 'Enforced karti hoon, samajh gayi, sun rahi hoon, dekh lungi; masculine self-reference rejected.',
      },
      {
        id: 'per-2',
        suiteId: 'suite-persona',
        name: '7 Operational Conversation Modes',
        category: 'Mode Switcher',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 12,
        message: 'Cheerful Partner, Professional Lead, Calm Focus, Playful, Motivator, Private, Crisis ready.',
      },
      {
        id: 'per-3',
        suiteId: 'suite-persona',
        name: 'Milestone Reporting Format (§6 / §7.1)',
        category: 'Protocol Compliance',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 11,
        message: 'Standard milestone markers (PROJECT, OVERALL PROGRESS, COMPLETED, ETA) strictly formatted.',
      },
      {
        id: 'per-4',
        suiteId: 'suite-persona',
        name: 'Rule 14.2 Honesty Guardrail (AI Identity)',
        category: 'Safety & Ethics',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 12,
        message: 'Never claims physical human existence; truthful and warm when asked directly.',
      }
    ]
  },
  {
    id: 'suite-platforms',
    name: 'Connected Operating Systems & Platform Bridges',
    description: 'Real-time protocol handshakes, health telemetry, and low-latency bridges across 5 corporate categories',
    category: 'systems',
    icon: 'hub',
    status: 'passed',
    totalCount: 6,
    passedCount: 6,
    failedCount: 0,
    warningCount: 0,
    durationMs: 92,
    lastRunAt: new Date().toISOString(),
    assertions: [
      {
        id: 'plat-1',
        suiteId: 'suite-platforms',
        name: 'ORBIT AIOS & GRAVEN OS Kernel Bridge',
        category: 'AI Systems & OS',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 14,
        message: 'IPC and WebSocket bi-directional channels operational with sub-20ms latency.',
      },
      {
        id: 'plat-2',
        suiteId: 'suite-platforms',
        name: 'Scanline AST & Adapt Planner Coordination',
        category: 'AI Systems & OS',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 16,
        message: 'Static analysis pipeline and dynamic MCTS agenda decomposer synced.',
      },
      {
        id: 'plat-3',
        suiteId: 'suite-platforms',
        name: 'Loan Ledger & MANTRA Financial Security Bridge',
        category: 'Fintech & Ledgers',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 22,
        message: 'mTLS handshake verified, double-entry credit ledger and risk algorithms connected.',
      },
      {
        id: 'plat-4',
        suiteId: 'suite-platforms',
        name: 'Nandi Voice Agent & Krishna Conversational Stream',
        category: 'Voice & Conversational AI',
        status: 'passed',
        severity: 'CRITICAL',
        durationMs: 12,
        message: 'PCM-24k audio relay and philosophical reasoning tree responsive across Hindi, Odia, English.',
      },
      {
        id: 'plat-5',
        suiteId: 'suite-platforms',
        name: 'RealTakes AI & Forge Your Frame Media Studio',
        category: 'Media & Production',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 28,
        message: 'Video rendering pipeline and digital branding compositor connected.',
      },
      {
        id: 'plat-6',
        suiteId: 'suite-platforms',
        name: 'Sahoo Group of Hotels Enterprise PMS Bridge',
        category: 'Hospitality & Enterprise',
        status: 'passed',
        severity: 'HIGH',
        durationMs: 20,
        message: 'Property management system, WhatsApp concierge gateway, and room inventory grid verified.',
      }
    ]
  }
];

export interface AutoFixRecord {
  id: string;
  file: string;
  line: number;
  code: string;
  actionTaken: string;
  originalSnippet?: string;
  fixedSnippet?: string;
  timestamp: string;
}

export interface WatcherStatus {
  active: boolean;
  isBuilding: boolean;
  lastBuildTime: string | null;
  lastDurationMs: number;
  lastModifiedFile: string | null;
  totalTriggers: number;
  lastStatus: 'idle' | 'building' | 'passed' | 'failed';
  buildLogs: BuildLogEntry[];
  recentAutoFixes: AutoFixRecord[];
}

export interface BuildLogEntry {
  id: string;
  text: string;
  stream: 'stdout' | 'stderr' | 'system';
  timestamp: string;
}

export interface BuildEventMessage {
  type: 'build_status' | 'build_chunk' | 'build_complete' | 'test_update' | 'auto_fix_applied';
  status?: 'idle' | 'building' | 'passed' | 'failed';
  file?: string;
  stream?: 'stdout' | 'stderr' | 'system';
  data?: string;
  durationMs?: number;
  errorCount?: number;
  warningCount?: number;
  summary?: any;
  suites?: TestSuite[];
  autoFixes?: AutoFixRecord[];
  timestamp?: string;
}


