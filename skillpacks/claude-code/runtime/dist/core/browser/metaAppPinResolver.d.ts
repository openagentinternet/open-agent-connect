import { type MetabotCommandResult } from '../contracts/commandResult';
import { type MetaAppArtifactCacheStore } from '../metaapp/artifactCache';
import type { MetaAppGalleryRecord } from '../metaapp/types';
type FetchResponse = {
    ok: boolean;
    status: number;
    headers?: {
        get(name: string): string | null;
    };
    json?(): Promise<unknown>;
    arrayBuffer?(): Promise<ArrayBuffer>;
};
type FetchFn = (url: string) => Promise<FetchResponse>;
export interface ResolveMetaAppPinToRecordInput {
    pinId: string;
    fetch?: FetchFn;
    manApiBaseUrl?: string;
    makeTempDir?: () => Promise<string>;
    createPreviewSession?: (input: {
        artifactDir: string;
        indexFile: string;
    }) => Promise<{
        previewId?: string;
        localPreviewUrl: string;
    }> | {
        previewId?: string;
        localPreviewUrl: string;
    };
    artifactCache?: MetaAppArtifactCacheStore;
    now?: () => number;
}
export declare function resolveMetaAppPinToRecord(input: ResolveMetaAppPinToRecordInput): Promise<MetabotCommandResult<MetaAppGalleryRecord>>;
export {};
