import type { MetabotPaths } from '../state/paths';
import type { ExperienceStore } from './experienceStore';
export declare const IMPRESSION_SNAPSHOT_VERSION = 1;
export type ImpressionObservationStatus = 'active' | 'superseded' | 'rejected';
export interface ImpressionObservation {
    id: string;
    observerGlobalMetaId: string;
    subjectGlobalMetaId: string;
    episodeId: string | null;
    observationText: string;
    interpretationText: string;
    dimensions: Record<string, unknown>;
    communicationGuidance: string | null;
    confidence: Record<string, unknown>;
    dreamDate: string;
    dreamVersion: number;
    modelId: string | null;
    sourceHash: string;
    idempotencyKey: string;
    supersedesObservationId: string | null;
    evidenceIds: string[];
    status: ImpressionObservationStatus;
    createdAt: number;
}
export interface ImpressionSnapshot {
    observerGlobalMetaId: string;
    subjectGlobalMetaId: string;
    firstSeenAt: number;
    lastSeenAt: number;
    interactionCount: number;
    directInteractionCount: number;
    summaryText: string;
    styleDescriptors: string[];
    cooperationContext: string | null;
    relationshipTemperature: string | null;
    communicationGuidance: string | null;
    uncertaintyText: string | null;
    latestObservationId: string;
    snapshotVersion: number;
    sourceHash: string;
    createdAt: number;
    updatedAt: number;
}
export interface AppendImpressionObservationInput {
    id?: string;
    observerGlobalMetaId: string;
    subjectGlobalMetaId: string;
    episodeId?: string | null;
    evidenceIds: string[];
    observationText: string;
    interpretationText: string;
    dimensions?: Record<string, unknown>;
    communicationGuidance?: string | null;
    confidence?: Record<string, unknown>;
    dreamDate: string;
    dreamVersion: number;
    modelId?: string | null;
    sourceHash: string;
    idempotencyKey?: string;
    supersedesObservationId?: string | null;
}
export interface ImpressionStore {
    listObservations(input: {
        observerGlobalMetaId: string;
        subjectGlobalMetaId: string;
        includeSuperseded?: boolean;
        limit?: number;
    }): Promise<ImpressionObservation[]>;
    appendObservation(input: AppendImpressionObservationInput): Promise<{
        observation: ImpressionObservation;
        created: boolean;
    }>;
    getSnapshot(observerGlobalMetaId: string, subjectGlobalMetaId: string): Promise<ImpressionSnapshot | null>;
    listSnapshots(observerGlobalMetaId: string, limit?: number): Promise<ImpressionSnapshot[]>;
    rebuildSnapshot(observerGlobalMetaId: string, subjectGlobalMetaId: string): Promise<ImpressionSnapshot | null>;
}
export declare function createImpressionStore(paths: MetabotPaths, deps?: {
    experienceStore?: ExperienceStore;
}): ImpressionStore;
