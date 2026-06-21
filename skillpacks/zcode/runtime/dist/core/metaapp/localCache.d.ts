import { type MetabotPaths } from '../state/paths';
import type { MetaAppCacheState, MetaAppGalleryRecord } from './types';
export interface MetaAppLocalCacheStore {
    localCachePath: string;
    indexerCachePath: string;
    readLocal(): Promise<MetaAppCacheState>;
    writeLocal(state: MetaAppCacheState): Promise<MetaAppCacheState>;
    upsertLocal(record: MetaAppGalleryRecord): Promise<MetaAppCacheState>;
    readIndexer(): Promise<MetaAppCacheState>;
    writeIndexer(state: MetaAppCacheState): Promise<MetaAppCacheState>;
    listMerged(): Promise<MetaAppGalleryRecord[]>;
}
export declare function createMetaAppLocalCacheStore(pathsOrHomeDir: string | MetabotPaths): MetaAppLocalCacheStore;
