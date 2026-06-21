import { type LoomProtocolName } from './protocols';
import type { LoomCachedRecord } from './rawCache';
export interface ReadLoomRawChainOptions {
    chainApiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    pageSize?: number;
    maxPages?: number;
}
export interface ReadLoomRawChainResult {
    records: LoomCachedRecord[];
    byProtocol: Record<LoomProtocolName, number>;
}
export declare function readLoomRawChainRecords(options?: ReadLoomRawChainOptions): Promise<ReadLoomRawChainResult>;
