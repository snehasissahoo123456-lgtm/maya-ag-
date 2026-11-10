export type ScheduledJobStatus = "active" | "paused" | "completed";
export interface ScheduledReadJob {
  id: string;
  founderId: string;
  title: string;
  path: string;
  status: ScheduledJobStatus;
  nextRunAt: string;
  intervalMs: number | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  runCount: number;
  failureCount: number;
  lastError?: string;
}
export interface ScheduledJobRepository {
  create(job: ScheduledReadJob): Promise<void>;
  get(founderId: string, id: string): Promise<ScheduledReadJob | undefined>;
  list(founderId: string): Promise<ScheduledReadJob[]>;
  listDue(founderId: string, now: string, limit: number): Promise<ScheduledReadJob[]>;
  claimDue?(founderId: string, workerId: string, leaseMs: number, limit: number): Promise<ScheduledReadJob[]>;
  markEnqueued(founderId: string, id: string, scheduledAt: string, nextRunAt: string | null, workerId?: string): Promise<void>;
  recordFailure(founderId: string, id: string, error: string, workerId?: string): Promise<void>;
  pause(founderId: string, id: string): Promise<boolean>;
}
