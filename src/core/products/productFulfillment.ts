import type { ChainAdapterRegistry } from '../chain/adapters/types';
import {
  buildDeliveryMessage,
  buildNeedsRatingMessage,
} from '../a2a/protocol/orderProtocol';
import {
  verifyServiceOrderPayment,
  type VerifiedServiceOrderPayment,
} from '../payments/servicePaymentVerification';
import {
  PRODUCT_LISTING_PROTOCOL_PATH,
  PRODUCT_ORDER_PROTOCOL_PATH,
} from './productPublishChain';
import type {
  OwnedProductListingRecord,
  ProductDirectoryCacheRecord,
  ProductSellerOrderRecord,
  ProductStateStore,
} from './productStateStore';
import type {
  ProductListingPayload,
  ProductOrderPayload,
  ProductSku,
} from './productTypes';
import {
  validateProductListingPayload,
  validateProductOrderPayload,
} from './productValidation';

export type ProductFulfillmentFailureCode =
  | 'product_order_not_found'
  | 'invalid_product_order_protocol'
  | 'product_listing_not_found'
  | 'invalid_product_listing_protocol'
  | 'product_listing_not_owned'
  | 'product_sku_not_found'
  | 'product_buyer_mismatch'
  | 'product_unsupported_fulfillment'
  | 'product_payment_invalid'
  | 'product_fulfillment_failed';

export interface ProductFulfillmentFailure {
  ok: false;
  code: ProductFulfillmentFailureCode;
  message: string;
  data?: Record<string, unknown>;
}

export interface ProductSellerIdentity {
  globalMetaId?: string | null;
  name?: string | null;
  mvcAddress?: string | null;
  addresses?: {
    mvc?: string | null;
    btc?: string | null;
  } | null;
  chatPublicKey?: string | null;
}

export interface ProductFulfillmentBuyerIdentity {
  globalMetaId?: string | null;
  name?: string | null;
  chatPublicKey?: string | null;
}

export interface ProductOrderA2AMetadata {
  messagePinId?: string | null;
  timestamp?: number | null;
  sessionId?: string | null;
  traceId?: string | null;
  rawContent?: string | null;
}

export interface ProductChainPin {
  pinId?: string | null;
  id?: string | null;
  pinID?: string | null;
  path?: string | null;
  content?: unknown;
  contentSummary?: unknown;
  payload?: unknown;
  globalMetaId?: string | null;
  creatorGlobalMetaId?: string | null;
  createGlobalMetaId?: string | null;
  createMetaId?: string | null;
  createAddress?: string | null;
  creatorAddress?: string | null;
  mvcAddress?: string | null;
  timestamp?: number | string | null;
  updatedAt?: number | string | null;
}

export interface ProductFulfillmentChainFetcher {
  fetchProductOrderPin(productOrderPinId: string): Promise<ProductChainPin | null>;
  fetchProductListingPin(listingPinId: string): Promise<ProductChainPin | null>;
}

type ResolveSellerProductStateStore = Pick<ProductStateStore,
  | 'findSellerOrderByProductOrderPinId'
  | 'findListingByPinId'
  | 'upsertSellerOrder'
  | 'upsertOwnedListing'
  | 'upsertDirectoryItem'
>;

type FulfillSellerProductStateStore = ResolveSellerProductStateStore & Pick<ProductStateStore,
  | 'claimSellerOrderFulfillment'
>;

export interface ResolveSellerProductOrderInput {
  productOrderPinId: string;
  orderTxid?: string | null;
  buyer?: ProductFulfillmentBuyerIdentity | null;
  localSeller: ProductSellerIdentity;
  productStateStore: ResolveSellerProductStateStore;
  chainFetcher: ProductFulfillmentChainFetcher;
  now?: () => number;
}

export interface ResolvedProductOrderReference {
  source: 'cache' | 'chain';
  pinId: string;
  pin: ProductFulfillmentPinMetadata;
  payload: ProductOrderPayload;
  buyerGlobalMetaId: string | null;
  orderTxid: string | null;
  record: ProductSellerOrderRecord | null;
}

export interface ResolvedProductListingReference {
  source: 'cache' | 'chain';
  pinId: string;
  pin: ProductFulfillmentPinMetadata;
  payload: ProductListingPayload;
  sellerGlobalMetaId: string | null;
  sellerMvcAddress: string | null;
  record: OwnedProductListingRecord | ProductDirectoryCacheRecord | null;
}

