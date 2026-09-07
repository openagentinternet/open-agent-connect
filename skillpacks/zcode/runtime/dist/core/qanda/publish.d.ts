/**
 * On-chain Q&A publishing via the simplequestion / simpleanswer / paylike
 * protocols (docs/metaid_protocols/08-qanda.md). OAC port of the IDBots
 * feat/metaweb-qa core: payload design follows declarative minimalism — only
 * what a reader cannot derive is required, no self-declared timestamps (block
 * time and indexer witness time are authoritative), and empty optional fields
 * are omitted entirely instead of written as empty strings/arrays.
 */
import type { Signer } from '../signing/signer';
export type QandaNetwork = 'mvc' | 'doge' | 'btc';
export declare const SIMPLE_QUESTION_PATH = "/protocols/simplequestion";
export declare const SIMPLE_ANSWER_PATH = "/protocols/simpleanswer";
export declare const PAYLIKE_PATH = "/protocols/paylike";
export declare const QANDA_PROTOCOL_VERSION = "1.0.0";
export interface QandaUploadFn {
    (input: {
        filePath: string;
        network: QandaNetwork;
    }): Promise<{
        metafileUri: string;
    }>;
}
export interface PublishSimpleQuestionInput {
    title: string;
    /** Optional question description/supplement (markdown). */
    content?: string;
    tags?: string[];
    /** MIME type of the content field; default text/markdown; ignored when content is empty. */
    contentType?: string;
    /** Files/images: local absolute file paths and/or metafile:// URIs. */
    attachments?: string[];
    /** Write network; default mvc. DOGE writes still upload files on MVC. */
    network?: QandaNetwork;
}
export interface PublishSimpleAnswerInput {
    /** pinId of the simplequestion pin being answered. */
    answerTo: string;
    content: string;
    tags?: string[];
    /** MIME type of the content field; written only when the caller passes it. */
    contentType?: string;
    attachments?: string[];
    network?: QandaNetwork;
}
export interface PublishLikePinInput {
    /** pinId of the target pin (any protocol). */
    pinId: string;
    /** 1 like, -1 dislike, 0 cancel the previous reaction. */
    isLike: 1 | -1 | 0;
    network?: QandaNetwork;
}
export interface PublishQandaResult {
    pinId: string;
    txids: string[];
    totalCost: number;
    network: string;
}
export declare class QandaPublishError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/**
 * Resolve one attachment reference: local absolute paths upload through the
 * (gated) seam, existing metafile:// URIs pass through, relative paths are
 * rejected. File upload does not support DOGE, so a DOGE write uploads on MVC.
 */
export declare function resolveQandaFileReference(input: {
    upload: QandaUploadFn;
    network: QandaNetwork;
    raw: string;
    toolName: string;
    field: string;
}): Promise<{
    uri?: string;
    error?: string;
}>;
/** Pure payload builder (exported for tests): only `title` is required. */
export declare function buildSimpleQuestionPayload(input: {
    title: string;
    content?: string;
    tags?: string[];
    contentType?: string;
    attachments?: string[];
}): string;
/** Pure payload builder (exported for tests): contentType rides only when passed. */
export declare function buildSimpleAnswerPayload(input: {
    answerTo: string;
    content: string;
    tags?: string[];
    contentType?: string;
    attachments?: string[];
}): string;
/** Publish one simplequestion pin end to end (files → payload → chain write). */
export declare function publishSimpleQuestion(signer: Signer, upload: QandaUploadFn, input: PublishSimpleQuestionInput): Promise<PublishQandaResult & {
    title: string;
    attachments: string[];
}>;
/** Publish one simpleanswer pin end to end (files → payload → chain write). */
export declare function publishSimpleAnswer(signer: Signer, upload: QandaUploadFn, input: PublishSimpleAnswerInput): Promise<PublishQandaResult & {
    questionPinId: string;
    content: string;
    attachments: string[];
}>;
/** Publish one paylike reaction pin (no upload — reactions are payload-only). */
export declare function publishLikePin(signer: Signer, input: PublishLikePinInput): Promise<PublishQandaResult & {
    targetPinId: string;
    isLike: 1 | -1 | 0;
}>;
/**
 * Human-readable success sheet for post_simplequestion. The view link follows
 * the MetaWeb URI convention (pin:// — never a Web2 viewer URL). Exposed for
 * tests.
 */
export declare function formatSimpleQuestionResult(input: {
    pinId: string;
    txids: string[];
    totalCost: number;
    title: string;
    attachments: string[];
}): string;
/**
 * Human-readable success sheet for post_simpleanswer. Exposed for tests.
 */
export declare function formatSimpleAnswerResult(input: {
    pinId: string;
    txids: string[];
    totalCost: number;
    questionPinId: string;
    attachments: string[];
    priorAnswerCount: number;
}): string;
/**
 * Human-readable success sheet for like_pin. Exposed for tests.
 */
export declare function formatLikePinResult(input: {
    reactionPinId: string;
    txids: string[];
    totalCost: number;
    targetPinId: string;
    isLike: 1 | -1 | 0;
}): string;
