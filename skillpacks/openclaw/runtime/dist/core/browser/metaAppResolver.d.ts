import type { MetaAppGalleryRecord } from '../metaapp/types';
import type { BrowserResolveResult } from './types';
export declare function buildMetaAppResolveResult(input: {
    uri: string;
    normalizedUri: string;
    record: MetaAppGalleryRecord;
    fetchedAt?: number;
}): BrowserResolveResult;
