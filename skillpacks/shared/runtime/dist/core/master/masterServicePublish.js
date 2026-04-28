"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublishedMaster = buildPublishedMaster;
exports.buildMasterPublishChainWrite = buildMasterPublishChainWrite;
exports.publishMasterToChain = publishMasterToChain;
const masterTypes_1 = require("./masterTypes");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeCurrency(value) {
    const normalized = normalizeText(value).toUpperCase();
    return normalized === 'MVC' ? 'SPACE' : normalized;
}
function buildPublishedMaster(input) {
    const payload = {
        serviceName: normalizeText(input.draft.serviceName),
        displayName: normalizeText(input.draft.displayName),
        description: normalizeText(input.draft.description),
        providerMetaBot: normalizeText(input.providerGlobalMetaId),
        masterKind: normalizeText(input.draft.masterKind),
        specialties: [...input.draft.specialties],
        hostModes: [...input.draft.hostModes],
        modelInfo: input.draft.modelInfo ? { ...input.draft.modelInfo } : null,
        style: input.draft.style,
        pricingMode: input.draft.pricingMode,
        price: normalizeText(input.draft.price),
        currency: normalizeCurrency(input.draft.currency),
        responseMode: input.draft.responseMode,
        contextPolicy: input.draft.contextPolicy,
        official: input.draft.official,
        trustedTier: input.draft.trustedTier,
    };
    const record = {
        id: normalizeText(input.sourceMasterPinId),
        sourceMasterPinId: normalizeText(input.sourceMasterPinId),
        currentPinId: normalizeText(input.currentPinId) || normalizeText(input.sourceMasterPinId),
        creatorMetabotId: input.creatorMetabotId,
        providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
        providerAddress: normalizeText(input.providerAddress),
        serviceName: normalizeText(input.draft.serviceName),
        displayName: normalizeText(input.draft.displayName),
        description: normalizeText(input.draft.description),
        masterKind: normalizeText(input.draft.masterKind),
        specialties: [...input.draft.specialties],
        hostModes: [...input.draft.hostModes],
        modelInfoJson: input.draft.modelInfo ? JSON.stringify(input.draft.modelInfo) : null,
        style: input.draft.style,
        pricingMode: input.draft.pricingMode,
        price: normalizeText(input.draft.price),
        currency: normalizeCurrency(input.draft.currency),
        responseMode: input.draft.responseMode,
        contextPolicy: input.draft.contextPolicy,
        official: input.draft.official ? 1 : 0,
        trustedTier: input.draft.trustedTier,
        payloadJson: JSON.stringify(payload),
        available: 1,
        revokedAt: null,
        updatedAt: input.now,
    };
    return { payload, record };
}
function buildMasterPublishChainWrite(input) {
    return {
        operation: 'create',
        path: masterTypes_1.MASTER_SERVICE_PROTOCOL_PATH,
        payload: JSON.stringify(input.payload),
        contentType: 'application/json',
        network: normalizeText(input.network).toLowerCase() || 'mvc',
    };
}
async function publishMasterToChain(input) {
    const prepared = buildPublishedMaster({
        sourceMasterPinId: masterTypes_1.PENDING_MASTER_PIN_ID,
        currentPinId: masterTypes_1.PENDING_MASTER_PIN_ID,
        creatorMetabotId: input.creatorMetabotId,
        providerGlobalMetaId: input.providerGlobalMetaId,
        providerAddress: input.providerAddress,
        draft: input.draft,
        now: input.now,
    });
    const chainWriteRequest = buildMasterPublishChainWrite({
        payload: prepared.payload,
        network: input.network,
    });
    const chainWrite = await input.signer.writePin(chainWriteRequest);
    const chainPinId = normalizeText(chainWrite.pinId);
    const published = buildPublishedMaster({
        sourceMasterPinId: chainPinId,
        currentPinId: chainPinId,
        creatorMetabotId: input.creatorMetabotId,
        providerGlobalMetaId: input.providerGlobalMetaId,
        providerAddress: input.providerAddress,
        draft: input.draft,
        now: input.now,
    });
    return {
        payload: published.payload,
        record: published.record,
        chainWrite,
    };
}
