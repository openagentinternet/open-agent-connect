import { buildMvcLargeUploadFunding } from '../chain/mvcLargeUploadFunding';
import { type ProductionLargeFileUploader } from './uploadLargeFile';
export declare const DEFAULT_METAFS_UPLOADER_BASE_URL = "https://file.metaid.io/metafile-uploader";
export interface MetaFsLargeUploaderOptions {
    baseUrl?: string;
    fetchFn?: typeof fetch;
    buildFunding?: typeof buildMvcLargeUploadFunding;
    sleep?: (ms: number) => Promise<void>;
    maxBytes?: number;
}
export declare function createMetaFsLargeUploader(options?: MetaFsLargeUploaderOptions): ProductionLargeFileUploader;
