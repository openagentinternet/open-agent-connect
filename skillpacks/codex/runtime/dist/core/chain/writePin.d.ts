export type ChainWriteOperation = 'init' | 'create' | 'modify' | 'revoke';
export type ChainWriteEncryption = '0' | '1' | '2';
export type ChainWriteEncoding = 'utf-8' | 'base64';
export type ChainWriteNetwork = 'mvc' | 'btc' | 'doge' | 'opcat';
export interface ChainWriteRequest {
    operation?: string;
    path?: string;
    encryption?: string;
    version?: string;
    contentType?: string;
    payload?: string;
    encoding?: string;
    network?: string;
}
export interface NormalizedChainWriteRequest {
    operation: ChainWriteOperation;
    path: string;
    encryption: ChainWriteEncryption;
    version: string;
    contentType: string;
    payload: string;
    encoding: ChainWriteEncoding;
    network: ChainWriteNetwork;
}
export interface ChainWriteResult {
    txids: string[];
    pinId: string;
    totalCost: number;
    network: ChainWriteNetwork;
    operation: ChainWriteOperation;
    path: string;
    contentType: string;
    encoding: ChainWriteEncoding;
    globalMetaId: string;
    mvcAddress: string;
}
export declare function normalizeChainWriteRequest(input: ChainWriteRequest): NormalizedChainWriteRequest;
