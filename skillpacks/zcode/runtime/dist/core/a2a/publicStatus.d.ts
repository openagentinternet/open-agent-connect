export type PublicStatus = 'discovered' | 'awaiting_confirmation' | 'requesting_remote' | 'remote_received' | 'remote_executing' | 'completed' | 'no_service_found' | 'delegation_declined' | 'delegation_expired' | 'timeout' | 'remote_failed' | 'manual_action_required' | 'network_unavailable' | 'local_runtime_error';
/**
 * Events that currently drive the trace-derived subset of public statuses.
 * Additional transport / session hooks can map more statuses independently when needed.
 */
export type TraceDerivedEventName = 'request_sent' | 'provider_received' | 'provider_executing' | 'provider_completed' | 'timeout' | 'provider_failed' | 'clarification_needed';
export type TraceEventInput = {
    /** Optional event label emitted by the session/trace engine. */
    event?: TraceDerivedEventName | string;
};
export type PublicStatusResolution = {
    status: PublicStatus | null;
    /** The raw event label seen by the resolver (if any) for future tracing/debugging. */
    rawEvent?: string;
    /** Indicates whether the trace event was explicitly mapped to a public status. */
    mapped: boolean;
};
/**
 * Returns both the resolved public status and the raw event label (if any) for tracing.
 */
export declare function resolvePublicStatus(trace?: TraceEventInput): PublicStatusResolution;
/**
 * Convenience helper for consumers that only need the status value.
 */
export declare function mapPublicStatus(trace?: TraceEventInput): PublicStatus | null;
