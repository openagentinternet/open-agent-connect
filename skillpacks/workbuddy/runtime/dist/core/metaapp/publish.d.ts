import { type MetabotCommandResult } from '../contracts/commandResult';
import type { MetaAppGalleryRecord } from './types';
export interface UploadLikeResult {
    pinId?: string;
    txids?: string[];
    network?: string;
    filePath?: string;
    contentType?: string;
    bytes?: number;
    metafileUri?: string;
    globalMetaId?: string;
    [key: string]: unknown;
}
export interface ChainLikeResult {
    pinId?: string;
    firstPinId?: string;
    txids?: string[];
    totalCost?: number;
    network?: string;
    operation?: string;
    path?: string;
    contentType?: string;
    globalMetaId?: string;
    mvcAddress?: string;
    [key: string]: unknown;
}
export interface BuzzLikeResult {
    pinId?: string;
    txids?: string[];
    network?: string;
    content?: string;
    contentType?: string;
    quotePin?: string;
    globalMetaId?: string;
    [key: string]: unknown;
}
export interface MetaAppPublishDependencies {
    uploadFile: (input: {
        filePath: string;
        contentType?: string;
        network?: string;
    }) => Promise<UploadLikeResult>;
    writeChain: (input: Record<string, unknown>) => Promise<ChainLikeResult>;
    upsertLocal: (record: MetaAppGalleryRecord) => Promise<unknown>;
    postBuzz?: (input: Record<string, unknown>) => Promise<BuzzLikeResult>;
    createPreviewSession?: (input: {
        artifactDir: string;
        indexFile: string;
    }) => {
        previewId: string;
        localPreviewUrl: string;
    };
    readExistingMetaApp?: (pinId: string) => Promise<MetaAppGalleryRecord | null>;
    now?: () => number;
    makeTempDir?: () => Promise<string>;
}
export type MetaAppPreviewDependencies = Partial<Pick<MetaAppPublishDependencies, 'createPreviewSession'>>;
export type MetaAppAnnounceDependencies = Partial<Pick<MetaAppPublishDependencies, 'postBuzz'>>;
export type MetaAppCommentDependencies = Partial<Pick<MetaAppPublishDependencies, 'writeChain'>>;
export interface MetaAppProjectInput {
    cwd?: string;
    projectDir: string;
    manifestFile?: string;
    open?: boolean;
}
export interface MetaAppPublishInput extends MetaAppProjectInput {
    confirm?: boolean;
    network?: string;
    compatibilityMirrorContent?: boolean;
}
export interface MetaAppUpdateInput extends MetaAppPublishInput {
    targetPinId: string;
}
export declare function previewMetaAppProject(input: MetaAppProjectInput, deps?: MetaAppPreviewDependencies): Promise<MetabotCommandResult<Record<string, unknown>> & {
    localUiUrl?: string;
}>;
export declare function publishMetaApp(input: MetaAppPublishInput, deps: MetaAppPublishDependencies): Promise<MetabotCommandResult<Record<string, unknown>>>;
export declare function updateMetaApp(input: MetaAppUpdateInput, deps: MetaAppPublishDependencies): Promise<MetabotCommandResult<Record<string, unknown>>>;
export declare function shareMetaApp(input: {
    pinId: string;
}, _deps?: unknown): Promise<MetabotCommandResult<Record<string, unknown>>>;
export declare function announceMetaAppShare(input: {
    pinId: string;
    message?: string;
    network?: string;
}, deps: MetaAppAnnounceDependencies): Promise<MetabotCommandResult<Record<string, unknown>>>;
export declare function commentMetaApp(input: {
    pinId: string;
    comment: string;
    network?: string;
}, deps: MetaAppCommentDependencies): Promise<MetabotCommandResult<Record<string, unknown>>>;
