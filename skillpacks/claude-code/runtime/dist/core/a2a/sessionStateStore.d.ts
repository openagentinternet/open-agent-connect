import type { MetabotPaths } from '../state/paths';
import type { A2ASessionRecord, A2ASessionRole, A2ATaskRunRecord } from './sessionTypes';
import type { PublicStatus } from './publicStatus';
export type A2ATranscriptSender = 'caller' | 'provider' | 'system';
export type A2ALoopCursor = string | number | null;
export interface A2ALoopCursors {
    caller: A2ALoopCursor;
    provider: A2ALoopCursor;
}
export interface A2ATranscriptItemRecord {
    id: string;
    sessionId: string;
    taskRunId?: string | null;
    timestamp: number;
    type: string;
    sender: A2ATranscriptSender;
    content: string;
    metadata?: Record<string, unknown> | null;
}
export interface A2APublicStatusSnapshot {
    sessionId: string;
    taskRunId?: string | null;
    status: PublicStatus | null;
    mapped: boolean;
    rawEvent?: string | null;
    resolvedAt: number;
}
export interface A2ASessionStoreState {
    version: number;
    sessions: A2ASessionRecord[];
    taskRuns: A2ATaskRunRecord[];
    transcriptItems: A2ATranscriptItemRecord[];
    cursors: A2ALoopCursors;
    publicStatusSnapshots: A2APublicStatusSnapshot[];
}
export interface A2ASessionStateStore {
    paths: MetabotPaths;
    sessionStatePath: string;
    ensureLayout(): Promise<MetabotPaths>;
    readState(): Promise<A2ASessionStoreState>;
    writeState(nextState: A2ASessionStoreState): Promise<A2ASessionStoreState>;
    updateState(updater: (currentState: A2ASessionStoreState) => A2ASessionStoreState | Promise<A2ASessionStoreState>): Promise<A2ASessionStoreState>;
    writeSession(record: A2ASessionRecord): Promise<A2ASessionRecord>;
    writeTaskRun(record: A2ATaskRunRecord): Promise<A2ATaskRunRecord>;
    appendTranscriptItems(items: A2ATranscriptItemRecord[]): Promise<A2ATranscriptItemRecord[]>;
    appendPublicStatusSnapshots(items: A2APublicStatusSnapshot[]): Promise<A2APublicStatusSnapshot[]>;
    setLoopCursor(role: A2ASessionRole, cursor: A2ALoopCursor): Promise<A2ALoopCursor>;
    readLoopCursor(role: A2ASessionRole): Promise<A2ALoopCursor>;
}
export declare function createSessionStateStore(homeDirOrPaths: string | MetabotPaths): A2ASessionStateStore;
