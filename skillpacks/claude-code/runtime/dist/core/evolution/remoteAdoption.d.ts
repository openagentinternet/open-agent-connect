import type { LocalEvolutionStore } from './localEvolutionStore';
import type { RemoteEvolutionStore } from './remoteEvolutionStore';
export declare function adoptRemoteEvolutionArtifact(input: {
    skillName: string;
    variantId: string;
    resolvedScopeHash: string;
    remoteStore: Pick<RemoteEvolutionStore, 'readArtifact' | 'readSidecar'>;
    evolutionStore: Pick<LocalEvolutionStore, 'setActiveVariantRef'>;
}): Promise<{
    skillName: string;
    variantId: string;
    source: 'remote';
    active: true;
}>;
