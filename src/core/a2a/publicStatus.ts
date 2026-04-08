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

/**
 * Events that currently drive the trace-derived subset of public statuses.
 * Additional transport / session hooks can map more statuses independently when needed.
 */
export type TraceDerivedEventName =
  | 'request_sent'
  | 'provider_received'
  | 'provider_executing'
  | 'provider_completed'
  | 'timeout'
  | 'provider_failed'
  | 'clarification_needed';

export type TraceEventInput = {
  /** Optional event label emitted by the session/trace engine. */
  event?: TraceDerivedEventName | string;
};

const eventMap: Record<TraceDerivedEventName, PublicStatus> = {
  request_sent: 'requesting_remote',
  provider_received: 'remote_received',
  provider_executing: 'remote_executing',
  provider_completed: 'completed',
  timeout: 'timeout',
  provider_failed: 'remote_failed',
  clarification_needed: 'manual_action_required',
};

/**
 * Maps low-level trace events into the host-facing public status model.
 * Any unknown or missing event should surface a clear exception state rather than silently resembling progress.
 */
export function mapPublicStatus(trace: TraceEventInput): PublicStatus {
  const key = trace?.event;
  if (!key || !(key in eventMap)) {
    return 'local_runtime_error';
  }

  return eventMap[key as TraceDerivedEventName];
}
