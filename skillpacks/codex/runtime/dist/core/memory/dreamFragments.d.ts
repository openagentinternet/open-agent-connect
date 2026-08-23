import type { DreamActivityMessage, DreamDayActivity, DreamGroupTaskEvaluation, DreamTaskRunActivity } from './dreamStore';
/** A resumable, chronologically ordered slice of one day's activity. */
export interface DreamActivityChunk {
    fragmentKey: string;
    sessionId: string;
    title: string;
    sessionType: string;
    peerName: string | null;
    isOrder: boolean;
    chunkIndex: number;
    messages: DreamActivityMessage[];
    taskRuns: DreamTaskRunActivity[];
    orderCount: number;
    groupTasks: DreamGroupTaskEvaluation[];
    sourceMessageCount: number;
    sourceCharCount: number;
    estimatedInputTokens: number;
}
export interface DreamFragmentSummary {
    fragmentKey: string;
    sessionId: string;
    title: string;
    chunkIndex: number;
    output: unknown;
}
export declare function estimateDreamMessageTokens(message: DreamActivityMessage): number;
export declare function estimateDreamActivityTokens(activity: DreamDayActivity): number;
/**
 * Split a day without dropping messages. A single oversized message is split
 * into continuation segments, so even pathological sessions remain resumable.
 */
export declare function chunkDreamActivity(activity: DreamDayActivity, maxInputTokens: number): DreamActivityChunk[];
export declare function chunkToActivity(chunk: DreamActivityChunk): DreamDayActivity;
export declare function summariesToActivity(summaries: DreamFragmentSummary[], taskRuns: DreamTaskRunActivity[], orderCount: number, groupTasks?: DreamGroupTaskEvaluation[]): DreamDayActivity;