export interface ResolvedSellerProductOrder {
  ok: true;
  order: ResolvedProductOrderReference;
  listing: ResolvedProductListingReference;
  selectedSku: ProductSku;
}

export type ResolveSellerProductOrderResult =
  | ResolvedSellerProductOrder
  | ProductFulfillmentFailure;

export interface ProductPaymentVerifierInput {
  paymentTxid: string;
  paymentChain: 'mvc' | 'btc';
  settlementKind: 'native';
  paymentAddress: string;
  amount: string;
  currency: string;
}

export type ProductPaymentVerifier = (
  input: ProductPaymentVerifierInput
) => Promise<VerifiedServiceOrderPayment> | VerifiedServiceOrderPayment;

export interface ProductFulfillmentRuntimeContext {
  productOrder: {
    pinId: string;
    pin: ProductFulfillmentPinMetadata;
    payload: ProductOrderPayload;
    metadata: {
      buyerGlobalMetaId: string | null;
      orderTxid: string | null;
      source: 'cache' | 'chain';
    };
  };
  productListing: {
    pinId: string;
    pin: ProductFulfillmentPinMetadata;
    payload: ProductListingPayload;
    metadata: {
      sellerGlobalMetaId: string | null;
      sellerMvcAddress: string | null;
      source: 'cache' | 'chain';
    };
  };
  selectedSku: ProductSku;
  buyer: ProductFulfillmentBuyerIdentity;
  orderA2AMetadata: ProductOrderA2AMetadata;
  payment: VerifiedServiceOrderPayment;
  fulfillmentSkills: string[];
}

export interface ProductFulfillmentRoundInput {
  fulfillmentSkills: string[];
  context: ProductFulfillmentRuntimeContext;
}

export type ProductFulfillmentRoundResult =
  | {
      state: 'completed';
      responseText: string;
      metadata?: Record<string, unknown> | null;
    }
  | {
      state: 'failed';
      code: string;
      message: string;
      metadata?: Record<string, unknown> | null;
    }
  | {
      state: 'needs_clarification';
      question: string;
      metadata?: Record<string, unknown> | null;
    };

export interface ProductFulfillmentRunner {
  execute(input: ProductFulfillmentRoundInput): Promise<ProductFulfillmentRoundResult> | ProductFulfillmentRoundResult;
}

export interface ProductDeliverySendInput {
  toGlobalMetaId: string;
  orderTxid: string;
  productOrderPinId: string;
  content: string;
}

export interface ProductDeliverySendResult {
  pinId?: string | null;
  txids?: string[] | null;
}

export interface ProductDeliverySender {
  send(input: ProductDeliverySendInput): Promise<ProductDeliverySendResult> | ProductDeliverySendResult;
}

export interface FulfillProductOrderForSellerInput extends ResolveSellerProductOrderInput {
  productStateStore: FulfillSellerProductStateStore;
  orderTxid: string;
  buyer: ProductFulfillmentBuyerIdentity;
  orderA2AMetadata?: ProductOrderA2AMetadata | null;
  paymentVerifier: ProductPaymentVerifier;
  fulfillmentRunner: ProductFulfillmentRunner | ((input: ProductFulfillmentRoundInput) => Promise<ProductFulfillmentRoundResult> | ProductFulfillmentRoundResult);
  deliverySender: ProductDeliverySender;
  requestRating?: boolean;
}

export interface FulfillProductOrderForSellerSuccess {
  ok: true;
  data: {
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    paymentTxid: string;
    orderTxid: string;
    result: string;
    deliveryPinId: string | null;
    ratingMessagePinId: string | null;
  };
}

export type FulfillProductOrderForSellerResult =
  | FulfillProductOrderForSellerSuccess
  | ProductFulfillmentFailure;

