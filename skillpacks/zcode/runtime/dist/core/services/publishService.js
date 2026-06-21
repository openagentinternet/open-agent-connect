"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePublishedServiceCurrency = normalizePublishedServiceCurrency;
exports.resolvePublishedServiceSettlement = resolvePublishedServiceSettlement;
exports.buildPublishedService = buildPublishedService;
exports.buildRevokedPublishedService = buildRevokedPublishedService;
const skillServiceProtocol_1 = require("./skillServiceProtocol");
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
    const providerSkills = (0, skillServiceProtocol_1.normalizeProviderSkillList)((0, skillServiceProtocol_1.selectProviderSkillSource)(draft));
    const paymentTerms = (0, skillServiceProtocol_1.resolveSkillServicePaymentTerms)({
        price: draft.price,
        currency: draft.currency,
        paymentTiming: draft.paymentTiming,
        settlementKind: draft.settlementKind,
    });
    return {
        serviceName: normalizeText(draft.serviceName),
        displayName: normalizeText(draft.displayName),
        description: normalizeText(draft.description),
        providerSkill: (0, skillServiceProtocol_1.getPrimaryProviderSkill)(providerSkills) ?? normalizeText(draft.providerSkill),
        providerSkills,
        price: paymentTerms.effectivePrice,
        currency: paymentTerms.currency,
        paymentTiming: paymentTerms.paymentTiming,
        settlementKind: paymentTerms.settlementKind,
        executionReminder: normalizeText(draft.executionReminder),
        metadata: normalizeText(draft.metadata),
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
        providerSkill: draft.providerSkills,
        price: draft.price,
        currency: settlement.currency,
        paymentTiming: draft.paymentTiming,
        paymentChain: settlement.paymentChain,
        settlementKind: draft.settlementKind,
        mrc20Ticker: settlement.mrc20Ticker,
        mrc20Id: settlement.mrc20Id,
        executionReminder: draft.executionReminder,
        metadata: draft.metadata,
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
        providerSkills: draft.providerSkills,
        serviceName: draft.serviceName,
        displayName: draft.displayName,
        description: draft.description,
        serviceIcon: draft.serviceIconUri || null,
        price: draft.price,
        currency: settlement.currency,
        paymentTiming: draft.paymentTiming,
        paymentChain: settlement.paymentChain,
        settlementKind: draft.settlementKind,
        mrc20Ticker: settlement.mrc20Ticker,
        mrc20Id: settlement.mrc20Id,
        executionReminder: draft.executionReminder,
        metadata: draft.metadata,
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
    const providerSkills = (0, skillServiceProtocol_1.normalizeProviderSkillList)((0, skillServiceProtocol_1.selectProviderSkillSource)(input));
    const paymentTerms = (0, skillServiceProtocol_1.resolveSkillServicePaymentTerms)({
        price: input.price,
        currency: input.currency,
        paymentTiming: input.paymentTiming,
        settlementKind: input.settlementKind,
    });
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
        providerSkill: (0, skillServiceProtocol_1.getPrimaryProviderSkill)(providerSkills) ?? normalizeText(input.providerSkill),
        providerSkills,
        serviceName: normalizeText(input.serviceName),
        displayName: normalizeText(input.displayName) || normalizeText(input.serviceName),
        description: normalizeText(input.description),
        serviceIcon: normalizeText(input.serviceIcon) || null,
        price: paymentTerms.effectivePrice,
        currency: settlement.currency,
        paymentTiming: paymentTerms.paymentTiming,
        paymentChain: normalizeText(input.paymentChain) || settlement.paymentChain,
        settlementKind: normalizeText(input.settlementKind) || paymentTerms.settlementKind || settlement.settlementKind,
        mrc20Ticker: normalizeText(input.mrc20Ticker) || settlement.mrc20Ticker,
        mrc20Id: normalizeText(input.mrc20Id) || settlement.mrc20Id,
        executionReminder: normalizeText(input.executionReminder),
        metadata: normalizeText(input.metadata),
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
