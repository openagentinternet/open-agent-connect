import type { SkillVariantArtifact } from '../types';
import { EVOLUTION_ARTIFACT_PROTOCOL_VERSION, type PublishedEvolutionArtifactMetadata } from '../protocol';
export { EVOLUTION_ARTIFACT_PROTOCOL_VERSION, };
export declare const EVOLUTION_SEARCH_MAX_RAW_ROWS = 100;
export declare function isSafeEvolutionIdentifier(value: unknown): value is string;
export declare function parseMetafilePinId(uri: string): string | null;
export declare function parsePublishedArtifactMetadata(value: unknown): PublishedEvolutionArtifactMetadata | null;
export declare function validateShareableArtifactBody(value: unknown): SkillVariantArtifact | null;
