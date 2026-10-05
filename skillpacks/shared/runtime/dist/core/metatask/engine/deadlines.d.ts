import type { MetaTaskTaskProjection } from './types';
export interface NextDeadlineOptions {
    /** Candidate `timestampMs` values of challenge pins scoped to the task. */
    challengeTimestampsMs?: number[];
}
export declare function nextTimeDeadlineMs(projection: MetaTaskTaskProjection, options?: NextDeadlineOptions): number | null;
