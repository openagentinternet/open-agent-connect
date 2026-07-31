export const SERVICE_ORDER_OPEN_ORDER_EXISTS_ERROR_CODE = 'open_order_exists';
export const SERVICE_ORDER_SELF_ORDER_NOT_ALLOWED_ERROR_CODE = 'self_order_not_allowed';
export const DEFAULT_REFUND_REQUEST_RETRY_DELAY_MS = 60_000;
export const SERVICE_ORDER_FREE_REFUND_SKIPPED_REASON = 'free_order_no_refund_required';
export const SERVICE_ORDER_SELF_REFUND_SKIPPED_REASON = 'self_directed_order_no_external_refund_required';
// How long a delivered seller order may wait for the buyer's rating before the
// seller closes it as a rating timeout (IDBots reference parity).
export const SERVICE_ORDER_RATING_TIMEOUT_MS = 15 * 60_000;
// Buyer-side per-stage order deadlines (IDBots computeOrderDeadlines parity):
// the provider must send any protocol message within 5 minutes and must deliver
// within 15 minutes of order creation. Both deadlines are fixed at creation;
// provider progress heartbeats do NOT extend the delivery deadline.
export const SERVICE_ORDER_FIRST_RESPONSE_TIMEOUT_MS = 5 * 60_000;
export const SERVICE_ORDER_DELIVERY_TIMEOUT_MS = 15 * 60_000;
// How often the daemon sweeps open buyer orders for deadline breaches
// (IDBots SERVICE_ORDER_TIMEOUT_SCAN_INTERVAL_MS parity).
export const SERVICE_ORDER_DEADLINE_SWEEP_INTERVAL_MS = 60_000;

export interface ServiceOrderDeadlines {
  firstResponseDeadlineAt: number;
  deliveryDeadlineAt: number;
}

export function computeServiceOrderDeadlines(now: number): ServiceOrderDeadlines {
  return {
    firstResponseDeadlineAt: now + SERVICE_ORDER_FIRST_RESPONSE_TIMEOUT_MS,
    deliveryDeadlineAt: now + SERVICE_ORDER_DELIVERY_TIMEOUT_MS,
  };
}

function normalizeDeadlineTimestamp(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

// Deadlines are persisted on the buyer order at creation. Orders created before
// the deadline model existed carry no stored values; for those, derive the same
// deadlines from the order creation timestamp so one uniform model applies.
export function resolveServiceOrderDeadlines(input: {
  firstResponseDeadlineAt?: unknown;
  deliveryDeadlineAt?: unknown;
  createdAt?: unknown;
}): ServiceOrderDeadlines {
  const fallback = computeServiceOrderDeadlines(
    normalizeDeadlineTimestamp(input.createdAt) ?? Date.now(),
  );
  return {
    firstResponseDeadlineAt: normalizeDeadlineTimestamp(input.firstResponseDeadlineAt)
      ?? fallback.firstResponseDeadlineAt,
    deliveryDeadlineAt: normalizeDeadlineTimestamp(input.deliveryDeadlineAt)
      ?? fallback.deliveryDeadlineAt,
  };
}

// IDBots getTimedOutOrderTransition parity: without a first response only the
// first-response deadline binds; once any provider protocol message arrived,
// only the (fixed) delivery deadline binds.
export function getServiceOrderDeadlineTimeout(
  input: ServiceOrderDeadlines & { firstResponseReceivedAt?: unknown },
  now: number,
): 'first_response_timeout' | 'delivery_timeout' | null {
  if (normalizeDeadlineTimestamp(input.firstResponseReceivedAt) === null) {
    return now > input.firstResponseDeadlineAt ? 'first_response_timeout' : null;
  }
  return now > input.deliveryDeadlineAt ? 'delivery_timeout' : null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildBuyerPaymentKey(
  localMetabotId: number,
  counterpartyGlobalMetaId: string,
  paymentTxid?: string | null,
): string | null {
  const normalizedTxid = normalizeText(paymentTxid);
  if (!normalizedTxid) return null;
  return `${localMetabotId}:${normalizeText(counterpartyGlobalMetaId)}:${normalizedTxid}`;
}

export function isSelfDirectedPair(input: {
  localGlobalMetaId?: string | null;
  counterpartyGlobalMetaId?: string | null;
}): boolean {
  const local = normalizeText(input.localGlobalMetaId);
  const counterparty = normalizeText(input.counterpartyGlobalMetaId);
  return Boolean(local && counterparty && local === counterparty);
}
