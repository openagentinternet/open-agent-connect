"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDelegationOrderSkillName = resolveDelegationOrderSkillName;
exports.buildDelegationOrderPayload = buildDelegationOrderPayload;
const orderMessage_1 = require("./orderMessage");
const ORDER_PREFIX_RE = /^\s*\[ORDER\]\s*/i;
// Generated task text may quote metadata lines with `=` separators and a
// broader set of chatty label variants beyond the canonical order metadata.
const STRUCTURED_ORDER_METADATA_LINE_RE = (0, orderMessage_1.createOrderMetadataLineRegex)({
    allowEqualsSeparator: true,
    extraLabels: [
        'payment(?:\\s+amount)?',
        'transaction\\s+id',
        'order(?:\\s+ref(?:erence)?)?',
        'service(?:\\s+pin)?\\s+id',
        'service(?:\\s+id)?',
        'serviceid',
        'skill(?:\\s+name)?',
        'provider\\s*skill',
        'service\\s+skill',
        '服务(?:\\s*pin)?\\s*id',
        '服务(?:编号|标识|ID)',
        '订单(?:编号|标识|ID)',
        '技能(?:名称?)?',
        '服务技能',
        '服务名称',
    ],
});
const TRANSPORT_CHATTER_FRAGMENT_PATTERNS = [
    /^Selected cached online service:[^\n]*/gi,
    /(?:^|[，,。；;])\s*已确认同意使用远程MetaBot服务[^，,。；;\n]*/gi,
    /(?:^|[，,。；;])\s*已支付\s*[0-9]+(?:\.[0-9]+)?\s*(?:SPACE|BTC|DOGE)[^，,。；;\n]*/gi,
    /(?:^|[，,。；;])\s*支付\s*[0-9]+(?:\.[0-9]+)?\s*(?:SPACE|BTC|DOGE)(?:费用|服务费|订单金额)?[^，,。；;\n]*/gi,
    /(?:^|[，,。；;])\s*txid\s*[:：=]?\s*[0-9a-fA-F]{6,64}[^，,。；;\n]*/gi,
    /(?:^|[，,。；;])\s*你收到一笔[^，,。；;\n]*/gi,
    /(?:^|[，,。；;])\s*已收到你[^，,。；;\n]*/gi,
    /(?:^|[，,。；;])\s*(?:马上处理|正在处理|开始处理)[^，,。；;\n]*/gi,
];
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function stripGeneratedProviderFraming(value) {
    const trimmed = normalizeText(value);
    const normalized = trimmed.replace(/\s+/g, ' ');
    const chineseMatch = normalized.match(/^(?:用户|使用者)\s*(?:请求|想要|希望|需要)\s*(?:使用|调用)?\s*[^，,。；;.!！\n]{1,80}?\s*的\s*((?:免费|付费)?[^，,。；;.!！\n]+?)(?:[。.!！\s]*)$/u);
    if (chineseMatch?.[1]) {
        return chineseMatch[1].trim();
    }
    const englishMatch = normalized.match(/^(?:the\s+)?user\s+(?:requests?|wants|needs)\s+(?:to\s+use\s+)?[^,.;!\n]{1,80}?'s\s+(.+?)(?:[.!]?\s*)$/iu);
    if (englishMatch?.[1]) {
        return englishMatch[1].trim();
    }
    return trimmed;
}
function sanitizeDelegationOrderNaturalText(value) {
    const source = String(value || '').replace(/\r\n?/g, '\n');
    if (!source.trim())
        return '';
    const keptLines = [];
    source.split('\n').forEach((line, index) => {
        const withoutPrefix = index === 0 ? line.replace(ORDER_PREFIX_RE, '') : line;
        const trimmed = withoutPrefix.trim();
        if (!trimmed)
            return;
        if (STRUCTURED_ORDER_METADATA_LINE_RE.test(trimmed))
            return;
        keptLines.push(trimmed);
    });
    let cleaned = keptLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!cleaned)
        return '';
    TRANSPORT_CHATTER_FRAGMENT_PATTERNS.forEach((pattern) => {
        cleaned = cleaned.replace(pattern, '');
    });
    return stripGeneratedProviderFraming(cleaned)
        .replace(/\s+/g, ' ')
        .replace(/^[，,。；;:：\s]+/, '')
        .replace(/[，,。；;:：\s]+$/, '')
        .trim();
}
function buildDelegationOrderNaturalText(input) {
    return (sanitizeDelegationOrderNaturalText(input.userTask)
        || sanitizeDelegationOrderNaturalText(input.rawRequest)
        || sanitizeDelegationOrderNaturalText(input.taskContext)
        || normalizeText(input.serviceName)
        || resolveDelegationOrderSkillName(input));
}
function buildDelegationOrderRawRequest(input) {
    const explicitRawRequest = stripGeneratedProviderFraming((0, orderMessage_1.normalizeOrderRawRequest)(input.rawRequest));
    if (explicitRawRequest) {
        return explicitRawRequest;
    }
    return (sanitizeDelegationOrderNaturalText(input.taskContext)
        || sanitizeDelegationOrderNaturalText(input.userTask)
        || normalizeText(input.serviceName)
        || resolveDelegationOrderSkillName(input));
}
function resolveDelegationOrderSkillName(input) {
    return normalizeText(input.providerSkill) || normalizeText(input.serviceName) || 'Service Order';
}
function buildDelegationOrderPayload(input) {
    const naturalText = buildDelegationOrderNaturalText(input);
    const skillName = resolveDelegationOrderSkillName(input);
    const rawRequest = buildDelegationOrderRawRequest(input);
    return (0, orderMessage_1.buildOrderPayload)({
        displayText: naturalText,
        rawRequest,
        price: normalizeText(input.price),
        currency: normalizeText(input.currency),
        paymentTxid: normalizeText(input.paymentTxid),
        paymentCommitTxid: normalizeText(input.paymentCommitTxid),
        paymentChain: normalizeText(input.paymentChain),
        settlementKind: normalizeText(input.settlementKind),
        mrc20Ticker: normalizeText(input.mrc20Ticker),
        mrc20Id: normalizeText(input.mrc20Id),
        orderReference: normalizeText(input.orderReference),
        serviceId: normalizeText(input.servicePinId),
        skillName,
        serviceName: normalizeText(input.serviceName),
        outputType: normalizeText(input.outputType),
    });
}
