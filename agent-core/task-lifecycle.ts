/**
 * Maya task lifecycle primitives shared by the cloud and local runtimes.
 */
export type TaskStatus =
  | "queued" | "planning" | "awaiting_approval" | "running" | "verifying"
  | "completed" | "failed" | "paused" | "cancelled" | "requires_recovery";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface VerificationEvidence {
  kind: string;
  description: string;
  reference?: string;
  observedAt: string;
}
export interface MayaTask {
  id: string;
  founderId: string;
  instruction: string;
  status: TaskStatus;
  riskLevel: RiskLevel;
  assignedDeviceId?: string;
  requiresApproval: boolean;
  approvalGrantedAt?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  verificationEvidence: VerificationEvidence[];
}
export interface CreateTaskInput {
  id: string;
  founderId: string;
  instruction: string;
  riskLevel?: RiskLevel;
  assignedDeviceId?: string;
  requiresApproval?: boolean;
}
export interface FounderApprovalGrant {
  approvalId: string;
  taskId: string;
  founderId: string;
  approvedAt: string;
}

export interface TransitionOptions {
  /** Must be created only after server-side Founder approval verification. */
  approval?: FounderApprovalGrant;
  evidence?: VerificationEvidence;
  error?: string;
  now?: string;
}

const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "cancelled"]);
const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["planning", "cancelled"],
  planning: ["awaiting_approval", "running", "failed", "paused", "cancelled"],
  awaiting_approval: ["queued", "running", "paused", "cancelled"],
  running: ["verifying", "failed", "paused", "requires_recovery", "cancelled"],
  verifying: ["completed", "failed", "paused", "requires_recovery"],
  completed: [],
  failed: ["queued", "cancelled"],
  paused: ["queued", "running", "cancelled", "requires_recovery"],
  cancelled: [],
  requires_recovery: ["queued", "paused", "cancelled"],
};

export class TaskTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskTransitionError";
  }
}

export function createTask(input: CreateTaskInput, now = new Date().toISOString()): MayaTask {
  const instruction = input.instruction.trim();
  if (!input.id.trim()) throw new Error("Task id is required.");
  if (!input.founderId.trim()) throw new Error("Founder identity is required.");
  if (!instruction) throw new Error("Task instruction cannot be empty.");

  const riskLevel = input.riskLevel ?? "low";
  const requiresApproval = riskLevel === "high" || riskLevel === "critical" || input.requiresApproval === true;
  return {
    id: input.id,
    founderId: input.founderId,
    instruction,
    status: "queued",
    riskLevel,
    assignedDeviceId: input.assignedDeviceId,
    requiresApproval,
    progress: 0,
    createdAt: now,
    updatedAt: now,
    verificationEvidence: [],
  };
}

export function transitionTask(
  task: MayaTask,
  nextStatus: TaskStatus,
  options: TransitionOptions = {},
): MayaTask {
  if (TERMINAL_STATUSES.has(task.status)) {
    throw new TaskTransitionError("Task in terminal state " + task.status + " cannot transition.");
  }
  if (!ALLOWED_TRANSITIONS[task.status].includes(nextStatus)) {
    throw new TaskTransitionError("Invalid task transition: " + task.status + " -> " + nextStatus + ".");
  }
  if (nextStatus === "running" && (task.requiresApproval || task.status === "awaiting_approval")) {
    const approval = options.approval;
    if (
      !approval ||
      !approval.approvalId.trim() ||
      approval.taskId !== task.id ||
      approval.founderId !== task.founderId ||
      !Number.isFinite(Date.parse(approval.approvedAt))
    ) {
      throw new TaskTransitionError("A valid Founder approval grant for this exact task is required before execution.");
    }
  }
  if (nextStatus === "completed" && task.status !== "verifying") {
    throw new TaskTransitionError("A task can only complete from the verifying state.");
  }
  if (nextStatus === "completed" && !options.evidence?.description.trim()) {
    throw new TaskTransitionError("Completion requires non-empty verification evidence.");
  }

  const now = options.now ?? new Date().toISOString();
  const evidence = nextStatus === "completed" && options.evidence
    ? [...task.verificationEvidence, options.evidence]
    : task.verificationEvidence;
  const progress = nextStatus === "completed" ? 100
    : nextStatus === "queued" ? 0
    : nextStatus === "planning" ? Math.max(task.progress, 5)
    : nextStatus === "running" ? Math.max(task.progress, 10)
    : nextStatus === "verifying" ? Math.max(task.progress, 90)
    : task.progress;

  return {
    ...task,
    status: nextStatus,
    progress,
    approvalGrantedAt: options.approval ? options.approval.approvedAt : (nextStatus === "queued" ? undefined : task.approvalGrantedAt),
    verificationEvidence: evidence,
    lastError: nextStatus === "queued" ? undefined : nextStatus === "failed" ? (options.error ?? "Task failed without a recorded reason.") : (options.error ?? task.lastError),
    updatedAt: now,
  };
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
