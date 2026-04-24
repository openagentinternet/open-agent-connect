"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServicePublishChainWrite = buildServicePublishChainWrite;
exports.publishServiceToChain = publishServiceToChain;
const publishService_1 = require("./publishService");
const SKILL_SERVICE_PROTOCOL_PATH = '/protocols/skill-service';
const PENDING_SERVICE_PIN_ID = 'pending-skill-service-pin';
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
async function publishServiceToChain(input) {
    const prepared = (0, publishService_1.buildPublishedService)({
        sourceServicePinId: PENDING_SERVICE_PIN_ID,
        currentPinId: PENDING_SERVICE_PIN_ID,
        creatorMetabotId: input.creatorMetabotId,
        providerGlobalMetaId: input.providerGlobalMetaId,
        paymentAddress: input.paymentAddress,
        draft: input.draft,
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
        draft: input.draft,
        skillDocument: input.skillDocument,
        now: input.now,
    });
    return {
        payload: published.payload,
        record: published.record,
        chainWrite,
    };
}
