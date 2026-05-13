"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServicePublishChainWrite = buildServicePublishChainWrite;
exports.publishServiceToChain = publishServiceToChain;
const publishService_1 = require("./publishService");
const SKILL_SERVICE_PROTOCOL_PATH = '/protocols/skill-service';
const PENDING_SERVICE_PIN_ID = 'pending-skill-service-pin';
const MAX_SERVICE_ICON_BYTES = 2 * 1024 * 1024;
const SERVICE_ICON_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
]);
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function buildServicePublishChainWrite(input) {
    return {
        operation: 'create',
        path: SKILL_SERVICE_PROTOCOL_PATH,
        payload: JSON.stringify(input.payload),
        contentType: 'application/json',
        network: normalizeText(input.network).toLowerCase() || 'mvc',
    };
}
function parseServiceIconDataUrl(value) {
    const normalized = normalizeText(value);
    const match = normalized.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/iu);
    if (!match) {
        return null;
    }
    const mimeType = normalizeText(match[1]).toLowerCase();
    const base64 = match[2].replace(/\s+/gu, '');
    if (!mimeType || !base64 || !SERVICE_ICON_MIME_TYPES.has(mimeType)) {
        return null;
    }
    const bytes = Buffer.byteLength(base64, 'base64');
    if (bytes <= 0 || bytes > MAX_SERVICE_ICON_BYTES) {
        return null;
    }
    return { mimeType, base64, bytes };
}
async function uploadServiceIconDataUrl(input) {
    const serviceIconDataUrl = normalizeText(input.serviceIconDataUrl);
    if (!serviceIconDataUrl) {
        return { serviceIconUri: null };
    }
    const parsed = parseServiceIconDataUrl(serviceIconDataUrl);
    if (!parsed) {
        throw new Error('Service icon must be a valid image data URL of 2MB or less.');
    }
    const requestedNetwork = normalizeText(input.network).toLowerCase() || 'mvc';
    const network = requestedNetwork === 'doge' ? 'mvc' : requestedNetwork;
    const upload = await input.signer.writePin({
        operation: 'create',
        path: '/file',
        payload: parsed.base64,
        contentType: parsed.mimeType,
        encoding: 'base64',
        network,
    });
    return {
        serviceIconUri: `metafile://${normalizeText(upload.pinId)}`,
        upload,
    };
}
async function publishServiceToChain(input) {
    const icon = await uploadServiceIconDataUrl({
        signer: input.signer,
        serviceIconDataUrl: input.draft.serviceIconDataUrl,
        network: input.network,
    });
    const draft = {
        ...input.draft,
        serviceIconUri: icon.serviceIconUri || input.draft.serviceIconUri || null,
    };
    const prepared = (0, publishService_1.buildPublishedService)({
        sourceServicePinId: PENDING_SERVICE_PIN_ID,
        currentPinId: PENDING_SERVICE_PIN_ID,
        creatorMetabotId: input.creatorMetabotId,
        providerGlobalMetaId: input.providerGlobalMetaId,
        paymentAddress: input.paymentAddress,
        draft,
        skillDocument: input.skillDocument,
        now: input.now,
    });
    const chainWriteRequest = buildServicePublishChainWrite({
        payload: prepared.payload,
        network: input.network,
    });
    const chainWrite = await input.signer.writePin(chainWriteRequest);
    const chainPinId = normalizeText(chainWrite.pinId);
    const published = (0, publishService_1.buildPublishedService)({
        sourceServicePinId: chainPinId,
        currentPinId: chainPinId,
        creatorMetabotId: input.creatorMetabotId,
        providerGlobalMetaId: input.providerGlobalMetaId,
        paymentAddress: input.paymentAddress,
        draft,
        skillDocument: input.skillDocument,
        now: input.now,
    });
    return {
        payload: published.payload,
        record: published.record,
        ...(icon.upload ? { serviceIconUpload: icon.upload } : {}),
        chainWrite,
    };
}
