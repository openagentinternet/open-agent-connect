/**
 * On-chain long-form note publishing via the simplenote protocol
 * (/protocols/simplenote, version 1.0.1 — docs/metaid_protocols
 * 02-content-app.md §1). OAC port of the IDBots postSimpleNoteAgentTools
 * core: payload shape verified against live pins
 * (title/subtitle/coverImg/contentType/content/encryption/createTime as
 * ms number/tags/attachments as metafile:// URIs).
 *
 * The upload seam is the shared gate chokepoint (core/files/chainUploadGate):
 * hosts inject wrapUploadWithGate(uploadLocalFileToChain, deps) so files
 * outside the session workspace require owner approval before publishing.
 */
import type { Signer } from '../signing/signer';
export type SimpleNoteNetwork = 'mvc' | 'doge' | 'btc';
export interface SimpleNoteUploadFn {
    (input: {
        filePath: string;
        network: SimpleNoteNetwork;
    }): Promise<{
        metafileUri: string;
    }>;
}
export interface PublishSimpleNoteInput {
    title: string;
    content: string;
    subtitle?: string;
    /** Cover image: local absolute file path (uploaded) or an existing metafile:// URI. */
    cover?: string;
    /** Extra files: local absolute paths and/or metafile:// URIs. */
    attachments?: string[];
    /** MIME type of the content field; default text/markdown. */
    contentType?: string;
    tags?: string[];
    /** Note write network; default mvc. DOGE notes still upload files on MVC. */
    network?: SimpleNoteNetwork;
}
export interface PublishSimpleNoteResult {
    pinId: string;
    txids: string[];
    totalCost: number;
    network: string;
    title: string;
    coverImg: string;
    attachments: string[];
}
export declare class SimpleNoteError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Pure payload builder (exported for tests): the on-chain 1.0.1 shape. */
export declare function buildSimpleNotePayload(input: {
    title: string;
    content: string;
    subtitle?: string;
    coverImg?: string;
    contentType?: string;
    tags?: string[];
    attachments?: string[];
    createTime: number;
}): string;
/**
 * Resolve one cover/attachment reference to a metafile:// URI: local
 * absolute paths upload through the (gated) seam, existing metafile:// URIs
 * pass through, relative paths are rejected.
 */
export declare function resolveSimpleNoteFileReference(input: {
    upload: SimpleNoteUploadFn;
    network: SimpleNoteNetwork;
    raw: string;
    field: string;
}): Promise<{
    uri?: string;
    error?: string;
}>;
/** Publish one simplenote pin end to end (files → payload → chain write). */
export declare function publishSimpleNote(signer: Signer, upload: SimpleNoteUploadFn, input: PublishSimpleNoteInput): Promise<PublishSimpleNoteResult>;
/**
 * Human-readable success sheet. The view link follows the MetaWeb URI
 * convention (pin:// — never a Web2 viewer URL) so the model can quote it
 * verbatim. Exposed for tests.
 */
export declare function formatSimpleNoteResult(input: {
    pinId: string;
    txids: string[];
    totalCost: number;
    title: string;
    coverImg?: string;
    attachments: string[];
}): string;
