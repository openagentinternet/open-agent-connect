"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.containsDelegationControlPrefix = containsDelegationControlPrefix;
exports.getDelegationDisplayText = getDelegationDisplayText;
exports.isExplicitMetaAppUserRequest = isExplicitMetaAppUserRequest;
exports.normalizeDelegationPaymentTerms = normalizeDelegationPaymentTerms;
exports.isDelegationPriceNumeric = isDelegationPriceNumeric;
exports.parseDelegationMessage = parseDelegationMessage;
exports.buildRemoteServicesPrompt = buildRemoteServicesPrompt;
exports.planRemoteCall = planRemoteCall;
const node_crypto_1 = require("node:crypto");
const spendPolicy_1 = require("./spendPolicy");
const delegationPolicy_1 = require("../a2a/delegationPolicy");
const DELEGATE_REMOTE_SERVICE_PREFIX = '[DELEGATE_REMOTE_SERVICE]';
const NUMERIC_DELEGATION_PRICE_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const DECORATED_DELEGATION_PRICE_RE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s+([A-Za-z]+))$/;
const DELEGATION_PARTIAL_PREFIX_MIN_CHARS = 1;
const METAAPP_GENERIC_CONFIRMATION_RE = /^(?:好|好的|好呀|好哒|行|可以|确定|确认|继续|开始吧|请开始|没问题|嗯|嗯嗯|ok|okay|yes|yep|sure)[!！。.\s]*$/i;
const METAAPP_EXPLICIT_INTENT_RE = /\b(?:open|launch|start|use|run)\b|(?:打开|开启|启动|运行|使用|进入)/i;
const METAAPP_CONTEXT_WORD_RE = /\b(?:metaapp|app|application)\b|(?:应用|应用页|本地应用|本地app|本地 App|MetaApp)/i;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeCaseInsensitive(value) {
    return normalizeText(value).toLowerCase();
}
function truncateTraceSegment(value) {
    return value.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').slice(0, 16) || 'trace';
}
function resolveServiceIdentity(service) {
    return {
        servicePinId: normalizeText(service.servicePinId) || normalizeText(service.pinId),
        providerGlobalMetaId: normalizeText(service.providerGlobalMetaId),
    };
}
function buildRemoteCallTraceId(input) {
    const explicit = normalizeText(input.traceId);
    if (explicit)
        return explicit;
    const provider = truncateTraceSegment(normalizeText(input.request.providerGlobalMetaId) || 'provider');
    const service = truncateTraceSegment(normalizeText(input.request.servicePinId) || 'service');
    const timestamp = Date.now().toString(36);
    const nonce = (0, node_crypto_1.randomUUID)().replace(/-/g, '').slice(0, 8);
    return `trace-${provider}-${service}-${timestamp}-${nonce}`;
}
function findTrailingDelegationPrefixFragmentStart(content) {
    if (typeof content !== 'string' || content.length === 0) {
        return -1;
    }
    const maxFragmentLength = Math.min(DELEGATE_REMOTE_SERVICE_PREFIX.length - 1, content.length);
    for (let length = maxFragmentLength; length >= DELEGATION_PARTIAL_PREFIX_MIN_CHARS; length -= 1) {
        if (DELEGATE_REMOTE_SERVICE_PREFIX.startsWith(content.slice(-length))) {
            return content.length - length;
        }
    }
    return -1;
}
function containsDelegationControlPrefix(content) {
    return typeof content === 'string' && content.includes(DELEGATE_REMOTE_SERVICE_PREFIX);
}
function getDelegationDisplayText(content) {
    if (typeof content !== 'string' || !content) {
        return '';
    }
    const fullPrefixIndex = content.indexOf(DELEGATE_REMOTE_SERVICE_PREFIX);
    if (fullPrefixIndex >= 0) {
        return content.slice(0, fullPrefixIndex).trimEnd();
    }
    const partialPrefixStart = findTrailingDelegationPrefixFragmentStart(content);
    if (partialPrefixStart >= 0) {
        return content.slice(0, partialPrefixStart).trimEnd();
    }
    return content;
}
function isExplicitMetaAppUserRequest(userText, appId) {
    const normalizedText = normalizeText(userText).toLowerCase();
    if (!normalizedText) {
        return false;
    }
    if (METAAPP_GENERIC_CONFIRMATION_RE.test(normalizedText)) {
        return false;
    }
    const normalizedAppId = normalizeText(appId).toLowerCase();
    const mentionsAppId = normalizedAppId.length > 0 && normalizedText.includes(normalizedAppId);
    const hasIntentVerb = METAAPP_EXPLICIT_INTENT_RE.test(userText);
    const hasMetaAppContext = METAAPP_CONTEXT_WORD_RE.test(userText);
    if (mentionsAppId && (hasIntentVerb || hasMetaAppContext)) {
        return true;
    }
    return hasIntentVerb && hasMetaAppContext;
}
function normalizeDelegationPaymentTerms(rawPrice, rawCurrency) {
    let price = normalizeText(rawPrice);
    let currency = normalizeText(rawCurrency);
    const decoratedMatch = price.match(DECORATED_DELEGATION_PRICE_RE);
    if (decoratedMatch) {
        price = decoratedMatch[1];
        if (!currency && decoratedMatch[2]) {
            currency = decoratedMatch[2];
        }
    }
    return { price, currency };
}
function isDelegationPriceNumeric(value) {
    return NUMERIC_DELEGATION_PRICE_RE.test(normalizeText(value));
}
function parseDelegationMessage(content) {
    const idx = content.indexOf(DELEGATE_REMOTE_SERVICE_PREFIX);
    if (idx === -1)
        return null;
    const afterPrefix = content.slice(idx + DELEGATE_REMOTE_SERVICE_PREFIX.length);
    const firstBrace = afterPrefix.indexOf('{');
    const lastBrace = afterPrefix.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace)
        return null;
    const jsonStr = afterPrefix.slice(firstBrace, lastBrace + 1);
    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') {
        return null;
    }
    const obj = parsed;
    if (typeof obj.servicePinId !== 'string' || !obj.servicePinId
        || typeof obj.serviceName !== 'string' || !obj.serviceName
        || typeof obj.providerGlobalMetaid !== 'string' || !obj.providerGlobalMetaid) {
        return null;
    }
    const normalizedTerms = normalizeDelegationPaymentTerms(obj.price, obj.currency);
    return {
        servicePinId: obj.servicePinId,
        serviceName: obj.serviceName,
        providerGlobalMetaid: obj.providerGlobalMetaid,
        price: normalizedTerms.price,
        currency: normalizedTerms.currency,
        userTask: typeof obj.userTask === 'string' ? obj.userTask : '',
        taskContext: typeof obj.taskContext === 'string' ? obj.taskContext : '',
        rawRequest: typeof obj.rawRequest === 'string' ? obj.rawRequest : '',
    };
}
function buildRemoteServicesPrompt(availableServices) {
    if (!availableServices || availableServices.length === 0)
        return null;
    const entries = availableServices
        .map((svc) => {
        const identity = resolveServiceIdentity(svc);
        return (`  <remote_service>` +
            `<service_pin_id>${identity.servicePinId}</service_pin_id>` +
            `<service_name>${normalizeText(svc.displayName) || normalizeText(svc.serviceName)}</service_name>` +
            `<description>${normalizeText(svc.description)}</description>` +
            `<price_amount>${normalizeText(svc.price)}</price_amount>` +
            `<price_currency>${(0, spendPolicy_1.normalizeSpendCurrency)(svc.currency)}</price_currency>` +
            `<rating_avg>${svc.ratingAvg ?? 'N/A'}</rating_avg>` +
            `<rating_count>${svc.ratingCount ?? 0}</rating_count>` +
            `<provider_global_metaid>${identity.providerGlobalMetaId}</provider_global_metaid>` +
            `</remote_service>`);
    })
        .join('\n');
    return (`\n<available_remote_services>\n` +
        `  <notice>\n` +
        `    These are remote on-chain services.\n` +
        `    If a remote service matches and the user confirms, emit [DELEGATE_REMOTE_SERVICE] plus JSON.\n` +
        `  </notice>\n` +
        entries +
        '\n' +
        `</available_remote_services>\n`);
}
function planRemoteCall(input) {
    const requestedServicePinId = normalizeCaseInsensitive(input.request.servicePinId);
    const requestedProvider = normalizeCaseInsensitive(input.request.providerGlobalMetaId);
    const service = input.availableServices.find((candidate) => {
        const identity = resolveServiceIdentity(candidate);
        return (normalizeCaseInsensitive(identity.servicePinId) === requestedServicePinId
            && normalizeCaseInsensitive(identity.providerGlobalMetaId) === requestedProvider);
    });
    const traceId = buildRemoteCallTraceId({
        request: input.request,
        traceId: input.traceId,
    });
    if (!service) {
        return {
            ok: false,
            state: 'offline',
            code: 'service_offline',
            message: 'Remote service is offline or unavailable.',
            traceId,
        };
    }
    const normalizedTerms = normalizeDelegationPaymentTerms(service.price, service.currency);
    const normalizedCurrency = (0, spendPolicy_1.normalizeSpendCurrency)(normalizedTerms.currency);
    const confirmation = (0, delegationPolicy_1.evaluateDelegationPolicy)({
        policyMode: input.request.policyMode,
        estimatedCostAmount: normalizedTerms.price || '0',
        estimatedCostCurrency: normalizedCurrency,
    });
    const spendDecision = (0, spendPolicy_1.evaluateSpendCap)({
        price: normalizedTerms.price || '0',
        currency: normalizedCurrency,
        spendCap: input.request.spendCap,
    });
    if (!spendDecision.allowed) {
        return {
            ok: false,
            state: 'blocked',
            code: spendDecision.code || 'remote_call_blocked',
            message: spendDecision.reason || 'Remote call is blocked.',
            traceId,
            confirmation,
        };
    }
    if (input.manualRefundRequired) {
        return {
            ok: false,
            state: 'manual_action_required',
            code: 'manual_refund_required',
            message: 'Manual refund confirmation is required before continuing.',
            traceId,
            confirmation,
        };
    }
    return {
        ok: true,
        state: 'ready',
        code: 'remote_call_ready',
        service: {
            servicePinId: resolveServiceIdentity(service).servicePinId,
            providerGlobalMetaId: resolveServiceIdentity(service).providerGlobalMetaId,
            serviceName: normalizeText(service.displayName) || normalizeText(service.serviceName),
            price: normalizedTerms.price || '0',
            currency: normalizedCurrency,
        },
        payment: {
            amount: normalizedTerms.price || '0',
            currency: normalizedCurrency,
        },
        traceId,
        confirmation,
    };
}
