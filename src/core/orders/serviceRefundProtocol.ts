export const SERVICE_REFUND_REQUEST_PATH = '/protocols/service-refund-request';
export const SERVICE_REFUND_FINALIZE_PATH = '/protocols/service-refund-finalize';

export interface ServiceRefundRequestPayload {
  version: 1;
  serviceOrderPinId: string;
  servicePinId?: string;
  paymentTxid?: string;
  paymentAmount?: string;
  paymentAsset?: string;
  buyerGlobalMetaId?: string;
  sellerGlobalMetaId?: string;
  refundAddress?: string;
  reason: string;
  requestedAt: string;
}

export interface ServiceRefundFinalizePayload {
  version: 1;
  refundRequestPinId: string;
  servicePinId?: string;
  paymentTxid?: string;
  refundTxid?: string;
  paymentAmount?: string;
  paymentAsset?: string;
  buyerGlobalMetaId?: string;
  sellerGlobalMetaId?: string;
}

export interface ParsedServiceRefundRequest {
  pinId: string;
  path: string;
  payload: ServiceRefundRequestPayload;
}

export interface ParsedServiceRefundFinalize {
  pinId: string;
  path: string;
  payload: ServiceRefundFinalizePayload;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return readObject(JSON.parse(value));
  } catch {
    return null;
  }
}

export function parseRefundProtocolContent(content: unknown): Record<string, unknown> | null {
  if (typeof content === 'string') {
    return parseJsonObject(content);
  }
  const object = readObject(content);
  if (!object) {
    return null;
  }

  const data = readObject(object.data);
  const summary = object.contentSummary ?? data?.contentSummary ?? object.content;
  if (typeof summary === 'string') {
    return parseJsonObject(summary);
  }
  const summaryObject = readObject(summary);
  if (summaryObject) {
    return summaryObject;
  }
  return object;
}

function readPinId(pin: Record<string, unknown>): string {
  return normalizeText(pin.pinId)
    || normalizeText(pin.id)
    || normalizeText(pin.pinid)
    || normalizeText(pin.PINID);
}

function readPath(pin: Record<string, unknown>): string {
  return normalizeText(pin.path);
}

function readPayload(pin: unknown): {
  pinId: string;
  path: string;
  payload: Record<string, unknown>;
} | null {
  const object = readObject(pin);
  if (!object) {
    return null;
  }
  const payload = parseRefundProtocolContent(object.content ?? object.payload ?? object.data ?? object);
  if (!payload) {
    return null;
  }
  return {
    pinId: readPinId(object),
    path: readPath(object),
    payload,
  };
}

function canonicalAsset(value: unknown): string {
  const asset = normalizeText(value).toUpperCase();
  return asset === 'MVC' ? 'SPACE' : asset;
}

function isZeroAmount(value: unknown): boolean {
  const numeric = Number(normalizeText(value));
  return Number.isFinite(numeric) && numeric === 0;
}

function isFreeSettlement(payload: Record<string, unknown>, amount: string): boolean {
  return normalizeText(payload.settlementKind).toLowerCase() === 'free' || isZeroAmount(amount);
}

function readRequestedAt(payload: Record<string, unknown>): string {
  const requestedAt = normalizeText(payload.requestedAt)
    || normalizeText(payload.createdAt)
    || normalizeText(payload.failureDetectedAt);
  if (!requestedAt) {
    return '';
  }
  const numeric = Number(requestedAt);
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric > 9_999_999_999 ? numeric : numeric * 1000;
    return new Date(milliseconds).toISOString();
  }
  const parsed = Date.parse(requestedAt);
  return Number.isNaN(parsed) ? requestedAt : new Date(parsed).toISOString();
}

function readRequestReason(payload: Record<string, unknown>): string {
  return normalizeText(payload.reason)
    || normalizeText(payload.failureReason)
    || normalizeText(payload.reasonComment);
}

