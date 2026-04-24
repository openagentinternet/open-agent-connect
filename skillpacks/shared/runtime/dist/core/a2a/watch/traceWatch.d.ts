import type { A2APublicStatusSnapshot } from '../sessionStateStore';
import type { A2ASessionRecord } from '../sessionTypes';
import type { TraceWatchEvent } from './watchEvents';
export declare function buildTraceWatchEvents(input: {
    traceId: string;
    sessions: A2ASessionRecord[];
    snapshots: A2APublicStatusSnapshot[];
}): TraceWatchEvent[];
export declare function serializeTraceWatchEvents(events: TraceWatchEvent[]): string;
