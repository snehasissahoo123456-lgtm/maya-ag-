export type MayaAuditEventType =
  | "task.enqueued"
  | "task.approval_requested"
  | "task.approval_decided"
  | "task.execution_started"
  | "task.execution_verified"
  | "task.execution_failed"
  | "specialist.tool_succeeded"
  | "specialist.tool_denied"
  | "specialist.tool_failed";

export interface MayaAuditEvent {
  id: string;
  founderId: string;
  actorId: string;
  actorRole: string;
  type: MayaAuditEventType;
  taskId: string;
  capability: string;
  actionDigest: string;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AuditRepository {
  append(event: MayaAuditEvent): Promise<void>;
  list(founderId: string, limit?: number): Promise<MayaAuditEvent[]>;
}
