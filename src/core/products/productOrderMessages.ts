import {
  buildOrderRawRequestBlock,
  ORDER_PREFIX,
} from '../orders/orderMessage';

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

export function parseProductDeliveryMessage(value: unknown): ProductDeliveryMessage | null {
  const source = normalizeText(value);
  if (!source) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
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
