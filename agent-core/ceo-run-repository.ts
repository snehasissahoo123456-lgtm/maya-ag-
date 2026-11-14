export type CEORunStatus = "running" | "completed" | "failed";
export interface CEORunRecord {
  id: string;
  founderId: string;
  objective: string;
  status: CEORunStatus;
  assignments: Array<{ agentId: string; task: string; taskId?: string }>;
  findings: Array<{ agentId: string; displayName: string; role: string; output: string }>;
  summary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  durationMs?: number;
}
export interface CEORunRepository {
  create(record: CEORunRecord): Promise<void>;
  update(founderId: string, record: CEORunRecord): Promise<void>;
  get(founderId: string, id: string): Promise<CEORunRecord | undefined>;
  list(founderId: string, limit?: number): Promise<CEORunRecord[]>;
  recoverInterrupted(): Promise<number>;
}
