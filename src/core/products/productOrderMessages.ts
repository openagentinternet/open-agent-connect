import {
  buildOrderRawRequestBlock,
  extractOrderRawRequest,
  ORDER_PREFIX,
} from '../orders/orderMessage';
import { parseDeliveryMessage } from '../a2a/protocol/orderProtocol';

export interface BuildProductOrderNotificationInput {
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
  comment?: string | null;
}

export interface ProductDeliveryMessage {
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
  result: string;
  deliveredAt: number;
}

export interface ProductOrderNotificationMessage {
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRequiredText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function normalizeFiniteTimestamp(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.trunc(numeric);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractOrderLineValue(content: string, label: string): string {
  const match = content.match(new RegExp(`^\\s*${escapeRegex(label)}\\s*:\\s*(.+?)\\s*$`, 'imu'));
  return normalizeText(match?.[1]);
}

export function buildProductOrderNotification(input: BuildProductOrderNotificationInput): string {
  const rawRequest: Record<string, string> = {
    protocol: 'product-order',
    productOrderPinId: normalizeRequiredText(input.productOrderPinId, 'productOrderPinId'),
    listingPinId: normalizeRequiredText(input.listingPinId, 'listingPinId'),
    skuId: normalizeRequiredText(input.skuId, 'skuId'),
    paymentTxid: normalizeRequiredText(input.paymentTxid, 'paymentTxid'),
  };
  const comment = normalizeText(input.comment);
  if (comment) {
    rawRequest.comment = comment;
  }

  return [
    `${ORDER_PREFIX} [PRODUCT_ORDER] ${rawRequest.skuId} for listing ${rawRequest.listingPinId}`,
    buildOrderRawRequestBlock(JSON.stringify(rawRequest)),
    `product-order pin id: ${rawRequest.productOrderPinId}`,
    `listing pin id: ${rawRequest.listingPinId}`,
    `sku id: ${rawRequest.skuId}`,
    `payment txid: ${rawRequest.paymentTxid}`,
  ].join('\n');
}

export function parseProductOrderNotification(value: unknown): ProductOrderNotificationMessage | null {
  const source = normalizeText(value);
  if (!source) {
    return null;
  }

  const rawRequest = extractOrderRawRequest(source);
  const parsed = rawRequest ? parseJsonObject(rawRequest) : null;
  const hasProductMarker = /\[PRODUCT_ORDER\]/iu.test(source);
  if (!parsed && !hasProductMarker) {
    return null;
  }
  if (parsed && normalizeText(parsed.protocol) !== 'product-order') {
    return null;
  }

  const productOrderPinId = normalizeText(parsed?.productOrderPinId)
    || extractOrderLineValue(source, 'product-order pin id')
    || extractOrderLineValue(source, 'productOrderPinId');
  const listingPinId = normalizeText(parsed?.listingPinId)
    || extractOrderLineValue(source, 'listing pin id')
    || extractOrderLineValue(source, 'listingPinId');
  const skuId = normalizeText(parsed?.skuId)
    || extractOrderLineValue(source, 'sku id')
    || extractOrderLineValue(source, 'skuId');
  const paymentTxid = normalizeText(parsed?.paymentTxid)
    || extractOrderLineValue(source, 'payment txid')
    || extractOrderLineValue(source, 'paymentTxid');
  if (!productOrderPinId || !listingPinId || !skuId || !paymentTxid) {
    return null;
  }

  return {
    productOrderPinId,
    listingPinId,
    skuId,
    paymentTxid,
  };
}

export function parseProductDeliveryMessage(value: unknown): ProductDeliveryMessage | null {
  const source = normalizeText(value);
  if (!source) {
    return null;
  }

  const parsed = parseDeliveryMessage(source) ?? parseJsonObject(source);
  if (!parsed) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const productOrderPinId = normalizeText(record.productOrderPinId);
  const listingPinId = normalizeText(record.listingPinId);
  const skuId = normalizeText(record.skuId);
  const paymentTxid = normalizeText(record.paymentTxid);
  const result = normalizeText(record.result);
  const deliveredAt = normalizeFiniteTimestamp(record.deliveredAt);
  if (!productOrderPinId || !listingPinId || !skuId || !paymentTxid || !result || deliveredAt === null) {
    return null;
  }

  return {
    productOrderPinId,
    listingPinId,
    skuId,
    paymentTxid,
    result,
    deliveredAt,
  };
}
