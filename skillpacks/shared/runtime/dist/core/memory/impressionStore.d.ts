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
/** Deterministic collaboration fact recorded by the group task engine. */
export interface ImpressionCollaborationFact {
    id: string;
    observerGlobalMetaId: string;
    subjectGlobalMetaId: string;
    taskId: number;
    title: string;
    outcome: string;
    seatRole?: string;
    evidencePinIds: string[];
    recordedAt: number;
}
export interface ImpressionSnapshot {
    observerGlobalMetaId: string;
    subjectGlobalMetaId: string;
    firstSeenAt: number;
    capabilityTags: string[];
    collaborationFacts: Array<{
        taskId: number;
        title: string;
        outcome: string;
        seatRole?: string;
        evidencePinIds: string[];
        recordedAt: number;
    }>;
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
    appendCollaborationFact(input: {
        observerGlobalMetaId: string;
        subjectGlobalMetaId: string;
        taskId: number;
        title: string;
        outcome: string;
        seatRole?: string;
        evidencePinIds?: string[];
    }): Promise<ImpressionCollaborationFact>;
    /** Hygiene compression: keep the newest `anchorsPerPair` active observations
     * per (observer, subject) pair and supersede the older ones past the cutoff;
     * rebuild the pair's snapshot from the remaining actives afterwards (the
     * snapshot is deleted when nothing remains). */
    compactObservations(input: {
        cutoffMs: number;
        anchorsPerPair: number;
        excludeObservers?: ReadonlySet<string>;
    }): Promise<{
        pairsCompacted: number;
        observationsSuperseded: number;
        snapshotsRebuilt: number;
    }>;
}
export declare function createImpressionStore(paths: MetabotPaths, deps?: {
    experienceStore?: ExperienceStore;
}): ImpressionStore;
