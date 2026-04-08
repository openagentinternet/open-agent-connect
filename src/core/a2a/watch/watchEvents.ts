import type { PublicStatus } from '../publicStatus';

export interface TraceWatchEvent {
  traceId: string;
  sessionId: string;
  taskRunId: string | null;
  status: PublicStatus;
  terminal: boolean;
  observedAt: number;
}

const TERMINAL_TRACE_WATCH_STATUSES = new Set<PublicStatus>([
  'completed',
  'manual_action_required',
  'timeout',
  'remote_failed',
  'network_unavailable',
  'local_runtime_error',
  'no_service_found',
  'delegation_declined',
  'delegation_expired',
]);

export function isTerminalTraceWatchStatus(status: PublicStatus): boolean {
  return TERMINAL_TRACE_WATCH_STATUSES.has(status);
}
