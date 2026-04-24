import { type MetabotPaths } from '../state/paths';
import type { ImportedRemoteArtifactSidecar, RemoteEvolutionIndex, SkillVariantArtifact } from './types';
export interface RemoteEvolutionStore {
    paths: MetabotPaths;
    ensureLayout(): Promise<MetabotPaths>;
    readIndex(): Promise<RemoteEvolutionIndex>;
    readArtifact(variantId: string): Promise<SkillVariantArtifact | null>;
    readSidecar(variantId: string): Promise<ImportedRemoteArtifactSidecar | null>;
    writeImport(input: {
        artifact: SkillVariantArtifact;
        sidecar: ImportedRemoteArtifactSidecar;
    }): Promise<{
        artifactPath: string;
        metadataPath: string;
        index: RemoteEvolutionIndex;
    }>;
}
export declare function createRemoteEvolutionStore(homeDirOrPaths: string | MetabotPaths): RemoteEvolutionStore;
