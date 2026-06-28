import {
  parseProductDeliveryMessage,
  parseProductOrderNotification,
} from '../products/productOrderMessages';

export type SimplemsgOrderProtocolTag =
  | 'ORDER'
  | 'ORDER_STATUS'
  | 'DELIVERY'
  | 'NeedsRating'
  | 'ORDER_END';

export interface SimplemsgProductMetadata {
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
  deliveredAt?: number;
}

export type SimplemsgClassification =
  | { kind: 'private_chat' }
  | {
      kind: 'order_protocol';
      tag: SimplemsgOrderProtocolTag;
      orderTxid: string | null;
      orderPinId: string | null;
      reason: string | null;
      orderKind?: 'product_order';
      product?: SimplemsgProductMetadata;
    };

const ORDER_TXID_RE = /^[0-9a-f]{64}$/i;
const TAG_RE = /^\[([A-Za-z_]+)(?::([0-9a-fA-F]{64})(?:\s+([A-Za-z0-9_-]+))?)?\]/;
const LEGACY_ORDER_END_RE = /^\[(ORDER_END)(?:\s+([A-Za-z0-9_-]+))?\]/i;
const ORDER_PIN_LINE_RE = /^\s*order\s+pin\s+id\s*[:：=]\s*([A-Za-z0-9][A-Za-z0-9._:-]{5,127})\s*$/im;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOrderTxid(value: unknown): string | null {
  const normalized = normalizeText(value).toLowerCase();
  return ORDER_TXID_RE.test(normalized) ? normalized : null;
}

function normalizeProtocolTag(value: unknown): SimplemsgOrderProtocolTag | null {
  const normalized = normalizeText(value);
  const upper = normalized.toUpperCase();
  if (upper === 'ORDER') return 'ORDER';
  if (upper === 'ORDER_STATUS') return 'ORDER_STATUS';
  if (upper === 'DELIVERY') return 'DELIVERY';
  if (upper === 'NEEDSRATING') return 'NeedsRating';
  if (upper === 'ORDER_END') return 'ORDER_END';
  return null;
}

function extractOrderPinId(value: unknown): string | null {
  const match = normalizeText(value).match(ORDER_PIN_LINE_RE);
  return normalizeText(match?.[1]) || null;
}

function readProductMetadata(
  tag: SimplemsgOrderProtocolTag,
  content: string,
): SimplemsgProductMetadata | null {
  if (tag === 'ORDER') {
    return parseProductOrderNotification(content);
  }
  if (tag === 'DELIVERY') {
    const delivery = parseProductDeliveryMessage(content);
    return delivery
      ? {
        productOrderPinId: delivery.productOrderPinId,
        listingPinId: delivery.listingPinId,
        skuId: delivery.skuId,
        paymentTxid: delivery.paymentTxid,
        deliveredAt: delivery.deliveredAt,
      }
      : null;
  }
  return null;
}

function classifyOrderProtocol(input: {
  tag: SimplemsgOrderProtocolTag;
  orderTxid: string | null;
  orderPinId: string | null;
  reason: string | null;
  content: string;
}): SimplemsgClassification {
  const product = readProductMetadata(input.tag, input.content);
  const base = {
    kind: 'order_protocol' as const,
    tag: input.tag,
    orderTxid: input.orderTxid,
    orderPinId: input.orderPinId,
    reason: input.reason,
  };
  return product
    ? {
      ...base,
      orderKind: 'product_order',
      product,
    }
    : base;
}

export function classifySimplemsgContent(content: unknown): SimplemsgClassification {
  const text = normalizeText(content);
  if (!text) {
    return { kind: 'private_chat' };
  }

  const match = text.match(TAG_RE);
  if (match) {
    const tag = normalizeProtocolTag(match[1]);
    if (!tag) {
      return { kind: 'private_chat' };
    }
    return classifyOrderProtocol({
      tag,
      orderTxid: normalizeOrderTxid(match[2]),
      orderPinId: extractOrderPinId(text),
      reason: tag === 'ORDER_END' ? normalizeText(match[3]) || null : null,
      content: text,
    });
  }

  const legacyOrderEndMatch = text.match(LEGACY_ORDER_END_RE);
  if (legacyOrderEndMatch) {
    return classifyOrderProtocol({
      tag: 'ORDER_END',
      orderTxid: null,
      orderPinId: extractOrderPinId(text),
      reason: normalizeText(legacyOrderEndMatch[2]) || null,
      content: text,
    });
  }

  return { kind: 'private_chat' };
}
