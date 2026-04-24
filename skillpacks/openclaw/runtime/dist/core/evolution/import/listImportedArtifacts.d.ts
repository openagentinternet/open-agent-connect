import type { RemoteEvolutionStore } from '../remoteEvolutionStore';
import type { ImportedEvolutionArtifactSummaryRow, SkillActiveVariantRef } from '../types';
export declare function listImportedEvolutionArtifacts(input: {
    skillName: string;
    activeRef: SkillActiveVariantRef | null;
    remoteStore: Pick<RemoteEvolutionStore, 'readIndex' | 'readArtifact' | 'readSidecar'>;
}): Promise<{
    skillName: string;
    count: number;
    results: ImportedEvolutionArtifactSummaryRow[];
}>;
