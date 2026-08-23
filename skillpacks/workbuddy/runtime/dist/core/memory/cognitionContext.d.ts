import type { ExperienceStore } from './experienceStore';
import type { ImpressionSnapshot, ImpressionStore } from './impressionStore';
export type CognitionContactState = 'first_contact' | 'known_without_direct_interaction' | 'prior_direct_interaction';
export interface CognitionEvidenceRef {
    id: string;
    evidenceType: string;
    pinId: string | null;
    publisherGlobalMetaId: string | null;
    occurredAt: number;
}
export interface HardRelationshipFact {
    relationship: 'boss' | 'twin';
    subjectGlobalMetaId: string;
    source: string;
}
export interface CognitionContext {
    observerGlobalMetaId: string;
    subjectGlobalMetaId: string;
    contactState: CognitionContactState;
    hardRelationships: HardRelationshipFact[];
    interactionCount: number;
    directInteractionCount: number;
    recentEvidence: CognitionEvidenceRef[];
    currentSnapshot: ImpressionSnapshot | null;
}
export interface CognitionContextDeps {
    experienceStore: ExperienceStore;
    impressionStore: ImpressionStore;
    /** Local hard-relationship resolver (boss/twin topology). Phase 4 wires
     * profile-backed relationships; until then this may return []. */
    resolveHardRelationships?: (observerGlobalMetaId: string, subjectGlobalMetaId: string) => HardRelationshipFact[];
}
/** Build the observer-relative cognition context for one peer identity. */
export declare function buildCognitionContext(deps: CognitionContextDeps, input: {
    observerGlobalMetaId: string;
    subjectGlobalMetaId: string;
    excludeEvidenceIds?: string[];
    recentEvidenceLimit?: number;
}): Promise<CognitionContext | null>;
/** Render the 1:1 cognition prompt block (empty string when there is no peer context). */
export declare function renderCognitionPromptBlock(context: CognitionContext): string;
/** Convenience: build + render; empty string when the peer has no context. */
export declare function buildCognitionPromptBlock(deps: CognitionContextDeps, input: {
    observerGlobalMetaId: string;
    subjectGlobalMetaId: string;
    excludeEvidenceIds?: string[];
    recentEvidenceLimit?: number;
}): Promise<string>;
