export type PublicStatus =
  | 'discovered'
  | 'awaiting_confirmation'
  | 'requesting_remote'
  | 'remote_received'
  | 'remote_executing'
  | 'completed'
  | 'no_service_found'
  | 'delegation_declined'
  | 'delegation_expired'
  | 'timeout'
  | 'remote_failed'
  | 'manual_action_required'
  | 'network_unavailable'
  | 'local_runtime_error';

export type TraceEventInput = {
  /** The low-level event identifier emitted by the session engine. */
  event?: string;
  /** Optional transport-specific detail that lower layers may provide. */
  detail?: string;
};

const eventMap: Record<string, PublicStatus> = {
  request_sent: 'requesting_remote',
  provider_received: 'remote_received',
  provider_executing: 'remote_executing',
  timeout: 'timeout',
  provider_failed: 'remote_failed',
  clarification_needed: 'manual_action_required',
};

/**
 * Maps low-level trace events into the host-facing public status model.
 */
export function mapPublicStatus(trace: TraceEventInput): PublicStatus {
  const key = trace?.event ?? '';
  return eventMap[key] ?? 'discovered';
}
