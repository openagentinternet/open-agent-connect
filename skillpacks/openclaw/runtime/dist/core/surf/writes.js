"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SURF_PROTOCOL_VERSION = exports.PAYLIKE_PATH = exports.SIMPLEANSWER_PATH = exports.SIMPLEQUESTION_PATH = exports.SIMPLENOTE_PATH = exports.SIMPLEBUZZ_PATH = exports.AGENTPEDIA_CHALLENGE_PATH = exports.PAYCOMMENT_PATH = void 0;
exports.buildCommentPayload = buildCommentPayload;
exports.buildAgentpediaChallengePayload = buildAgentpediaChallengePayload;
exports.buildBuzzPayload = buildBuzzPayload;
exports.buildSurfSimpleNotePayload = buildSurfSimpleNotePayload;
exports.buildLikePayload = buildLikePayload;
exports.surfSignerWrite = surfSignerWrite;
exports.formatSurfWriteReceipt = formatSurfWriteReceipt;
exports.PAYCOMMENT_PATH = '/protocols/paycomment';
exports.AGENTPEDIA_CHALLENGE_PATH = '/protocols/agentpedia/challenge';
exports.SIMPLEBUZZ_PATH = '/protocols/simplebuzz';
exports.SIMPLENOTE_PATH = '/protocols/simplenote';
exports.SIMPLEQUESTION_PATH = '/protocols/simplequestion';
exports.SIMPLEANSWER_PATH = '/protocols/simpleanswer';
exports.PAYLIKE_PATH = '/protocols/paylike';
exports.SURF_PROTOCOL_VERSION = '1.0.0';
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/** Comment on ANY pin via paycomment — the thread-reply primitive. */
function buildCommentPayload(input) {
    return JSON.stringify({
        commentTo: asString(input.commentTo),
        content: asString(input.content),
        contentType: 'text/markdown',
    });
}
/** Dispute one agentpedia revision (challenge event v1). */
function buildAgentpediaChallengePayload(input) {
    const proposed = input.proposedOutcome || input.proposedRevertTo
        ? { outcome: input.proposedOutcome ?? null, revertTo: asString(input.proposedRevertTo) || null }
        : null;
    return JSON.stringify({
        v: 1,
        targetRev: asString(input.targetRev),
        reason: input.reason,
        detail: asString(input.detail),
        proposed,
    });
}
/** One buzz post. */
function buildBuzzPayload(input) {
    const contentType = asString(input.contentType) || 'text/plain;utf-8';
    const attachments = (input.attachments ?? []).filter(Boolean);
    return JSON.stringify({ content: asString(input.content), contentType, attachments });
}
/** One simplenote article (on-chain 1.0.1 shape). */
function buildSurfSimpleNotePayload(input) {
    return JSON.stringify({
        title: asString(input.title),
        contentType: asString(input.contentType) || 'text/markdown',
        content: asString(input.content),
        encryption: '0',
        createTime: input.createTime,
    });
}
/** Like/dislike/cancel on any pin via paylike. */
function buildLikePayload(input) {
    return JSON.stringify({ isLike: input.isLike, likeTo: asString(input.likeTo) });
}
/**
 * Perform one chain write with a (chain-history-wrapped, surf-guard-wrapped)
 * signer. The daemon's `resolveActorWriteContext` signers already mirror
 * every write into the chain-history ledger — the receipts source the surf
 * reconciliation and isOwnPin checks read.
 */
async function surfSignerWrite(signer, input) {
    const chainWrite = await signer.writePin({
        operation: 'create',
        path: input.path,
        encryption: '0',
        version: exports.SURF_PROTOCOL_VERSION,
        contentType: 'application/json',
        payload: input.payload,
        network: input.network ?? 'mvc',
    });
    return {
        pinId: chainWrite.pinId,
        txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
        totalCost: chainWrite.totalCost,
        network: chainWrite.network,
    };
}
/** Human-readable receipt lines shared by every surf write tool. */
function formatSurfWriteReceipt(input) {
    const lines = [`${input.label} published on-chain.`];
    if (input.result.pinId)
        lines.push(`- pinId: ${input.result.pinId}`);
    if (input.result.txids.length)
        lines.push(`- txids: ${input.result.txids.join(', ')}`);
    if (input.targetPinId)
        lines.push(`- target pinId: ${input.targetPinId}`);
    lines.push(`- cost: ${input.result.totalCost} sats`);
    if (input.result.pinId)
        lines.push(`- view link: pin://${input.result.pinId}`);
    return lines.join('\n');
}
