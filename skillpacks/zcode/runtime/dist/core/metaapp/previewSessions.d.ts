import type { MetaAppPreviewAsset, MetaAppPreviewSession } from './types';
export declare function inferMetaAppPreviewMimeType(filePath: string): string;
export declare function createMetaAppPreviewSessionRegistry(input?: {
    now?: () => number;
    ttlMs?: number;
}): {
    create(input: {
        artifactDir: string;
        indexFile: string;
    }): MetaAppPreviewSession;
    resolveAsset(input: {
        previewId: string;
        assetPath?: string;
    }): Promise<MetaAppPreviewAsset>;
    pruneExpired(): void;
};
