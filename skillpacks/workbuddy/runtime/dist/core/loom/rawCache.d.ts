import { type MetabotPaths } from '../state/paths';
import { type LoomProtocolName } from './protocols';
import type { LoomValidationError } from './validation';
export interface LoomCachedRecord {
    pinId: string;
    protocol: LoomProtocolName;
    path: string;
    operation: string;
    contentType: string;
    timestamp: number;
    creatorAddress: string;
    creatorMetaId: string;
    globalMetaId: string;
    payload: unknown;
    payloadValid: boolean;
    validationErrors: LoomValidationError[];
    raw: Record<string, unknown>;
}
export type LoomRawRecordBuckets = Record<LoomProtocolName, LoomCachedRecord[]>;
export interface LoomRawCacheState {
    version: 1;
    updatedAt: number;
    records: LoomRawRecordBuckets;
}
export interface LoomRawCacheStore {
    cachePath: string;
    read(): Promise<LoomRawCacheState>;
    write(state: LoomRawCacheState): Promise<LoomRawCacheState>;
    update(records: LoomCachedRecord[]): Promise<LoomRawCacheState>;
}
export declare function createEmptyLoomRawCacheState(): LoomRawCacheState;
export declare function createLoomRawCacheStore(homeDirOrPaths: string | MetabotPaths): LoomRawCacheStore;
