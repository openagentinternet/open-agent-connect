type FetchResponse = {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
};
type FetchFn = (url: string) => Promise<FetchResponse>;
export interface MetaAppOwnerListRecord {
    pinId: string;
    firstPinId: string;
    operation: string;
    title: string;
    appName: string;
    prompt?: string;
    icon?: string;
    coverImg?: string;
    introImgs: string[];
    intro?: string;
    runtime: string;
    version: string;
    contentType: string;
    content?: string;
    indexFile?: string;
    code?: string;
    contentHash?: string;
    metadata?: Record<string, unknown>;
    tags: string[];
    disabled: boolean;
    codeType?: string;
    ownerAddress: string;
    timestamp: number | null;
    summary?: string;
    txid?: string;
    txids: string[];
    metaappUri: string;
    metawebUrl: string;
    runUrl: string;
    raw: Record<string, unknown>;
}
export interface MetaAppOwnerListResult {
    records: MetaAppOwnerListRecord[];
    nextCursor: string;
    total: number;
}
export interface MetaAppManOwnerClient {
    baseUrl: string;
    listByAddress(input: {
        address: string;
        cursor?: string;
        size?: number;
    }): Promise<MetaAppOwnerListResult>;
}
export declare function parseManMetaAppListResponse(response: unknown, input?: {
    ownerAddress?: string;
}): MetaAppOwnerListResult;
export declare function createMetaAppManOwnerClient(input?: {
    baseUrl?: string;
    fetchFn?: FetchFn;
}): MetaAppManOwnerClient;
export {};
