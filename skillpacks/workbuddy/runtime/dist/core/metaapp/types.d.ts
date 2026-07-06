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
export type MetaAppOperation = 'create' | 'modify' | 'revoke';
export interface MetaAppGalleryRecord {
    pinId: string;
    firstPinId: string;
    operation: MetaAppOperation;
    title: string;
    appName: string;
    prompt?: string;
    icon?: string;
    coverImg?: string;
    introImgs?: string[];
    intro?: string;
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
export interface MetaAppPreviewSession {
    previewId: string;
    artifactDir: string;
    indexFile: string;
    createdAt: number;
    expiresAt: number;
    localPreviewUrl: string;
}
export interface MetaAppPreviewAsset {
    previewId: string;
    assetPath: string;
    filePath: string;
    contentType: string;
    body: Buffer;
}
export interface MetaAppWarning {
    code: string;
    message: string;
}
export interface MetaAppCacheState {
    version: 1;
    records: MetaAppGalleryRecord[];
    updatedAt: number | null;
}