export interface ProductFulfillmentPinMetadata {
  pinId: string;
  path: string;
  creatorGlobalMetaId: string | null;
  creatorAddress: string | null;
  timestamp: number | null;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeOrderTxid(value: unknown): string | null {
  const normalized = normalizeText(value).toLowerCase();
  return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : null;
}

function normalizeNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function now(input?: { now?: () => number }): number {
  return input?.now ? input.now() : Date.now();
}

function failure(
  code: ProductFulfillmentFailureCode,
  message: string,
  data?: Record<string, unknown>,
): ProductFulfillmentFailure {
  return {
    ok: false,
    code,
    message,
    ...(data ? { data } : {}),
  };
}

function readPinId(pin: ProductChainPin, fallback = ''): string {
  return normalizeText(pin.pinId ?? pin.id ?? pin.pinID) || fallback;
}

function readPinCreatorGlobalMetaId(pin: ProductChainPin): string | null {
  return normalizeNullableText(
    pin.creatorGlobalMetaId
      ?? pin.createGlobalMetaId
      ?? pin.globalMetaId
      ?? pin.createMetaId,
  );
}

function readPinCreatorAddress(pin: ProductChainPin): string | null {
  return normalizeNullableText(pin.createAddress ?? pin.creatorAddress ?? pin.mvcAddress);
}

function readPinTimestamp(pin: ProductChainPin): number | null {
  return normalizeNullableNumber(pin.timestamp ?? pin.updatedAt);
}

function pinMetadata(input: {
  pinId: string;
  path: string;
  creatorGlobalMetaId?: string | null;
  creatorAddress?: string | null;
  timestamp?: number | null;
}): ProductFulfillmentPinMetadata {
  return {
    pinId: input.pinId,
    path: input.path,
    creatorGlobalMetaId: normalizeNullableText(input.creatorGlobalMetaId),
    creatorAddress: normalizeNullableText(input.creatorAddress),
    timestamp: input.timestamp ?? null,
  };
}

function chainPinMetadata(pin: ProductChainPin, pinId: string, path: string): ProductFulfillmentPinMetadata {
  return pinMetadata({
    pinId,
    path,
    creatorGlobalMetaId: readPinCreatorGlobalMetaId(pin),
    creatorAddress: readPinCreatorAddress(pin),
    timestamp: readPinTimestamp(pin),
  });
}

function parseContentPayload(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function readChainPayload(pin: ProductChainPin): unknown {
  if (pin.payload !== undefined) return parseContentPayload(pin.payload);
  if (pin.contentSummary !== undefined) return parseContentPayload(pin.contentSummary);
  return parseContentPayload(pin.content);
}

function validateOrderPin(
  pin: ProductChainPin | null,
  productOrderPinId: string,
): { ok: true; pinId: string; pin: ProductFulfillmentPinMetadata; payload: ProductOrderPayload; buyerGlobalMetaId: string | null } | ProductFulfillmentFailure {
  if (!pin) {
    return failure('product_order_not_found', `Product-order pin was not found: ${productOrderPinId}`);
  }
  if (normalizeText(pin.path) !== PRODUCT_ORDER_PROTOCOL_PATH) {
    return failure('invalid_product_order_protocol', 'Product-order pin did not use the product-order protocol path.');
  }
  const validation = validateProductOrderPayload(readChainPayload(pin));
  if (!validation.ok) {
    return failure('invalid_product_order_protocol', validation.message, { validationCode: validation.code });
  }
  const pinId = readPinId(pin, productOrderPinId);
  return {
    ok: true,
    pinId,
    pin: chainPinMetadata(pin, pinId, PRODUCT_ORDER_PROTOCOL_PATH),
    payload: validation.value,
    buyerGlobalMetaId: readPinCreatorGlobalMetaId(pin),
  };
}

function validateListingPin(
  pin: ProductChainPin | null,
  listingPinId: string,
): { ok: true; pinId: string; pin: ProductFulfillmentPinMetadata; payload: ProductListingPayload; sellerGlobalMetaId: string | null; sellerMvcAddress: string | null } | ProductFulfillmentFailure {
  if (!pin) {
    return failure('product_listing_not_found', `Product listing pin was not found: ${listingPinId}`);
  }
  if (normalizeText(pin.path) !== PRODUCT_LISTING_PROTOCOL_PATH) {
    return failure('invalid_product_listing_protocol', 'Product listing pin did not use the product-listing protocol path.');
  }
  const validation = validateProductListingPayload(readChainPayload(pin));
  if (!validation.ok) {
    return failure('invalid_product_listing_protocol', validation.message, { validationCode: validation.code });
  }
  const pinId = readPinId(pin, listingPinId);
  return {
    ok: true,
    pinId,
    pin: chainPinMetadata(pin, pinId, PRODUCT_LISTING_PROTOCOL_PATH),
    payload: validation.value,
    sellerGlobalMetaId: readPinCreatorGlobalMetaId(pin),
    sellerMvcAddress: readPinCreatorAddress(pin),
  };
}

function readCachedOrderPayload(record: ProductSellerOrderRecord): ProductOrderPayload {
  const cachedPayload = (record as ProductSellerOrderRecord & { productOrderPayload?: unknown }).productOrderPayload;
  const validation = validateProductOrderPayload(cachedPayload);
  if (validation.ok) {
    return validation.value;
  }
  const payload: ProductOrderPayload = {
    listingPinId: record.listingPinId,
    skuId: record.skuId,
    settlementKind: 'native',
    paymentTxid: record.paymentTxid,
  };
  return validateProductOrderPayload(payload).ok ? payload : payload;
}

function readCachedListing(input: {
  lookup: Awaited<ReturnType<ProductStateStore['findListingByPinId']>>;
}): ResolvedProductListingReference | null {
  const lookup = input.lookup;
  if (!lookup) return null;
  const payload = lookup.item.payload;
  const sellerGlobalMetaId = lookup.source === 'directoryCache'
    ? lookup.item.sellerGlobalMetaId
    : null;
  const sellerMvcAddress = lookup.source === 'directoryCache'
    ? lookup.item.sellerMvcAddress
    : null;
  return {
    source: 'cache',
    pinId: lookup.item.listingPinId,
    pin: pinMetadata({
      pinId: lookup.item.listingPinId,
      path: PRODUCT_LISTING_PROTOCOL_PATH,
      creatorGlobalMetaId: sellerGlobalMetaId,
      creatorAddress: sellerMvcAddress,
    }),
    payload,
    sellerGlobalMetaId,
    sellerMvcAddress,
    record: lookup.item,
  };
}

function sellerOwnsListing(input: {
  listing: ResolvedProductListingReference;
  localSeller: ProductSellerIdentity;
}): boolean {
  if (input.listing.record && 'localMetabotSlug' in input.listing.record) {
    return true;
  }
  const localGlobalMetaId = normalizeText(input.localSeller.globalMetaId);
  const listingGlobalMetaId = normalizeText(input.listing.sellerGlobalMetaId);
  if (localGlobalMetaId && listingGlobalMetaId) {
    return localGlobalMetaId === listingGlobalMetaId;
  }
  const localMvcAddress = normalizeText(input.localSeller.addresses?.mvc) || normalizeText(input.localSeller.mvcAddress);
  const listingMvcAddress = normalizeText(input.listing.sellerMvcAddress);
  return Boolean(localMvcAddress && listingMvcAddress && localMvcAddress === listingMvcAddress);
}

function resolvePaymentChain(currency: string): 'mvc' | 'btc' {
  return normalizeText(currency).toUpperCase() === 'BTC' ? 'btc' : 'mvc';
}

function resolveSellerPaymentAddress(input: {
  seller: ProductSellerIdentity;
  paymentChain: 'mvc' | 'btc';
}): string {
  if (input.paymentChain === 'btc') {
    return normalizeText(input.seller.addresses?.btc);
  }
  return normalizeText(input.seller.addresses?.mvc) || normalizeText(input.seller.mvcAddress);
}

function isSupportedV1Fulfillment(payload: ProductListingPayload): boolean {
  return payload.productType === 'virtual' &&
    payload.fulfillment.fulfillmentType === 'digital_delivery' &&
    payload.fulfillment.deliveryEndpoint === 'simplemsg';
}

function sellerOrderSuccessFromRecord(input: {
  record: ProductSellerOrderRecord;
  resolved: ResolvedSellerProductOrder;
  orderTxid: string;
}): FulfillProductOrderForSellerSuccess {
  const deliveryPinId = normalizeNullableText(
    input.record.deliverySummary?.deliveryPinId ?? input.record.deliveryPinId,
  );
  return {
    ok: true,
    data: {
      productOrderPinId: input.resolved.order.pinId,
      listingPinId: input.resolved.order.payload.listingPinId,
      skuId: input.resolved.order.payload.skuId,
      paymentTxid: input.resolved.order.payload.paymentTxid,
      orderTxid: normalizeNullableText(input.record.orderTxid) || input.orderTxid,
      result: normalizeText(input.record.deliverySummary?.result),
      deliveryPinId,
      ratingMessagePinId: null,
    },
  };
}

async function waitForSellerOrderTerminal(input: {
  store: ResolveSellerProductOrderInput['productStateStore'];
  productOrderPinId: string;
  paymentTxid: string;
  resolved: ResolvedSellerProductOrder;
}): Promise<FulfillProductOrderForSellerResult> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise(resolve => {
      setTimeout(resolve, Math.min(10 + attempt, 50));
    });
    const lookup = await input.store.findSellerOrderByProductOrderPinId(input.productOrderPinId);
    const record = lookup?.item;
    if (!record || record.paymentTxid !== input.paymentTxid) {
      continue;
    }
    if (record.state === 'delivered' && (record.deliveryPinId || record.deliverySummary?.deliveryPinId)) {
      return sellerOrderSuccessFromRecord({
        record,
        resolved: input.resolved,
        orderTxid: record.orderTxid || '',
      });
    }
    if (record.state === 'failed') {
      return failure(
        normalizeNullableText(record.failureReason) === 'product_payment_invalid'
          ? 'product_payment_invalid'
          : 'product_fulfillment_failed',
        record.failureReason || 'Product fulfillment failed.',
      );
    }
  }
  return failure('product_fulfillment_failed', 'Timed out waiting for duplicate product fulfillment to finish.');
}

