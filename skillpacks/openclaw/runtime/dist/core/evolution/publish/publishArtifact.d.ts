import type { LocalEvolutionStore } from '../localEvolutionStore';
export interface PublishEvolutionArtifactInput {
    store: Pick<LocalEvolutionStore, 'readArtifact' | 'readAnalysis'>;
    skillName: string;
    variantId: string;
    publisherGlobalMetaId: string;
    uploadArtifactBody: (filePath: string) => Promise<{
        artifactUri: string;
    }>;
    writeMetadataPin: (input: {
        path: string;
        contentType: string;
        payload: string;
    }) => Promise<{
        pinId: string;
        txids: string[];
    }>;
    now?: () => number;
}
export interface PublishEvolutionArtifactResult {
    pinId: string;
    txids: string[];
    skillName: string;
    variantId: string;
    artifactUri: string;
    scopeHash: string;
    publisherGlobalMetaId: string;
    publishedAt: number;
}
export declare function publishEvolutionArtifact(input: PublishEvolutionArtifactInput): Promise<PublishEvolutionArtifactResult>;
