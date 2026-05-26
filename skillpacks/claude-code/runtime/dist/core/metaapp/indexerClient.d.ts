import type { MetaAppGalleryRecord, MetaAppIndexerClient } from './types';
type FetchResponse = {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
};
type FetchFn = (url: string) => Promise<FetchResponse>;
export interface CreateMetaAppIndexerClientInput {
    baseUrl?: string;
    fetch?: FetchFn;
    now?: () => number;
    env?: Record<string, string | undefined>;
}
export declare function normalizeMetaAppIndexerRecord(value: unknown, input: {
    baseUrl: string;
    now: () => number;
}): MetaAppGalleryRecord | null;
export declare function createMetaAppIndexerClient(input?: CreateMetaAppIndexerClientInput): MetaAppIndexerClient;
export {};
