"use strict";
/**
 * On-chain Q&A publishing via the simplequestion / simpleanswer / paylike
 * protocols (docs/metaid_protocols/08-qanda.md). OAC port of the IDBots
 * feat/metaweb-qa core: payload design follows declarative minimalism — only
 * what a reader cannot derive is required, no self-declared timestamps (block
 * time and indexer witness time are authoritative), and empty optional fields
 * are omitted entirely instead of written as empty strings/arrays.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QandaPublishError = exports.QANDA_PROTOCOL_VERSION = exports.PAYLIKE_PATH = exports.SIMPLE_ANSWER_PATH = exports.SIMPLE_QUESTION_PATH = void 0;
exports.resolveQandaFileReference = resolveQandaFileReference;
exports.buildSimpleQuestionPayload = buildSimpleQuestionPayload;
exports.buildSimpleAnswerPayload = buildSimpleAnswerPayload;
exports.publishSimpleQuestion = publishSimpleQuestion;
exports.publishSimpleAnswer = publishSimpleAnswer;
exports.publishLikePin = publishLikePin;
exports.formatSimpleQuestionResult = formatSimpleQuestionResult;
exports.formatSimpleAnswerResult = formatSimpleAnswerResult;
exports.formatLikePinResult = formatLikePinResult;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
const uri_1 = require("../metaweb/uri");
exports.SIMPLE_QUESTION_PATH = '/protocols/simplequestion';
exports.SIMPLE_ANSWER_PATH = '/protocols/simpleanswer';
exports.PAYLIKE_PATH = '/protocols/paylike';
exports.QANDA_PROTOCOL_VERSION = '1.0.0';
class QandaPublishError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'QandaPublishError';
    }
}
exports.QandaPublishError = QandaPublishError;
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function isMetafileUri(value) {
    return value.trim().toLowerCase().startsWith('metafile://');
}
/**
 * Resolve one attachment reference: local absolute paths upload through the
 * (gated) seam, existing metafile:// URIs pass through, relative paths are
 * rejected. File upload does not support DOGE, so a DOGE write uploads on MVC.
 */
