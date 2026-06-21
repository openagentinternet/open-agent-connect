"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMetaAppCanonicalUrl = buildMetaAppCanonicalUrl;
exports.buildMetaAppShareBundle = buildMetaAppShareBundle;
exports.buildMetaAppBuzzRequest = buildMetaAppBuzzRequest;
exports.buildMetaAppCommentWrite = buildMetaAppCommentWrite;
const pinId_1 = require("./pinId");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function buildMetaAppCanonicalUrl(pinId) {
    const normalizedPinId = (0, pinId_1.assertMetaAppPinId)(pinId);
    return `https://metaweb.world/metaapp/${normalizedPinId}`;
}
function buildMetaAppShareBundle(pinId) {
    const normalizedPinId = (0, pinId_1.assertMetaAppPinId)(pinId);
    const metawebUrl = buildMetaAppCanonicalUrl(normalizedPinId);
    return {
        pinId: normalizedPinId,
        metawebUrl,
        suggestedBuzz: `I published a MetaApp: ${metawebUrl}`,
    };
}
function buildMetaAppBuzzRequest(input) {
    const share = buildMetaAppShareBundle(input.pinId);
    return {
        content: normalizeText(input.message) || share.suggestedBuzz,
        contentType: 'text/plain;utf-8',
        quotePin: share.pinId,
    };
}
function buildMetaAppCommentWrite(input) {
    const pinId = (0, pinId_1.assertMetaAppPinId)(input.pinId);
    const comment = normalizeText(input.comment);
    if (!comment) {
        throw new Error('MetaApp comment requires non-empty content.');
    }
    return {
        operation: 'create',
        path: '/protocols/paycomment',
        contentType: 'application/json',
        payload: JSON.stringify({
            content: comment,
            contentType: 'text/plain;utf-8',
            commentTo: pinId,
        }),
    };
}
