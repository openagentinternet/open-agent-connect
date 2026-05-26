export type MetaAppProjectType = 'static' | 'npm' | 'manual';

export type MetaAppPackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';

export interface MetaAppManifestInput {
  title?: string;
  appName?: string;
  prompt?: string;
  icon?: string;
  coverImg?: string;
  introImgs?: string[];
  intro?: string;
  runtime?: string;
  version?: string;
  contentType?: string;
  content?: string;
  indexFile?: string;
  code?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  disabled?: boolean;
  codeType?: string;
  artifactDir?: string;
  sourceArchive?: boolean;
}

export interface MetaAppManualAction {
  code: string;
  message: string;
}

export interface MetaAppPreviewPlan {
  projectDir: string;
  projectType: MetaAppProjectType;
  artifactDir: string | null;
  indexFile: string;
  buildCommand: string | null;
  packageManager: MetaAppPackageManager | null;
  manifest: MetaAppManifestInput;
  manualAction?: MetaAppManualAction;
}

export type MetaAppOperation = 'create' | 'modify';

export interface MetaAppGalleryRecord {
  pinId: string;
  firstPinId: string;
  operation: MetaAppOperation;
  title: string;
  appName: string;
  version: string;
  runtime: string;
  indexFile: string;
  code: string;
  content: string;
  contentType: string;
  codeType: string;
  tags: string[];
  ownerGlobalMetaId: string;
  ownerAddress: string;
  network: string;
  metawebUrl: string;
  localUiUrl?: string;
  updatedAt: number;
  source: 'local' | 'indexer';
  disabled?: boolean;
  status?: string | number;
  runUrl?: string;
  downloadUrl?: string;
  raw?: Record<string, unknown>;
}

export interface MetaAppCacheState {
  version: 1;
  records: MetaAppGalleryRecord[];
  updatedAt: number | null;
}

export type MetaAppIndexerErrorCode =
  | 'indexer_fetch_error'
  | 'indexer_http_error'
  | 'indexer_api_error'
  | 'indexer_malformed_response';

export interface MetaAppIndexerError {
  code: MetaAppIndexerErrorCode;
  message: string;
  status?: number;
}

export type MetaAppIndexerResult<T> =
  | {
      ok: true;
      data: T;
      fetchedAt: number;
    }
  | {
      ok: false;
      data: T;
      error: MetaAppIndexerError;
      fetchedAt: number;
    };

export interface MetaAppIndexerClient {
  baseUrl: string;
  list(input?: { creatorGlobalMetaId?: string; limit?: number }): Promise<MetaAppIndexerResult<MetaAppGalleryRecord[]>>;
  getByPinId(pinId: string): Promise<MetaAppIndexerResult<MetaAppGalleryRecord | null>>;
  getHistory(firstPinId: string): Promise<MetaAppIndexerResult<MetaAppGalleryRecord[]>>;
}