function runnerExecute(
  runner: FulfillProductOrderForSellerInput['fulfillmentRunner'],
  input: ProductFulfillmentRoundInput,
): Promise<ProductFulfillmentRoundResult> | ProductFulfillmentRoundResult {
  return typeof runner === 'function' ? runner(input) : runner.execute(input);
}

async function persistSellerOrder(input: {
  store: ResolveSellerProductOrderInput['productStateStore'];
  resolved: ResolvedSellerProductOrder;
  buyerGlobalMetaId: string | null;
  orderTxid: string | null;
  fulfillmentSkills: string[];
  paymentVerified: boolean | null;
  fulfillmentState: ProductSellerOrderRecord['fulfillmentState'];
  deliveryPinId?: string | null;
  deliverySummary?: ProductSellerOrderRecord['deliverySummary'];
  failureReason?: string | null;
  state: ProductSellerOrderRecord['state'];
  now: number;
}): Promise<void> {
  await input.store.upsertSellerOrder({
    productOrderPinId: input.resolved.order.pinId,
    listingPinId: input.resolved.order.payload.listingPinId,
    skuId: input.resolved.order.payload.skuId,
    paymentTxid: input.resolved.order.payload.paymentTxid,
    orderTxid: input.orderTxid,
    buyerGlobalMetaId: input.buyerGlobalMetaId,
    fulfillmentSkills: input.fulfillmentSkills,
    paymentVerified: input.paymentVerified,
    selectedSku: input.resolved.selectedSku,
    fulfillmentState: input.fulfillmentState,
    deliveryPinId: input.deliveryPinId ?? null,
    deliverySummary: input.deliverySummary ?? null,
    failureReason: input.failureReason ?? null,
    state: input.state,
    localUpdatedAt: input.now,
    productOrderPayload: input.resolved.order.payload,
  } as Parameters<typeof input.store.upsertSellerOrder>[0]);
}

