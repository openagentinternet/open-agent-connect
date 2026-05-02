const ORDER_STATUS_TAG = 'ORDER_STATUS';
const DELIVERY_TAG = 'DELIVERY';
const NEEDS_RATING_TAG = 'NeedsRating';
const ORDER_END_TAG = 'ORDER_END';
const ORDER_TXID_RE = /^[0-9a-f]{64}$/i;
const ORDER_TAG_RE = /^\[([A-Za-z_]+)(?::([0-9a-fA-F]{64})(?:\s+([A-Za-z0-9_-]+))?)?\]/;

export type OrderProtocolTag = 'ORDER_STATUS' | 'DELIVERY' | 'NeedsRating' | 'ORDER_END';

export interface DeliveryMessagePayload {
  paymentTxid?: string | null;
  servicePinId?: string | null;
  serviceName?: string | null;
  result?: string | null;
  deliveredAt?: number | null;
  orderTxid?: string;
  [key: string]: unknown;
}

export interface ParsedOrderStatusMessage {
  orderTxid?: string;
  content: string;
}

export interface ParsedNeedsRatingMessage {
  orderTxid?: string;
  content: string;
}

export interface ParsedOrderEndMessage {
  orderTxid?: string;
  reason: string;
  content: string;
}

export type ParsedDeliveryMessage = DeliveryMessagePayload;

export type ParsedOrderProtocolMessage =
  | ParsedOrderStatusMessage
  | ParsedDeliveryMessage
  | ParsedNeedsRatingMessage
  | ParsedOrderEndMessage;

interface ParsedOrderProtocolTag {
  tag: string;
  orderTxid: string;
  reason: string;
  rest: string;
}

export function normalizeOrderProtocolTxid(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ORDER_TXID_RE.test(normalized) ? normalized : '';
}

function buildOrderProtocolPrefix(tag: OrderProtocolTag, orderTxid?: unknown): string {
  const normalizedTxid = normalizeOrderProtocolTxid(orderTxid);
  return normalizedTxid ? `[${tag}:${normalizedTxid}]` : `[${tag}]`;
}

function parseOrderProtocolTag(content: string): ParsedOrderProtocolTag | null {
  const trimmed = String(content || '').trim();
  const match = trimmed.match(ORDER_TAG_RE);
  if (!match) {
    const legacyOrderEndMatch = trimmed.match(/^\[(ORDER_END)(?:\s+([A-Za-z0-9_-]+))?\]/i);
    if (!legacyOrderEndMatch) return null;
    return {
      tag: legacyOrderEndMatch[1] || '',
      orderTxid: '',
      reason: String(legacyOrderEndMatch[2] || '').trim(),
      rest: trimmed.slice(legacyOrderEndMatch[0].length).trim(),
    };
  }
  return {
    tag: String(match[1] || ''),
    orderTxid: normalizeOrderProtocolTxid(match[2]),
    reason: String(match[3] || '').trim(),
    rest: trimmed.slice(match[0].length).trim(),
  };
}

export function buildOrderStatusMessage(orderTxid: string, content: string): string {
  const text = String(content || '').trim();
  return `${buildOrderProtocolPrefix(ORDER_STATUS_TAG, orderTxid)}${text ? ` ${text}` : ''}`;
}

export function parseOrderStatusMessage(content: string): ParsedOrderStatusMessage | null {
  const parsed = parseOrderProtocolTag(content);
  if (!parsed || parsed.tag.toUpperCase() !== ORDER_STATUS_TAG) return null;
  return {
    ...(parsed.orderTxid ? { orderTxid: parsed.orderTxid } : {}),
    content: parsed.rest,
  };
}

export function buildNeedsRatingMessage(orderTxid: string, content: string): string {
  const text = String(content || '').trim();
  return `${buildOrderProtocolPrefix(NEEDS_RATING_TAG, orderTxid)}${text ? ` ${text}` : ''}`;
}

export function parseNeedsRatingMessage(content: string): ParsedNeedsRatingMessage | null {
  const parsed = parseOrderProtocolTag(content);
  if (!parsed || parsed.tag.toUpperCase() !== NEEDS_RATING_TAG.toUpperCase()) return null;
  return {
    ...(parsed.orderTxid ? { orderTxid: parsed.orderTxid } : {}),
    content: parsed.rest,
  };
}

export function buildOrderEndMessage(orderTxid: string, reason = '', content = ''): string {
  const normalizedTxid = normalizeOrderProtocolTxid(orderTxid);
  const normalizedReason = String(reason || '').trim().replace(/\s+/g, '_');
  const tagSuffix = [
    normalizedTxid ? `:${normalizedTxid}` : '',
    normalizedReason ? ` ${normalizedReason}` : '',
  ].join('');
  const text = String(content || '').trim();
  return `[${ORDER_END_TAG}${tagSuffix}]${text ? ` ${text}` : ''}`;
}

export function parseOrderEndMessage(content: string): ParsedOrderEndMessage | null {
  const parsed = parseOrderProtocolTag(content);
  if (!parsed || parsed.tag.toUpperCase() !== ORDER_END_TAG) return null;
  return {
    ...(parsed.orderTxid ? { orderTxid: parsed.orderTxid } : {}),
    reason: parsed.reason || '',
    content: parsed.rest,
  };
}

export function buildDeliveryMessage(payload: DeliveryMessagePayload, orderTxid?: string | null): string {
  return `${buildOrderProtocolPrefix(DELIVERY_TAG, orderTxid)} ${JSON.stringify(payload ?? {})}`;
}

export function parseDeliveryMessage(content: string): ParsedDeliveryMessage | null {
  const parsedTag = parseOrderProtocolTag(content);
  if (!parsedTag || parsedTag.tag.toUpperCase() !== DELIVERY_TAG) {
    return null;
  }

  const jsonText = parsedTag.rest;
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const payload = parsed as ParsedDeliveryMessage;
    if (parsedTag.orderTxid) {
      payload.orderTxid = parsedTag.orderTxid;
    }
    return payload;
  } catch {
    return null;
  }
}

export function parseOrderScopedProtocolMessage(content: string): ParsedOrderProtocolMessage | null {
  return parseOrderStatusMessage(content)
    || parseDeliveryMessage(content)
    || parseNeedsRatingMessage(content)
    || parseOrderEndMessage(content);
}
