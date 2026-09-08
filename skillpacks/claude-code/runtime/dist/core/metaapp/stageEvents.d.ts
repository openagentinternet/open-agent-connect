/**
 * Op-keyed stage hub for MetaApp publish/update progress. Daemon handlers
 * publish stage events under a caller-chosen op id; SSE subscribers replay
 * the buffered sequence and then follow live events until a terminal
 * `done`/`error` stage arrives. In-memory by design: per-op buffers, a short
 * TTL, and an op cap keep it bounded.
 */
export interface MetaAppStageEvent {
    op: string;
    stage: string;
    at: number;
    [key: string]: unknown;
}
export interface MetaAppStageHub {
    publish(op: string, event: {
        stage: string;
    } & Record<string, unknown>): void;
    /** Replays buffered events, then registers for live ones. Returns an unsubscribe function. */
    subscribe(op: string, listener: (event: MetaAppStageEvent) => void): () => void;
}
export declare function createMetaAppStageHub(input?: {
    now?: () => number;
    bufferSize?: number;
    ttlMs?: number;
    maxOps?: number;
}): MetaAppStageHub;