export function createProductServicePaymentVerifier(input: {
  adapters: ChainAdapterRegistry;
}): ProductPaymentVerifier {
  return (paymentInput) => verifyServiceOrderPayment({
    adapters: input.adapters,
    paymentTxid: paymentInput.paymentTxid,
    paymentChain: paymentInput.paymentChain,
    settlementKind: paymentInput.settlementKind,
    paymentAddress: paymentInput.paymentAddress,
    amount: paymentInput.amount,
    currency: paymentInput.currency,
  });
}

export async function resolveProductOrderForSeller(
  input: ResolveSellerProductOrderInput,
): Promise<ResolveSellerProductOrderResult> {
  const productOrderPinId = normalizeText(input.productOrderPinId);
  const orderTxid = normalizeNullableText(input.orderTxid);
  const buyerGlobalMetaId = normalizeNullableText(input.buyer?.globalMetaId);
  const cachedOrderLookup = await input.productStateStore.findSellerOrderByProductOrderPinId(productOrderPinId);
  let order: ResolvedProductOrderReference;

  if (cachedOrderLookup?.source === 'sellerOrders') {
    order = {
      source: 'cache',
      pinId: cachedOrderLookup.item.productOrderPinId,
      pin: pinMetadata({
        pinId: cachedOrderLookup.item.productOrderPinId,
        path: PRODUCT_ORDER_PROTOCOL_PATH,
        creatorGlobalMetaId: normalizeNullableText(cachedOrderLookup.item.buyerGlobalMetaId) || buyerGlobalMetaId,
      }),
      payload: readCachedOrderPayload(cachedOrderLookup.item),
      buyerGlobalMetaId: normalizeNullableText(cachedOrderLookup.item.buyerGlobalMetaId) || buyerGlobalMetaId,
      orderTxid: normalizeNullableText(cachedOrderLookup.item.orderTxid) || orderTxid,
      record: cachedOrderLookup.item,
    };
  } else {
    const chainOrder = validateOrderPin(
      await input.chainFetcher.fetchProductOrderPin(productOrderPinId),
      productOrderPinId,
    );
    if (!chainOrder.ok) {
      return chainOrder;
    }
    order = {
      source: 'chain',
      pinId: chainOrder.pinId,
      pin: chainOrder.pin,
      payload: chainOrder.payload,
      buyerGlobalMetaId: chainOrder.buyerGlobalMetaId || buyerGlobalMetaId,
      orderTxid,
      record: await input.productStateStore.upsertSellerOrder({
        productOrderPinId: chainOrder.pinId,
        listingPinId: chainOrder.payload.listingPinId,
        skuId: chainOrder.payload.skuId,
        paymentTxid: chainOrder.payload.paymentTxid,
        orderTxid,
        buyerGlobalMetaId: chainOrder.buyerGlobalMetaId || buyerGlobalMetaId,
        state: 'created',
        fulfillmentState: 'created',
        paymentVerified: null,
        fulfillmentSkills: [],
        productOrderPayload: chainOrder.payload,
        localUpdatedAt: now(input),
      } as Parameters<typeof input.productStateStore.upsertSellerOrder>[0]),
    };
  }

  let listing = readCachedListing({
    lookup: await input.productStateStore.findListingByPinId(order.payload.listingPinId),
  });
  if (!listing) {
    const chainListing = validateListingPin(
      await input.chainFetcher.fetchProductListingPin(order.payload.listingPinId),
      order.payload.listingPinId,
    );
    if (!chainListing.ok) {
      return chainListing;
    }
    listing = {
      source: 'chain',
      pinId: chainListing.pinId,
      pin: chainListing.pin,
      payload: chainListing.payload,
      sellerGlobalMetaId: chainListing.sellerGlobalMetaId,
      sellerMvcAddress: chainListing.sellerMvcAddress,
      record: null,
    };
    if (sellerOwnsListing({ listing, localSeller: input.localSeller })) {
      await input.productStateStore.upsertOwnedListing({
        listingPinId: chainListing.pinId,
        payload: chainListing.payload,
        available: true,
        localUpdatedAt: now(input),
      });
    } else {
      await input.productStateStore.upsertDirectoryItem({
        listingPinId: chainListing.pinId,
        payload: chainListing.payload,
        sellerGlobalMetaId: chainListing.sellerGlobalMetaId,
        sellerMvcAddress: chainListing.sellerMvcAddress,
        online: false,
        cachedAt: now(input),
      });
    }
  }

  if (!sellerOwnsListing({ listing, localSeller: input.localSeller })) {
    return failure('product_listing_not_owned', 'Referenced product listing does not belong to the local seller bot.');
  }

  const selectedSku = listing.payload.skus.find((sku) => sku.skuId === order.payload.skuId);
  if (!selectedSku) {
    return failure('product_sku_not_found', `Product SKU was not found in the referenced listing: ${order.payload.skuId}`);
  }

  return {
    ok: true,
    order,
    listing,
    selectedSku,
  };
}

