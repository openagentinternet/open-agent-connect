import { type MetabotPaths } from '../state/paths';
export interface MetaAppArtifactDescriptor {
    metaAppPinId: string;
    contentReference: string;
    contentType: string;
    indexFile: string;
    modifyHistory?: string[] | null;
}
export interface MetaAppArtifactCacheEntry {
    cacheKey: string;
    artifactRoot: string;
    artifactDir: string;
    indexFile: string;
    manifestPath: string;
}
export interface MetaAppArtifactCacheStatsEntry {
    cacheKey: string;
    metaAppPinId: string;
    contentReference: string;
    contentType: string;
    indexFile: string;
    modifyHistory: string[] | null;
    latestModifyPinId: string | null;
    artifactDir: string;
    createdAt: number;
    updatedAt: number;
    lastUsedAt: number;
    sizeBytes: number;
}
export interface MetaAppArtifactCacheStats {
    cacheRoot: string;
    artifactsRoot: string;
    pinsRoot: string;
    artifactCount: number;
    pinRecordCount: number;
    totalBytes: number;
    artifacts: MetaAppArtifactCacheStatsEntry[];
}
export type MetaAppArtifactCacheClearInput = {
    scope?: 'all';
} | {
    scope: 'artifact';
    cacheKey: string;
} | {
    scope: 'pin';
    pinId: string;
};
export interface MetaAppArtifactCacheClearResult {
    clearedArtifacts: number;
    clearedPinRecords: number;
}
export interface MetaAppArtifactCacheStore {
    cacheRoot: string;
    artifactsRoot: string;
    pinsRoot: string;
    getArtifact(input: MetaAppArtifactDescriptor): Promise<MetaAppArtifactCacheEntry | null>;
    writeArtifact(input: MetaAppArtifactDescriptor & {
        archive: Buffer;
    }): Promise<MetaAppArtifactCacheEntry>;
    getStats(): Promise<MetaAppArtifactCacheStats>;
    clear(input?: MetaAppArtifactCacheClearInput): Promise<MetaAppArtifactCacheClearResult>;
}
interface MetaAppArtifactCacheOptions {
    now?: () => number;
}
export declare function normalizeMetaAppModifyHistory(value: unknown): string[] | null;
export declare function buildMetaAppArtifactCacheKey(input: Pick<MetaAppArtifactDescriptor, 'contentReference' | 'contentType' | 'indexFile'>): string;
export declare function createMetaAppArtifactCacheStore(pathsOrHomeDir: string | MetabotPaths, options?: MetaAppArtifactCacheOptions): MetaAppArtifactCacheStore;
export {};