async function resolveQandaFileReference(input) {
    const item = asString(input.raw);
    if (!item)
        return {};
    if (isMetafileUri(item))
        return { uri: item };
    if (!node_path_1.default.isAbsolute(item)) {
        return {
            error: `${input.toolName} requires ABSOLUTE local file paths for ${input.field}. Received a relative path: "${item}". Resolve it to an absolute path first, or pass an existing metafile:// URI.`,
        };
    }
    if (!(0, node_fs_1.existsSync)(item)) {
        return { error: `${input.toolName} ${input.field} file not found: ${item}` };
    }
    try {
        const uploadNetwork = input.network === 'doge' ? 'mvc' : input.network;
        const result = await input.upload({ filePath: item, network: uploadNetwork });
        const metafileUri = asString(result?.metafileUri);
        if (!metafileUri) {
            return { error: `${input.toolName} failed to get a metafile URI for uploaded ${input.field}: ${item}` };
        }
        return { uri: metafileUri };
    }
    catch (error) {
        return {
            error: `${input.toolName} failed to upload ${input.field} "${item}": ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
/** Pure payload builder (exported for tests): only `title` is required. */
function buildSimpleQuestionPayload(input) {
    const payload = { title: input.title };
    if (asString(input.content)) {
        payload.content = asString(input.content);
        payload.contentType = asString(input.contentType) || 'text/markdown';
    }
    const tags = (input.tags ?? []).map((tag) => asString(tag)).filter(Boolean);
    if (tags.length)
        payload.tags = tags;
    const attachments = (input.attachments ?? []).filter(Boolean);
    if (attachments.length)
        payload.attachments = attachments;
    return JSON.stringify(payload);
}
/** Pure payload builder (exported for tests): contentType rides only when passed. */
function buildSimpleAnswerPayload(input) {
    const payload = { answerTo: input.answerTo, content: input.content };
    const contentType = asString(input.contentType);
    if (contentType)
        payload.contentType = contentType;
    const tags = (input.tags ?? []).map((tag) => asString(tag)).filter(Boolean);
    if (tags.length)
        payload.tags = tags;
    const attachments = (input.attachments ?? []).filter(Boolean);
    if (attachments.length)
        payload.attachments = attachments;
    return JSON.stringify(payload);
}
async function writeQandaPin(signer, input) {
    const chainWrite = await signer.writePin({
        operation: 'create',
        path: input.path,
        encryption: '0',
        version: exports.QANDA_PROTOCOL_VERSION,
        contentType: 'application/json',
        payload: input.payload,
        network: input.network,
    });
    return {
        pinId: chainWrite.pinId,
        txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
        totalCost: chainWrite.totalCost,
        network: chainWrite.network,
    };
}
async function resolveAttachmentList(input) {
    const attachments = [];
    for (const raw of input.attachments ?? []) {
        if (!asString(raw))
            continue;
        const resolved = await resolveQandaFileReference({
            upload: input.upload,
            network: input.network,
            raw,
            toolName: input.toolName,
            field: 'attachment',
        });
        if (resolved.error)
            throw new QandaPublishError('attachment_upload_failed', resolved.error);
        if (resolved.uri)
            attachments.push(resolved.uri);
    }
    return attachments;
}
/** Publish one simplequestion pin end to end (files → payload → chain write). */
async function publishSimpleQuestion(signer, upload, input) {
    const title = asString(input.title);
    if (!title) {
        throw new QandaPublishError('missing_field', 'post_simplequestion requires `title` (non-empty). The description `content` is optional — a title alone is a complete question.');
    }
    const network = input.network ?? 'mvc';
    const attachments = await resolveAttachmentList({
        upload,
        network,
        attachments: input.attachments,
        toolName: 'post_simplequestion',
    });
    const payload = buildSimpleQuestionPayload({
        title,
        content: input.content,
        tags: input.tags,
        contentType: input.contentType,
        attachments,
    });
    const result = await writeQandaPin(signer, { path: exports.SIMPLE_QUESTION_PATH, payload, network });
    return { ...result, title, attachments };
}
/** Publish one simpleanswer pin end to end (files → payload → chain write). */
async function publishSimpleAnswer(signer, upload, input) {
    const answerTo = asString(input.answerTo);
    const content = asString(input.content);
    if (!answerTo || !content) {
        throw new QandaPublishError('missing_field', 'post_simpleanswer requires both `answer_to` (pinId of the question pin) and `content` (non-empty).');
    }
    const network = input.network ?? 'mvc';
    const attachments = await resolveAttachmentList({
        upload,
        network,
        attachments: input.attachments,
        toolName: 'post_simpleanswer',
    });
    const payload = buildSimpleAnswerPayload({
        answerTo,
        content,
        tags: input.tags,
        contentType: input.contentType,
        attachments,
    });
    const result = await writeQandaPin(signer, { path: exports.SIMPLE_ANSWER_PATH, payload, network });
    return { ...result, questionPinId: answerTo, content, attachments };
}
/** Publish one paylike reaction pin (no upload — reactions are payload-only). */
async function publishLikePin(signer, input) {
    const pinId = asString(input.pinId);
    if (!pinId) {
        throw new QandaPublishError('missing_field', 'like_pin requires `pin_id` (non-empty pinId of the target pin).');
    }
    const isLike = input.isLike;
    if (isLike !== 1 && isLike !== -1 && isLike !== 0) {
        throw new QandaPublishError('invalid_field', 'like_pin `is_like` must be exactly 1 (like), -1 (dislike), or 0 (cancel).');
    }
    const network = input.network ?? 'mvc';
    const result = await writeQandaPin(signer, {
        path: exports.PAYLIKE_PATH,
        payload: JSON.stringify({ isLike, likeTo: pinId }),
        network,
    });
    return { ...result, targetPinId: pinId, isLike };
}
/**
 * Human-readable success sheet for post_simplequestion. The view link follows
 * the MetaWeb URI convention (pin:// — never a Web2 viewer URL). Exposed for
 * tests.
 */
function formatSimpleQuestionResult(input) {
    const lines = ['Question published on-chain.'];
    if (input.pinId) {
        lines.push(`- question pinId: ${input.pinId}`);
        lines.push('- others answer this question by referencing this pinId as `answer_to` in post_simpleanswer');
    }
    if (input.txids.length)
        lines.push(`- txids: ${input.txids.join(', ')}`);
    lines.push(`- title: ${input.title}`);
    lines.push(`- cost: ${input.totalCost} sats`);
    for (const uri of input.attachments)
        lines.push(`- attachment: ${uri}`);
    if (input.pinId) {
        lines.push(`- view link: ${(0, uri_1.markdownSelfLink)(`pin://${input.pinId}`)}`);
    }
    return lines.join('\n');
}
/**
 * Human-readable success sheet for post_simpleanswer. Exposed for tests.
 */
function formatSimpleAnswerResult(input) {
    const lines = ['Answer published on-chain.'];
    if (input.pinId)
        lines.push(`- answer pinId: ${input.pinId}`);
    if (input.txids.length)
        lines.push(`- txids: ${input.txids.join(', ')}`);
    lines.push(`- question pinId: ${input.questionPinId}`);
    lines.push(`- cost: ${input.totalCost} sats`);
    for (const uri of input.attachments)
        lines.push(`- attachment: ${uri}`);
    if (input.priorAnswerCount > 0) {
        lines.push(`- note: this is answer #${input.priorAnswerCount + 1} you published to this question from this host`);
    }
    if (input.pinId) {
        lines.push(`- view link: ${(0, uri_1.markdownSelfLink)(`pin://${input.pinId}`)}`);
    }
    return lines.join('\n');
}
/**
 * Human-readable success sheet for like_pin. Exposed for tests.
 */
function formatLikePinResult(input) {
    const action = input.isLike === 1 ? 'Liked' : input.isLike === -1 ? 'Disliked' : 'Canceled your reaction on';
    const lines = [`${action} pin ${input.targetPinId} — reaction published on-chain.`];
    if (input.reactionPinId)
        lines.push(`- reaction pinId: ${input.reactionPinId}`);
    if (input.txids.length)
        lines.push(`- txids: ${input.txids.join(', ')}`);
    lines.push(`- target pinId: ${input.targetPinId}`);
    lines.push(`- cost: ${input.totalCost} sats`);
    if (input.reactionPinId) {
        lines.push(`- view link: ${(0, uri_1.markdownSelfLink)(`pin://${input.reactionPinId}`)}`);
    }
    return lines.join('\n');
}
