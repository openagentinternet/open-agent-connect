import type { RemoteEvolutionStore } from '../remoteEvolutionStore';
export declare function importPublishedEvolutionArtifact(input: {
    pinId: string;
    skillName: string;
    resolvedScopeHash: string;
    remoteStore: RemoteEvolutionStore;
    readMetadataPinById: (pinId: string) => Promise<unknown | null>;
    readArtifactBodyByUri: (artifactUri: string) => Promise<unknown>;
    now?: () => number;
}): Promise<{
    pinId: string;
    variantId: string;
    skillName: string;
    publisherGlobalMetaId: string;
    artifactUri: string;
    artifactPath: string;
    metadataPath: string;
    importedAt: number;
}>;
