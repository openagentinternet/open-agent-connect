import { type MetaAppArtifactCacheEntry, type MetaAppArtifactCacheStore } from './artifactCache';
export declare function isZipMetaAppContent(contentType: string, contentReference: string): boolean;
export declare function metaAppArchiveUrls(contentReference: string): string[];
export declare function downloadMetaAppArchive(fetchImpl: typeof fetch, contentReference: string): Promise<Buffer | null>;
/**
 * Resolve a MetaApp zip package into the artifact cache: return the cached
 * extraction when present, otherwise download the archive and extract it.
 * Returns null when the package content is not a downloadable zip archive.
 */
export declare function resolveMetaAppArtifact(input: {
    pinId: string;
    contentReference: string;
    contentType: string;
    indexFile: string;
    /** Raw pin record; its modify history participates in the cache key. */
    pinRecord?: Record<string, unknown>;
    artifactCache: MetaAppArtifactCacheStore;
    fetchImpl: typeof fetch;
}): Promise<MetaAppArtifactCacheEntry | null>;
