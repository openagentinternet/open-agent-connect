"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePublishedServiceCurrency = normalizePublishedServiceCurrency;
exports.buildPublishedService = buildPublishedService;
exports.buildRevokedPublishedService = buildRevokedPublishedService;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizePublishedServiceCurrency(value) {
    const normalized = normalizeText(value).toUpperCase();
    return normalized === 'MVC' ? 'SPACE' : normalized;
}
function normalizeDraft(draft) {
    return {
        serviceName: normalizeText(draft.serviceName),
        displayName: normalizeText(draft.displayName),
        description: normalizeText(draft.description),
        providerSkill: normalizeText(draft.providerSkill),
        price: normalizeText(draft.price),
        currency: normalizePublishedServiceCurrency(draft.currency),
        outputType: normalizeText(draft.outputType).toLowerCase() || 'text',
        serviceIconUri: normalizeText(draft.serviceIconUri) || null,
    };
}
function buildPublishedService(input) {
    const draft = normalizeDraft(input.draft);
    const payload = {
        serviceName: draft.serviceName,
        displayName: draft.displayName,
        description: draft.description,
        serviceIcon: draft.serviceIconUri || '',
        providerMetaBot: normalizeText(input.providerGlobalMetaId),
        providerSkill: draft.providerSkill,
        price: draft.price,
        currency: draft.currency,
        skillDocument: normalizeText(input.skillDocument),
        inputType: 'text',
        outputType: draft.outputType || 'text',
        endpoint: 'simplemsg',
        paymentAddress: normalizeText(input.paymentAddress),
    };
    const record = {
        id: normalizeText(input.sourceServicePinId),
        sourceServicePinId: normalizeText(input.sourceServicePinId),
        currentPinId: normalizeText(input.currentPinId) || normalizeText(input.sourceServicePinId),
        creatorMetabotId: input.creatorMetabotId,
        providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
        providerSkill: draft.providerSkill,
        serviceName: draft.serviceName,
        displayName: draft.displayName,
        description: draft.description,
        serviceIcon: draft.serviceIconUri || null,
        price: draft.price,
        currency: draft.currency,
        skillDocument: normalizeText(input.skillDocument),
        inputType: 'text',
        outputType: draft.outputType || 'text',
        endpoint: 'simplemsg',
        paymentAddress: normalizeText(input.paymentAddress),
        payloadJson: JSON.stringify(payload),
        available: 1,
        revokedAt: null,
        updatedAt: input.now,
    };
    return { payload, record };
}
function buildRevokedPublishedService(input) {
    return {
        id: normalizeText(input.sourceServicePinId),
        sourceServicePinId: normalizeText(input.sourceServicePinId),
        currentPinId: normalizeText(input.currentPinId) || normalizeText(input.sourceServicePinId),
        creatorMetabotId: input.creatorMetabotId,
        providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
        providerSkill: normalizeText(input.providerSkill),
        serviceName: normalizeText(input.serviceName),
        displayName: normalizeText(input.displayName) || normalizeText(input.serviceName),
        description: normalizeText(input.description),
        serviceIcon: normalizeText(input.serviceIcon) || null,
        price: normalizeText(input.price),
        currency: normalizePublishedServiceCurrency(input.currency),
        skillDocument: normalizeText(input.skillDocument),
        inputType: 'text',
        outputType: 'text',
        endpoint: 'simplemsg',
        paymentAddress: '',
        payloadJson: '',
        available: 0,
        revokedAt: input.now,
        updatedAt: input.now,
    };
}
