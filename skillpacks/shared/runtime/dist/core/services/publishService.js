"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePublishedServiceCurrency = normalizePublishedServiceCurrency;
exports.resolvePublishedServiceSettlement = resolvePublishedServiceSettlement;
exports.buildPublishedService = buildPublishedService;
exports.buildRevokedPublishedService = buildRevokedPublishedService;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizePublishedServiceCurrency(value) {
    const normalized = normalizeText(value).toUpperCase();
    return normalized === 'MVC' ? 'SPACE' : normalized;
}
function resolvePublishedServiceSettlement(value) {
    const normalized = normalizePublishedServiceCurrency(value);
    if (normalized === 'SPACE') {
        return {
            currency: 'SPACE',
            paymentChain: 'mvc',
            settlementKind: 'native',
            mrc20Ticker: null,
            mrc20Id: null,
        };
    }
    if (normalized === 'BTC') {
        return {
            currency: 'BTC',
            paymentChain: 'btc',
            settlementKind: 'native',
            mrc20Ticker: null,
            mrc20Id: null,
        };
    }
    if (normalized === 'DOGE') {
        return {
            currency: 'DOGE',
            paymentChain: 'doge',
            settlementKind: 'native',
            mrc20Ticker: null,
            mrc20Id: null,
        };
    }
    if (normalized === 'BTC-OPCAT' || normalized === 'BTC_OPCAT' || normalized === 'OPCAT') {
        return {
            currency: 'BTC-OPCAT',
            paymentChain: 'opcat',
            settlementKind: 'native',
            mrc20Ticker: null,
            mrc20Id: null,
        };
    }
    return {
        currency: normalized,
        paymentChain: null,
        settlementKind: null,
        mrc20Ticker: null,
        mrc20Id: null,
    };
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
    const settlement = resolvePublishedServiceSettlement(draft.currency);
    const payload = {
        serviceName: draft.serviceName,
        displayName: draft.displayName,
        description: draft.description,
        serviceIcon: draft.serviceIconUri || '',
        providerMetaBot: normalizeText(input.providerGlobalMetaId),
        providerSkill: draft.providerSkill,
        price: draft.price,
        currency: settlement.currency,
        paymentChain: settlement.paymentChain,
        settlementKind: settlement.settlementKind,
        mrc20Ticker: settlement.mrc20Ticker,
        mrc20Id: settlement.mrc20Id,
        skillDocument: '',
        inputType: 'text',
        outputType: draft.outputType || 'text',
        endpoint: 'simplemsg',
        paymentAddress: normalizeText(input.paymentAddress),
    };
    const record = {
        id: normalizeText(input.sourceServicePinId),
        sourceServicePinId: normalizeText(input.sourceServicePinId),
        currentPinId: normalizeText(input.currentPinId) || normalizeText(input.sourceServicePinId),
        chainPinIds: [...new Set([
                normalizeText(input.sourceServicePinId),
                normalizeText(input.currentPinId) || normalizeText(input.sourceServicePinId),
            ].filter(Boolean))],
        creatorMetabotId: input.creatorMetabotId,
        providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
        providerSkill: draft.providerSkill,
        serviceName: draft.serviceName,
        displayName: draft.displayName,
        description: draft.description,
        serviceIcon: draft.serviceIconUri || null,
        price: draft.price,
        currency: settlement.currency,
        paymentChain: settlement.paymentChain,
        settlementKind: settlement.settlementKind,
        mrc20Ticker: settlement.mrc20Ticker,
        mrc20Id: settlement.mrc20Id,
        skillDocument: '',
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
    const settlement = resolvePublishedServiceSettlement(input.currency);
    return {
        id: normalizeText(input.sourceServicePinId),
        sourceServicePinId: normalizeText(input.sourceServicePinId),
        currentPinId: normalizeText(input.currentPinId) || normalizeText(input.sourceServicePinId),
        chainPinIds: [...new Set([
                normalizeText(input.sourceServicePinId),
                normalizeText(input.currentPinId) || normalizeText(input.sourceServicePinId),
            ].filter(Boolean))],
        creatorMetabotId: input.creatorMetabotId,
        providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
        providerSkill: normalizeText(input.providerSkill),
        serviceName: normalizeText(input.serviceName),
        displayName: normalizeText(input.displayName) || normalizeText(input.serviceName),
        description: normalizeText(input.description),
        serviceIcon: normalizeText(input.serviceIcon) || null,
        price: normalizeText(input.price),
        currency: settlement.currency,
        paymentChain: normalizeText(input.paymentChain) || settlement.paymentChain,
        settlementKind: normalizeText(input.settlementKind) || settlement.settlementKind,
        mrc20Ticker: normalizeText(input.mrc20Ticker) || settlement.mrc20Ticker,
        mrc20Id: normalizeText(input.mrc20Id) || settlement.mrc20Id,
        skillDocument: '',
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