export async function fulfillProductOrderForSeller(
  input: FulfillProductOrderForSellerInput,
): Promise<FulfillProductOrderForSellerResult> {
  const orderTxid = normalizeOrderTxid(input.orderTxid);
  if (!orderTxid) {
    return failure('invalid_product_order_protocol', 'Product fulfillment requires a normalized 64-hex order txid before delivery.');
  }

  const resolved = await resolveProductOrderForSeller(input);
  if (!resolved.ok) {
    return resolved;
  }

  const fulfillmentSkills = [...resolved.listing.payload.fulfillment.fulfillmentSkills];
  const inboundBuyerGlobalMetaId = normalizeNullableText(input.buyer.globalMetaId);
  const resolvedBuyerGlobalMetaId = normalizeNullableText(resolved.order.buyerGlobalMetaId);
  if (
    inboundBuyerGlobalMetaId &&
    resolvedBuyerGlobalMetaId &&
    inboundBuyerGlobalMetaId !== resolvedBuyerGlobalMetaId
  ) {
    return failure('product_buyer_mismatch', 'Inbound product-order buyer does not match the product-order pin creator.');
  }

  if (!isSupportedV1Fulfillment(resolved.listing.payload)) {
    return failure('product_unsupported_fulfillment', 'Product V1 seller fulfillment only supports virtual digital_delivery over simplemsg.');
  }

  const claim = await input.productStateStore.claimSellerOrderFulfillment({
    productOrderPinId: resolved.order.pinId,
    listingPinId: resolved.order.payload.listingPinId,
    skuId: resolved.order.payload.skuId,
    paymentTxid: resolved.order.payload.paymentTxid,
    productOrderPayload: resolved.order.payload,
    orderTxid,
    buyerGlobalMetaId: inboundBuyerGlobalMetaId || resolvedBuyerGlobalMetaId,
    fulfillmentSkills,
    selectedSku: resolved.selectedSku,
    localUpdatedAt: now(input),
  });
  if (claim.status === 'duplicate_delivered') {
    return sellerOrderSuccessFromRecord({
      record: claim.record,
      resolved,
      orderTxid,
    });
  }
  if (claim.status === 'in_progress') {
    return waitForSellerOrderTerminal({
      store: input.productStateStore,
      productOrderPinId: resolved.order.pinId,
      paymentTxid: resolved.order.payload.paymentTxid,
      resolved,
    });
  }

  const paymentChain = resolvePaymentChain(resolved.selectedSku.price.currency);
  const paymentAddress = resolveSellerPaymentAddress({
    seller: input.localSeller,
    paymentChain,
  });
  const paymentVerification = await input.paymentVerifier({
    paymentTxid: resolved.order.payload.paymentTxid,
    paymentChain,
    settlementKind: resolved.order.payload.settlementKind ?? 'native',
    paymentAddress,
    amount: resolved.selectedSku.price.amount,
    currency: resolved.selectedSku.price.currency,
  });
  if (!paymentVerification.verified) {
    await persistSellerOrder({
      store: input.productStateStore,
      resolved,
      buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
      orderTxid,
      fulfillmentSkills,
      paymentVerified: false,
      fulfillmentState: 'failed',
      failureReason: 'product_payment_invalid',
      state: 'failed',
      now: now(input),
    });
    return failure('product_payment_invalid', 'Product payment could not be verified against the seller address and SKU price.', {
      failureKind: paymentVerification.failureKind ?? null,
    });
  }

  await persistSellerOrder({
    store: input.productStateStore,
    resolved,
    buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
    orderTxid,
    fulfillmentSkills,
    paymentVerified: true,
    fulfillmentState: 'fulfilling',
    state: 'fulfilling',
    now: now(input),
  });

  const context: ProductFulfillmentRuntimeContext = {
    productOrder: {
      pinId: resolved.order.pinId,
      pin: resolved.order.pin,
      payload: resolved.order.payload,
      metadata: {
        buyerGlobalMetaId: resolved.order.buyerGlobalMetaId,
        orderTxid,
        source: resolved.order.source,
      },
    },
    productListing: {
      pinId: resolved.listing.pinId,
      pin: resolved.listing.pin,
      payload: resolved.listing.payload,
      metadata: {
        sellerGlobalMetaId: resolved.listing.sellerGlobalMetaId || normalizeNullableText(input.localSeller.globalMetaId),
        sellerMvcAddress: resolved.listing.sellerMvcAddress || normalizeNullableText(input.localSeller.mvcAddress),
        source: resolved.listing.source,
      },
    },
    selectedSku: resolved.selectedSku,
    buyer: input.buyer,
    orderA2AMetadata: input.orderA2AMetadata ?? {},
    payment: paymentVerification,
    fulfillmentSkills,
  };

  let runnerResult: ProductFulfillmentRoundResult;
  try {
    runnerResult = await runnerExecute(input.fulfillmentRunner, {
      fulfillmentSkills,
      context,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistSellerOrder({
      store: input.productStateStore,
      resolved,
      buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
      orderTxid,
      fulfillmentSkills,
      paymentVerified: true,
      fulfillmentState: 'failed',
      failureReason: 'product_fulfillment_failed',
      state: 'failed',
      now: now(input),
    });
    return failure('product_fulfillment_failed', message || 'Product fulfillment failed.');
  }

  if (runnerResult.state !== 'completed') {
    const message = runnerResult.state === 'failed'
      ? runnerResult.message
      : runnerResult.question;
    await persistSellerOrder({
      store: input.productStateStore,
      resolved,
      buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
      orderTxid,
      fulfillmentSkills,
      paymentVerified: true,
      fulfillmentState: 'failed',
      failureReason: 'product_fulfillment_failed',
      state: 'failed',
      now: now(input),
    });
    return failure('product_fulfillment_failed', normalizeText(message) || 'Product fulfillment failed.');
  }

  const deliveredAt = now(input);
  const responseText = normalizeText(runnerResult.responseText);
  const deliveryContent = buildDeliveryMessage({
    productOrderPinId: resolved.order.pinId,
    listingPinId: resolved.order.payload.listingPinId,
    skuId: resolved.order.payload.skuId,
    paymentTxid: resolved.order.payload.paymentTxid,
    result: responseText,
    deliveredAt,
  }, orderTxid);
  let deliveryWrite: ProductDeliverySendResult;
  try {
    deliveryWrite = await input.deliverySender.send({
      toGlobalMetaId: normalizeText(input.buyer.globalMetaId),
      orderTxid,
      productOrderPinId: resolved.order.pinId,
      content: deliveryContent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistSellerOrder({
      store: input.productStateStore,
      resolved,
      buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
      orderTxid,
      fulfillmentSkills,
      paymentVerified: true,
      fulfillmentState: 'failed',
      failureReason: 'product_fulfillment_failed',
      state: 'failed',
      now: deliveredAt,
    });
    return failure('product_fulfillment_failed', message || 'Product delivery send failed.');
  }

  let ratingMessagePinId: string | null = null;
  if (input.requestRating !== false && resolved.listing.payload.productType === 'virtual') {
    let ratingWrite: ProductDeliverySendResult | null = null;
    try {
      ratingWrite = await input.deliverySender.send({
        toGlobalMetaId: normalizeText(input.buyer.globalMetaId),
        orderTxid,
        productOrderPinId: resolved.order.pinId,
        content: buildNeedsRatingMessage(orderTxid, 'Please rate this product delivery when ready.'),
      });
    } catch {
      ratingWrite = null;
    }
    ratingMessagePinId = normalizeNullableText(ratingWrite?.pinId);
  }

  const deliveryPinId = normalizeNullableText(deliveryWrite.pinId);
  await persistSellerOrder({
    store: input.productStateStore,
    resolved,
    buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
    orderTxid,
    fulfillmentSkills,
    paymentVerified: true,
    fulfillmentState: 'delivered',
    deliveryPinId,
    deliverySummary: {
      result: responseText,
      deliveryPinId,
      deliveredAt,
    },
    failureReason: null,
    state: 'delivered',
    now: deliveredAt,
  });

  return {
    ok: true,
    data: {
      productOrderPinId: resolved.order.pinId,
      listingPinId: resolved.order.payload.listingPinId,
      skuId: resolved.order.payload.skuId,
      paymentTxid: resolved.order.payload.paymentTxid,
      orderTxid,
      result: responseText,
      deliveryPinId,
      ratingMessagePinId,
    },
  };
}
