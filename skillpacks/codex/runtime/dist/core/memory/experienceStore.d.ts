import type { MetabotPaths } from '../state/paths';
export declare const EXPERIENCE_EPISODE_TYPES: readonly ["direct_interaction", "task_participation", "service_order", "scheduled_task", "public_pin_observation", "third_party_reference"];
export type ExperienceEpisodeType = typeof EXPERIENCE_EPISODE_TYPES[number];
export type ExperienceEpisodeStatus = 'open' | 'completed' | 'failed' | 'abandoned';
export interface ExperienceEpisode {
    id: string;
    ownerGlobalMetaId: string;
    episodeType: ExperienceEpisodeType;
    sourceChannel: string;
    sourceKey: string;
    sessionId: string | null;
    externalConversationId: string | null;
    taskId: string | null;
    orderId: string | null;
    status: ExperienceEpisodeStatus;
    startedAt: number;
    endedAt: number | null;
    metadata: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}
export interface ExperienceParticipant {
    episodeId: string;
    globalMetaId: string | null;
    unresolvedActorKey: string | null;
    identityState: 'known' | 'unknown';
    role: string;
    displayName: string | null;
    source: string;
    createdAt: number;
}
export interface ExperienceEvidence {
    id: string;
    episodeId: string;
    evidenceType: string;
    sourceKey: string;
    pinId: string | null;
    publisherGlobalMetaId: string | null;
    messageId: string | null;
    contentHash: string;
    occurredAt: number;
    retrievedAt: number | null;
    metadata: Record<string, unknown>;
    createdAt: number;
}
export interface CreateExperienceEpisodeInput {
    ownerGlobalMetaId: string;
    episodeType: ExperienceEpisodeType;
    sourceChannel: string;
    sourceKey: string;
    sessionId?: string | null;
    externalConversationId?: string | null;
    taskId?: string | null;
    orderId?: string | null;
    status?: ExperienceEpisodeStatus;
    startedAt?: number;
    endedAt?: number | null;
    metadata?: Record<string, unknown>;
}
export interface AddExperienceParticipantInput {
    episodeId: string;
    globalMetaId?: string | null;
    unresolvedActorKey?: string | null;
    role: string;
    displayName?: string | null;
    source: string;
}
export interface AddExperienceEvidenceInput {
    episodeId: string;
    evidenceType: string;
    sourceKey: string;
    pinId?: string | null;
    publisherGlobalMetaId?: string | null;
    messageId?: string | null;
    contentHash?: string | null;
    occurredAt?: number;
    retrievedAt?: number | null;
    metadata?: Record<string, unknown>;
}
/** sha1 content hash for evidence rows — evidence stores hashes, not raw text. */
export declare function hashExperienceContent(content: string): string;
export interface ExperienceStore {
    /** Idempotent on (ownerGlobalMetaId, sourceChannel, sourceKey): returns the
     * existing episode when the key already exists. */
    createEpisode(input: CreateExperienceEpisodeInput): Promise<ExperienceEpisode>;
    getEpisode(id: string): Promise<ExperienceEpisode | null>;
    updateEpisodeStatus(id: string, status: ExperienceEpisodeStatus, endedAt?: number | null): Promise<void>;
    addParticipant(input: AddExperienceParticipantInput): Promise<ExperienceParticipant | null>;
    /** Idempotent on (episodeId, evidenceType, sourceKey). */
    addEvidence(input: AddExperienceEvidenceInput): Promise<ExperienceEvidence | null>;
    listEpisodes(options: {
        ownerGlobalMetaId?: string;
        subjectGlobalMetaId?: string;
        fromTime?: number;
        toTime?: number;
        limit?: number;
    }): Promise<ExperienceEpisode[]>;
    listParticipants(episodeId: string): Promise<ExperienceParticipant[]>;
    listEvidence(episodeId: string, options?: {
        fromTime?: number;
        toTime?: number;
        limit?: number;
    }): Promise<ExperienceEvidence[]>;
}
export declare function createExperienceStore(paths: MetabotPaths): ExperienceStore;
