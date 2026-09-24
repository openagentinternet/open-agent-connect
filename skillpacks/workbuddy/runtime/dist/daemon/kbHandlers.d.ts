/**
 * Daemon-side knowledge-base handler group: the /api/kb/* verbs. KB
 * management (list/create/update/remove/query/add-document/learn) ports the
 * `metabot knowledge-base *` CLI dependency handlers against
 * core/knowledgebase stores; the study verbs (study/status/enqueue/retry)
 * mirror the DSH `metaweb_study_*` tool semantics against
 * core/knowledgebase/studyJobs (the daemon nightly tick drains the queue).
 */
import { commandFailed } from '../core/contracts/commandResult';
import { type StudyJobRecord, type StudyJobStore } from '../core/knowledgebase/studyJobs';
import type { DreamBotRef } from './dreamHandlers';
import type { MetabotDaemonHttpHandlers } from './routes/types';
/**
 * Shared failed-study-job retry selection + requeue (DSH metaweb_study_retry
 * semantics): an explicit jobId must exist for this bot; otherwise every
 * failed job matches, narrowed by an optional topic substring. Exported so the
 * CLI `knowledge-base study retry` dependency drives the exact same logic and
 * returns the exact same shape as the /api/kb/study/retry handler.
 */
export declare function retryFailedStudyJobs(input: {
    store: StudyJobStore;
    slug: string;
    jobId?: string;
    topic?: string;
}): Promise<{
    retried: StudyJobRecord[];
} | {
    failure: ReturnType<typeof commandFailed>;
}>;
export interface KbDaemonHandlersInput {
    /** Resolve the acting bot (explicit slug, else the machine Twin). */
    resolveBot: (from?: string) => Promise<DreamBotRef | {
        failure: ReturnType<typeof commandFailed>;
    }>;
}
export declare function createKbDaemonHandlers(input: KbDaemonHandlersInput): NonNullable<MetabotDaemonHttpHandlers['kb']>;
