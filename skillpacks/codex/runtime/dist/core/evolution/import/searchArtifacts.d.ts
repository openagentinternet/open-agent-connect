import type { RemoteEvolutionStore } from '../remoteEvolutionStore';
import type { PublishedEvolutionSearchResultSummaryRow } from '../types';
import { EVOLUTION_SEARCH_MAX_RAW_ROWS } from './publishedArtifactProtocol';
export { EVOLUTION_SEARCH_MAX_RAW_ROWS };
export type PublishedEvolutionArtifactSearchResult = PublishedEvolutionSearchResultSummaryRow;
export declare function deriveResolvedScopeHash(resolved: {
    scopeMetadata?: {
        scopeHash?: string | null;
    } | null;
    scope: unknown;
}): string;
export declare function searchPublishedEvolutionArtifacts(input: {
    skillName: string;
    resolvedScopeHash: string;
    remoteStore: Pick<RemoteEvolutionStore, 'readIndex'>;
    fetchMetadataRows: () => Promise<Array<{
        pinId: string;
        payload: unknown;
    }>>;
}): Promise<{
    skillName: string;
    scopeHash: string;
    count: number;
    results: PublishedEvolutionArtifactSearchResult[];
}>;
