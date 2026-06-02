"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeProviderSkillList = normalizeProviderSkillList;
exports.getPrimaryProviderSkill = getPrimaryProviderSkill;
exports.normalizeSkillServicePaymentTiming = normalizeSkillServicePaymentTiming;
exports.normalizeSkillServiceSettlementKind = normalizeSkillServiceSettlementKind;
exports.normalizeSkillServiceCurrency = normalizeSkillServiceCurrency;
exports.isExecutableSkillServicePaymentTerm = isExecutableSkillServicePaymentTerm;
exports.resolveSkillServicePaymentTerms = resolveSkillServicePaymentTerms;
exports.buildSkillServiceOrderPayload = buildSkillServiceOrderPayload;
const platformSkillCatalog_1 = require("./platformSkillCatalog");
const VALID_PAYMENT_TIMINGS = new Set(['free', 'prepaid', 'postpaid']);
const VALID_SETTLEMENT_KINDS = new Set(['native', 'fiat']);
const PLAIN_NON_NEGATIVE_DECIMAL_RE = /^\d+(?:\.\d+)?$/;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeScalarText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function parsePlainNonNegativeDecimal(value) {
    const raw = normalizeScalarText(value);
    if (!PLAIN_NON_NEGATIVE_DECIMAL_RE.test(raw)) {
        return { value: '0', isPositive: false };
    }
    const isPositive = /[1-9]/.test(raw);
    return { value: isPositive ? raw : '0', isPositive };
}
function normalizeProviderSkillList(value) {
    const rawSkills = Array.isArray(value) ? value : [value];
    const seen = new Set();
    const skills = [];
    for (const rawSkill of rawSkills) {
        const skillName = normalizeText(rawSkill);
        if (!skillName || !(0, platformSkillCatalog_1.isSafeProviderSkillName)(skillName) || seen.has(skillName)) {
            continue;
        }
        seen.add(skillName);
        skills.push(skillName);
    }
    return skills;
}
function getPrimaryProviderSkill(value) {
    return normalizeProviderSkillList(value)[0] ?? null;
}
function normalizeSkillServicePaymentTiming(value, price) {
    const normalized = normalizeText(value).toLowerCase();
    if (VALID_PAYMENT_TIMINGS.has(normalized)) {
        return normalized;
    }
    return parsePlainNonNegativeDecimal(price).isPositive ? 'prepaid' : 'free';
}
function normalizeSkillServiceSettlementKind(value) {
    const normalized = normalizeText(value).toLowerCase();
    return VALID_SETTLEMENT_KINDS.has(normalized)
        ? normalized
        : 'native';
}
function normalizeSkillServiceCurrency(value) {
    const normalized = normalizeScalarText(value).toUpperCase();
    if (!normalized || normalized === 'MVC' || normalized === 'MICROVISIONCHAIN') {
        return 'SPACE';
    }
    if (normalized === 'BITCOIN')
        return 'BTC';
    if (normalized === 'DOGECOIN')
        return 'DOGE';
    if (normalized === 'OPCAT' || normalized === 'BTC_OPCAT')
        return 'BTC-OPCAT';
    return normalized;
}
function isExecutableSkillServicePaymentTerm(value) {
    const price = parsePlainNonNegativeDecimal(value.effectivePrice ?? value.price);
    const paymentTiming = normalizeSkillServicePaymentTiming(value.paymentTiming, price.value);
    const settlementKind = normalizeSkillServiceSettlementKind(value.settlementKind);
    if (paymentTiming === 'free') {
        return true;
    }
    if (paymentTiming === 'prepaid' && settlementKind === 'native' && price.isPositive) {
        return true;
    }
    return false;
}
function resolveSkillServicePaymentTerms(input = {}) {
    const paymentTiming = normalizeSkillServicePaymentTiming(input.paymentTiming, input.price);
    const parsedPrice = parsePlainNonNegativeDecimal(input.price);
    const effectivePrice = paymentTiming === 'free' ? '0' : parsedPrice.value;
    const settlementKind = normalizeSkillServiceSettlementKind(input.protocolSettlementKind ?? input.settlementKind);
    const term = {
        paymentTiming,
        effectivePrice,
        currency: normalizeSkillServiceCurrency(input.currency),
        settlementKind,
        isFree: paymentTiming === 'free',
    };
    return {
        ...term,
        isExecutable: isExecutableSkillServicePaymentTerm(term),
    };
}
function buildSkillServiceOrderPayload(input = {}) {
    const paymentTerms = resolveSkillServicePaymentTerms(input);
    return {
        servicePinId: normalizeText(input.servicePinId),
        paymentTxid: paymentTerms.isFree ? '' : normalizeText(input.paymentTxid),
        price: paymentTerms.effectivePrice,
        currency: paymentTerms.currency,
        settlementKind: paymentTerms.settlementKind,
        metadata: normalizeText(input.metadata),
    };
}