export function buildServiceRefundRequestPayload(
  input: ServiceRefundRequestPayload
): ServiceRefundRequestPayload {
  return {
    version: 1,
    serviceOrderPinId: normalizeText(input.serviceOrderPinId),
    ...(normalizeText(input.servicePinId) ? { servicePinId: normalizeText(input.servicePinId) } : {}),
    ...(normalizeText(input.paymentTxid) ? { paymentTxid: normalizeText(input.paymentTxid) } : {}),
    ...(normalizeText(input.paymentAmount) ? { paymentAmount: normalizeText(input.paymentAmount) } : {}),
    ...(canonicalAsset(input.paymentAsset) ? { paymentAsset: canonicalAsset(input.paymentAsset) } : {}),
    ...(normalizeText(input.buyerGlobalMetaId) ? { buyerGlobalMetaId: normalizeText(input.buyerGlobalMetaId) } : {}),
    ...(normalizeText(input.sellerGlobalMetaId) ? { sellerGlobalMetaId: normalizeText(input.sellerGlobalMetaId) } : {}),
    ...(normalizeText(input.refundAddress) ? { refundAddress: normalizeText(input.refundAddress) } : {}),
    reason: normalizeText(input.reason),
    requestedAt: normalizeText(input.requestedAt),
  };
}

export function parseServiceRefundRequestPin(pin: unknown): ParsedServiceRefundRequest | null {
  const parsed = readPayload(pin);
  if (!parsed) {
    return null;
  }
  if (parsed.path && parsed.path !== SERVICE_REFUND_REQUEST_PATH) {
    return null;
  }
  const source = parsed.payload;
  const serviceOrderPinId = normalizeText(source.serviceOrderPinId)
    || normalizeText(source.orderMessagePinId)
    || normalizeText(source.orderPinId)
    || normalizeText(source.orderReference);
  const paymentTxid = normalizeText(source.paymentTxid);
  const paymentAmount = normalizeText(source.paymentAmount)
    || normalizeText(source.refundAmount)
    || normalizeText(source.amount);
  if (!isFreeSettlement(source, paymentAmount) && (!serviceOrderPinId || !paymentTxid)) {
    return null;
  }

  const payload = buildServiceRefundRequestPayload({
    version: 1,
    serviceOrderPinId,
    servicePinId: normalizeText(source.servicePinId),
    paymentTxid,
    paymentAmount,
    paymentAsset: canonicalAsset(source.paymentAsset || source.refundCurrency || source.currency),
    buyerGlobalMetaId: normalizeText(source.buyerGlobalMetaId),
    sellerGlobalMetaId: normalizeText(source.sellerGlobalMetaId),
    refundAddress: normalizeText(source.refundAddress) || normalizeText(source.refundToAddress),
    reason: readRequestReason(source),
    requestedAt: readRequestedAt(source),
  });
  if (!payload.serviceOrderPinId || !payload.reason || !payload.requestedAt) {
    return null;
  }
  return {
    pinId: parsed.pinId,
    path: parsed.path || SERVICE_REFUND_REQUEST_PATH,
    payload,
  };
}

export function parseServiceRefundFinalizePin(pin: unknown): ParsedServiceRefundFinalize | null {
  const parsed = readPayload(pin);
  if (!parsed) {
    return null;
  }
  if (parsed.path && parsed.path !== SERVICE_REFUND_FINALIZE_PATH) {
    return null;
  }
  const source = parsed.payload;
  const refundRequestPinId = normalizeText(source.refundRequestPinId)
    || normalizeText(source.serviceRefundRequestPinId);
  const paymentAmount = normalizeText(source.paymentAmount)
    || normalizeText(source.refundAmount)
    || normalizeText(source.amount);
  const refundTxid = normalizeText(source.refundTxid) || normalizeText(source.refundTransferTxid);
  if (!refundRequestPinId || (!isFreeSettlement(source, paymentAmount) && !refundTxid)) {
    return null;
  }

  return {
    pinId: parsed.pinId,
    path: parsed.path || SERVICE_REFUND_FINALIZE_PATH,
    payload: {
      version: 1,
      refundRequestPinId,
      ...(normalizeText(source.paymentTxid) ? { paymentTxid: normalizeText(source.paymentTxid) } : {}),
      ...(normalizeText(source.servicePinId) ? { servicePinId: normalizeText(source.servicePinId) } : {}),
      ...(refundTxid ? { refundTxid } : {}),
      ...(paymentAmount ? { paymentAmount } : {}),
      ...(canonicalAsset(source.paymentAsset || source.refundCurrency || source.currency)
        ? { paymentAsset: canonicalAsset(source.paymentAsset || source.refundCurrency || source.currency) }
        : {}),
      ...(normalizeText(source.buyerGlobalMetaId) ? { buyerGlobalMetaId: normalizeText(source.buyerGlobalMetaId) } : {}),
      ...(normalizeText(source.sellerGlobalMetaId) ? { sellerGlobalMetaId: normalizeText(source.sellerGlobalMetaId) } : {}),
    },
  };
}
