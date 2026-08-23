import type { MetaAppPreviewAsset, MetaAppPreviewSession } from './types';
export declare function metaAppPreviewHtmlPreparationAvailable(): boolean;
export declare function inferMetaAppPreviewMimeType(filePath: string): string;
export declare function createMetaAppPreviewSessionRegistry(input?: {
    now?: () => number;
    ttlMs?: number;
    resolveMetafileContentBaseUrl?: () => string | Promise<string>;
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
