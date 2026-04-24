import { type MetabotPaths } from '../state/paths';
import type { SkillActiveVariantRef, SkillEvolutionIndex, SkillExecutionAnalysis, SkillExecutionRecord, SkillVariantArtifact } from './types';
export declare const SAFE_IDENTIFIER_PATTERN: RegExp;
export declare function parseSkillActiveVariantRef(value: unknown): SkillActiveVariantRef | null;
export declare function validateSafeEvolutionIdentifier(identifier: string, fieldName: string): string;
export interface LocalEvolutionStore {
    paths: MetabotPaths;
    ensureLayout(): Promise<MetabotPaths>;
    readIndex(): Promise<SkillEvolutionIndex>;
    readArtifact(variantId: string): Promise<SkillVariantArtifact | null>;
    readAnalysis(analysisId: string): Promise<SkillExecutionAnalysis | null>;
    writeExecution(record: SkillExecutionRecord): Promise<string>;
    writeAnalysis(record: SkillExecutionAnalysis): Promise<string>;
    writeArtifact(record: SkillVariantArtifact): Promise<string>;
    setActiveVariantRef(skillName: string, ref: SkillActiveVariantRef): Promise<SkillEvolutionIndex>;
    setActiveVariant(skillName: string, variantId: string): Promise<SkillEvolutionIndex>;
    clearActiveVariant(skillName: string): Promise<SkillEvolutionIndex>;
}
export declare function createLocalEvolutionStore(homeDirOrPaths: string | MetabotPaths): LocalEvolutionStore;
