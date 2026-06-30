const ORDER_STATUS_TAG = 'ORDER_STATUS';
const DELIVERY_TAG = 'DELIVERY';
const NEEDS_RATING_TAG = 'NeedsRating';
const ORDER_END_TAG = 'ORDER_END';
const ORDER_TXID_RE = /^[0-9a-f]{64}$/i;
const ORDER_TAG_RE = /^\[([A-Za-z_]+)(?::([0-9a-fA-F]{64})(?:\s+([A-Za-z0-9_-]+))?)?\]/;
const ORDER_PIN_LINE_RE = /^\s*order\s+pin\s+id\s*[:：=]\s*([/A-Za-z0-9][A-Za-z0-9._:/-]{5,127})\s*$/im;

export type OrderProtocolTag = 'ORDER_STATUS' | 'DELIVERY' | 'NeedsRating' | 'ORDER_END';

export interface DeliveryMessagePayload {
  paymentTxid?: string | null;
  servicePinId?: string | null;
  serviceName?: string | null;
  result?: string | null;
  artifacts?: unknown;
  deliveredAt?: number | null;
  orderTxid?: string;
  [key: string]: unknown;
}

export interface ParsedOrderStatusMessage {
  orderTxid?: string;
  orderPinId?: string;
  content: string;
}

export interface ParsedNeedsRatingMessage {
  orderTxid?: string;
  orderPinId?: string;
  content: string;
}

export interface ParsedOrderEndMessage {
  orderTxid?: string;
  orderPinId?: string;
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
  orderPinId: string;
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

function normalizeOrderProtocolPinId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveOrderPinIdArg(value: unknown): string {
  if (typeof value === 'string') return normalizeOrderProtocolPinId(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return normalizeOrderProtocolPinId(record.orderPinId)
      || normalizeOrderProtocolPinId(record.serviceOrderPinId);
  }
  return '';
}

function extractOrderProtocolPinId(content: string): string {
  const match = String(content || '').match(ORDER_PIN_LINE_RE);
  return typeof match?.[1] === 'string' ? match[1].trim() : '';
}

function stripOrderProtocolPinLine(content: string): string {
  return String(content || '')
    .split(/\r?\n/u)
    .filter((line) => !ORDER_PIN_LINE_RE.test(line))
    .join('\n')
    .trim();
}

function appendOrderProtocolPinLine(content: string, orderPinId?: unknown): string {
  const text = stripOrderProtocolPinLine(content);
  const normalizedOrderPinId = resolveOrderPinIdArg(orderPinId);
  if (!normalizedOrderPinId) return text;
  return [text, `order pin id: ${normalizedOrderPinId}`].filter(Boolean).join('\n');
}

function parseOrderProtocolTag(content: string): ParsedOrderProtocolTag | null {
  const trimmed = String(content || '').trim();
  const match = trimmed.match(ORDER_TAG_RE);
  if (!match) {
    const legacyOrderEndMatch = trimmed.match(/^\[(ORDER_END)(?:\s+([A-Za-z0-9_-]+))?\]/i);
    if (!legacyOrderEndMatch) return null;
    const rest = trimmed.slice(legacyOrderEndMatch[0].length).trim();
    return {
      tag: legacyOrderEndMatch[1] || '',
      orderTxid: '',
      orderPinId: extractOrderProtocolPinId(rest),
      reason: String(legacyOrderEndMatch[2] || '').trim(),
      rest: stripOrderProtocolPinLine(rest),
    };
  }
  const rest = trimmed.slice(match[0].length).trim();
  return {
    tag: String(match[1] || ''),
    orderTxid: normalizeOrderProtocolTxid(match[2]),
    orderPinId: extractOrderProtocolPinId(rest),
    reason: String(match[3] || '').trim(),
    rest: stripOrderProtocolPinLine(rest),
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
    ...(parsed.orderPinId ? { orderPinId: parsed.orderPinId } : {}),
    content: parsed.rest,
  };
}

export function buildNeedsRatingMessage(orderTxid: string, content: string, orderPinId?: unknown): string {
  const text = appendOrderProtocolPinLine(String(content || ''), orderPinId);
  return `${buildOrderProtocolPrefix(NEEDS_RATING_TAG, orderTxid)}${text ? ` ${text}` : ''}`;
}

export function parseNeedsRatingMessage(content: string): ParsedNeedsRatingMessage | null {
  const parsed = parseOrderProtocolTag(content);
  if (!parsed || parsed.tag.toUpperCase() !== NEEDS_RATING_TAG.toUpperCase()) return null;
  return {
    ...(parsed.orderTxid ? { orderTxid: parsed.orderTxid } : {}),
    ...(parsed.orderPinId ? { orderPinId: parsed.orderPinId } : {}),
    content: parsed.rest,
  };
}

export function buildOrderEndMessage(orderTxid: string, reason = '', content = '', orderPinId?: unknown): string {
  const normalizedTxid = normalizeOrderProtocolTxid(orderTxid);
  const normalizedReason = String(reason || '').trim().replace(/\s+/g, '_');
  const tagSuffix = [
    normalizedTxid ? `:${normalizedTxid}` : '',
    normalizedReason ? ` ${normalizedReason}` : '',
  ].join('');
  const text = appendOrderProtocolPinLine(String(content || ''), orderPinId);
  return `[${ORDER_END_TAG}${tagSuffix}]${text ? ` ${text}` : ''}`;
}

export function parseOrderEndMessage(content: string): ParsedOrderEndMessage | null {
  const parsed = parseOrderProtocolTag(content);
  if (!parsed || parsed.tag.toUpperCase() !== ORDER_END_TAG) return null;
  return {
    ...(parsed.orderTxid ? { orderTxid: parsed.orderTxid } : {}),
    ...(parsed.orderPinId ? { orderPinId: parsed.orderPinId } : {}),
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
