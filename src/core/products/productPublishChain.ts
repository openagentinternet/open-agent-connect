import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
import type { A2AOrderPaymentResult } from '../payments/servicePayment';
import type { ProductDirectoryProduct } from './productDirectory';
import {
  planProductPurchase,
  type ProductPurchasePlannerInput,
  type ProductPurchasePlannerRequest,
  type ProductPurchasePlannerResult,
} from './productPurchasePlanner';
import { buildProductOrderNotification } from './productOrderMessages';
import type { ProductStateStore } from './productStateStore';
import type { ProductListingPayload, ProductOrderPayload } from './productTypes';
import {
  validateProductListingPayload,
  validateProductOrderPayload,
} from './productValidation';

export const PRODUCT_LISTING_PROTOCOL_PATH = '/protocols/product-listing';
export const PRODUCT_ORDER_PROTOCOL_PATH = '/protocols/product-order';

export interface ProductListingChainWriteInput {
  signer: Pick<Signer, 'writePin'>;
  payload: ProductListingPayload;
  network?: string;
}

export interface ProductOrderChainWriteInput {
  signer: Pick<Signer, 'writePin'>;
  payload: ProductOrderPayload;
  network?: string;
}

export interface ProductChainWriteResult {
  payload: ProductListingPayload | ProductOrderPayload;
  chainWrite: ChainWriteResult;
}

export interface ProductPaymentExecutionInput {
  listingPinId: string;
  skuId: string;
  sellerGlobalMetaId: string;
  toAddress: string;
  amount: string;
  currency: 'SPACE' | 'MVC' | 'BTC';
  paymentChain: 'mvc' | 'btc';
  settlementKind: 'native';
  traceId?: string | null;
}

export interface ProductPaymentExecutor {
  execute(input: ProductPaymentExecutionInput): Promise<A2AOrderPaymentResult>;
}

export interface ProductOrderPublishInput {
  payload: ProductOrderPayload;
  network?: string;
}

export interface ProductOrderPublisher {
  publish(input: ProductOrderPublishInput): Promise<ProductChainWriteResult>;
}

export interface ProductSimplemsgSendInput {
  toGlobalMetaId: string;
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
  content: string;
}

export interface ProductSimplemsgSendResult {
  orderTxid?: string | null;
  txids?: string[] | null;
  pinId?: string | null;
}

export interface ProductSimplemsgSender {
  send(input: ProductSimplemsgSendInput): Promise<ProductSimplemsgSendResult>;
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

export interface ExecuteProductPurchaseInput {
  request: ProductPurchasePlannerRequest;
  products: ProductDirectoryProduct[];
  buyerIdentity: {
    globalMetaId?: string | null;
    name?: string | null;
  };
  resolveSellerIdentity: (input: {
    product: ProductDirectoryProduct;
    plan: Extract<ProductPurchasePlannerResult, { ok: true }>;
  }) => Promise<ProductSellerIdentity | null> | ProductSellerIdentity | null;
  paymentExecutor: ProductPaymentExecutor;
  productOrderPublisher: ProductOrderPublisher;
  simplemsgSender: ProductSimplemsgSender;
  productStateStore: Pick<ProductStateStore, 'upsertBuyerOrder'>;
  planner?: (input: ProductPurchasePlannerInput) => ProductPurchasePlannerResult;
  traceId?: string | null;
  sessionId?: string | null;
  localUiUrl?: string | null;
  network?: string | null;
}

export type ExecuteProductPurchaseResult =
  | {
      ok: true;
      data: {
        traceId: string;
        sessionId: string | null;
        productOrderPinId: string;
        paymentTxid: string;
        orderTxid: string;
        localUiUrl?: string;
        product: Extract<ProductPurchasePlannerResult, { ok: true }>['product'];
        sku: Extract<ProductPurchasePlannerResult, { ok: true }>['sku'];
        seller: Extract<ProductPurchasePlannerResult, { ok: true }>['seller'];
        payment: Extract<ProductPurchasePlannerResult, { ok: true }>['payment'];
      };
    }
  | {
      ok: false;
      code: string;
      message: string;
      state?: ProductPurchasePlannerResult extends infer T
        ? T extends { ok: false; state: infer S } ? S : never
        : never;
      data?: Record<string, unknown>;
    };

function normalizeNetwork(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'mvc';
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeProductPaymentCurrency(value: unknown): 'SPACE' | 'MVC' | 'BTC' | '' {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === 'SPACE' || normalized === 'MVC' || normalized === 'BTC') {
    return normalized;
  }
  return '';
}

function resolveProductPaymentChain(currency: 'SPACE' | 'MVC' | 'BTC'): 'mvc' | 'btc' {
  return currency === 'BTC' ? 'btc' : 'mvc';
}

function buildProductTraceId(input: {
  sellerGlobalMetaId: string;
  listingPinId: string;
}): string {
  const seller = normalizeText(input.sellerGlobalMetaId).replace(/[^a-z0-9_-]+/giu, '-').slice(0, 32) || 'seller';
  const listing = normalizeText(input.listingPinId).replace(/[^a-z0-9_-]+/giu, '-').slice(0, 32) || 'listing';
  return `trace-product-${seller}-${listing}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeErrorCodePrefix(message: string): string {
  const prefix = normalizeText(message.split(':', 1)[0]);
  return /^[a-z][a-z0-9_]*$/u.test(prefix) ? prefix : '';
}

function failureFromError(error: unknown, fallbackCode: string): ExecuteProductPurchaseResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = normalizeErrorCodePrefix(message) || fallbackCode;
  return {
    ok: false,
    code,
    message,
  };
}

function stableFailureFromError(error: unknown, code: string): ExecuteProductPurchaseResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    code,
    message,
  };
}

function selectPlannedProduct(input: {
  products: ProductDirectoryProduct[];
  plan: Extract<ProductPurchasePlannerResult, { ok: true }>;
}): ProductDirectoryProduct | null {
  const listingPinId = normalizeText(input.plan.product.listingPinId);
  return input.products.find((product) => normalizeText(product.listingPinId) === listingPinId) ?? null;
}

function resolveSellerPaymentAddress(input: {
  sellerIdentity: ProductSellerIdentity | null;
  paymentChain: 'mvc' | 'btc';
}): string {
  const identity = input.sellerIdentity;
  if (!identity) return '';
  if (input.paymentChain === 'btc') {
    return normalizeText(identity.addresses?.btc);
  }
  return normalizeText(identity.addresses?.mvc) || normalizeText(identity.mvcAddress);
}

function resolveOrderTxid(result: ProductSimplemsgSendResult): string {
  return (
    normalizeText(result.orderTxid)
    || (Array.isArray(result.txids) ? normalizeText(result.txids[0]) : '')
    || normalizeText(result.pinId)
  );
}

function buildProductListingPayload(input: ProductListingPayload): ProductListingPayload {
  const result = validateProductListingPayload(input);
  if (!result.ok) {
    throw new Error(`Invalid product listing payload: ${result.code}`);
  }
  return result.value;
}

function buildProductOrderPayload(input: ProductOrderPayload): ProductOrderPayload {
  const result = validateProductOrderPayload(input);
  if (!result.ok) {
    throw new Error(`Invalid product order payload: ${result.code}`);
  }

  const payload: Partial<ProductOrderPayload> = {
    listingPinId: result.value.listingPinId,
    skuId: result.value.skuId,
  };
  if (input.settlementKind !== undefined) {
    payload.settlementKind = result.value.settlementKind;
  }
  payload.paymentTxid = result.value.paymentTxid;
  if (input.comment !== undefined) {
    payload.comment = result.value.comment;
  }
  return payload as ProductOrderPayload;
}

export function buildProductListingChainWrite(input: {
  payload: ProductListingPayload;
  network?: string;
}) {
  const payload = buildProductListingPayload(input.payload);
  return {
    operation: 'create',
    path: PRODUCT_LISTING_PROTOCOL_PATH,
    payload: JSON.stringify(payload),
    contentType: 'application/json',
    network: normalizeNetwork(input.network),
  };
}

export function buildProductOrderChainWrite(input: {
  payload: ProductOrderPayload;
  network?: string;
}) {
  const payload = buildProductOrderPayload(input.payload);
  return {
    operation: 'create',
    path: PRODUCT_ORDER_PROTOCOL_PATH,
    payload: JSON.stringify(payload),
    contentType: 'application/json',
    network: normalizeNetwork(input.network),
  };
}

export async function publishProductListingToChain(
  input: ProductListingChainWriteInput,
): Promise<ProductChainWriteResult> {
  const payload = buildProductListingPayload(input.payload);
  const chainWrite = await input.signer.writePin({
    operation: 'create',
    path: PRODUCT_LISTING_PROTOCOL_PATH,
    payload: JSON.stringify(payload),
    contentType: 'application/json',
    network: normalizeNetwork(input.network),
  });
  return { payload, chainWrite };
}

export async function publishProductOrderToChain(
  input: ProductOrderChainWriteInput,
): Promise<ProductChainWriteResult> {
  const payload = buildProductOrderPayload(input.payload);
  const chainWrite = await input.signer.writePin({
    operation: 'create',
    path: PRODUCT_ORDER_PROTOCOL_PATH,
    payload: JSON.stringify(payload),
    contentType: 'application/json',
    network: normalizeNetwork(input.network),
  });
  return { payload, chainWrite };
}

export async function executeProductPurchase(
  input: ExecuteProductPurchaseInput,
): Promise<ExecuteProductPurchaseResult> {
  const planner = input.planner ?? planProductPurchase;
  const plan = planner({
    request: input.request,
    products: input.products,
  });
  if (!plan.ok) {
    return {
      ok: false,
      state: plan.state,
      code: plan.code,
      message: plan.message,
    };
  }
  if (plan.state !== 'ready') {
    return {
      ok: false,
      code: 'product_purchase_confirmation_required',
      message: 'Product purchase requires confirmation before payment.',
    };
  }

  const product = selectPlannedProduct({ products: input.products, plan });
  if (!product) {
    return {
      ok: false,
      code: 'cached_product_match_not_found',
      message: 'No cached online product matched this purchase request.',
    };
  }

  const currency = normalizeProductPaymentCurrency(plan.payment.currency);
  if (!currency) {
    return {
      ok: false,
      code: 'product_payment_unsupported_settlement',
      message: 'Only native SPACE/MVC and BTC product payments are supported.',
    };
  }
  const paymentChain = resolveProductPaymentChain(currency);
  const sellerIdentity = await input.resolveSellerIdentity({ product, plan });
  const sellerGlobalMetaId = normalizeText(sellerIdentity?.globalMetaId) || normalizeText(plan.seller.globalMetaId);
  if (!sellerGlobalMetaId) {
    return {
      ok: false,
      code: 'product_seller_identity_missing',
      message: 'Product seller identity is missing from listing owner metadata.',
    };
  }
  const toAddress = resolveSellerPaymentAddress({ sellerIdentity, paymentChain });
  if (!toAddress) {
    return {
      ok: false,
      code: 'product_seller_payment_address_missing',
      message: 'Product seller payment address is missing from seller identity metadata.',
    };
  }

  const traceId = normalizeText(input.traceId) || buildProductTraceId({
    sellerGlobalMetaId,
    listingPinId: plan.product.listingPinId,
  });
  const sessionId = normalizeText(input.sessionId) || null;

  let payment: A2AOrderPaymentResult;
  try {
    payment = await input.paymentExecutor.execute({
      listingPinId: plan.product.listingPinId,
      skuId: plan.sku.skuId,
      sellerGlobalMetaId,
      toAddress,
      amount: plan.payment.amount,
      currency,
      paymentChain,
      settlementKind: 'native',
      traceId,
    });
  } catch (error) {
    return failureFromError(error, 'product_payment_failed');
  }

  const paymentTxid = normalizeText(payment.paymentTxid);
  if (!paymentTxid) {
    return {
      ok: false,
      code: 'payment_txid_missing',
      message: 'Paid product payment executor did not return a payment txid.',
    };
  }

  const orderPayload: ProductOrderPayload = {
    listingPinId: plan.product.listingPinId,
    skuId: plan.sku.skuId,
    settlementKind: 'native',
    paymentTxid,
  };
  const comment = normalizeText(input.request.comment);
  if (comment || input.request.comment === '') {
    orderPayload.comment = comment;
  }

  let published: ProductChainWriteResult;
  try {
    published = await input.productOrderPublisher.publish({
      payload: orderPayload,
      network: normalizeText(input.network) || paymentChain,
    });
  } catch (error) {
    await input.productStateStore.upsertBuyerOrder({
      productOrderPinId: null,
      listingPinId: orderPayload.listingPinId,
      skuId: orderPayload.skuId,
      paymentTxid,
      sellerGlobalMetaId,
      buyerGlobalMetaId: input.buyerIdentity.globalMetaId,
      traceId,
      sessionId,
      state: 'failed',
    });
    return stableFailureFromError(error, 'product_order_publish_failed');
  }

  const productOrderPinId = normalizeText(published.chainWrite.pinId);
  if (!productOrderPinId) {
    return {
      ok: false,
      code: 'product_order_pin_missing',
      message: 'Product-order chain writer did not return a product-order pin id.',
    };
  }

  const content = buildProductOrderNotification({
    productOrderPinId,
    listingPinId: orderPayload.listingPinId,
    skuId: orderPayload.skuId,
    paymentTxid,
    comment: orderPayload.comment,
  });

  let sent: ProductSimplemsgSendResult;
  try {
    sent = await input.simplemsgSender.send({
      toGlobalMetaId: sellerGlobalMetaId,
      productOrderPinId,
      listingPinId: orderPayload.listingPinId,
      skuId: orderPayload.skuId,
      paymentTxid,
      content,
    });
  } catch (error) {
    await input.productStateStore.upsertBuyerOrder({
      productOrderPinId,
      listingPinId: orderPayload.listingPinId,
      skuId: orderPayload.skuId,
      paymentTxid,
      sellerGlobalMetaId,
      buyerGlobalMetaId: input.buyerIdentity.globalMetaId,
      traceId,
      sessionId,
      state: 'failed',
    });
    return stableFailureFromError(error, 'product_order_dispatch_failed');
  }

  const orderTxid = resolveOrderTxid(sent);
  if (!orderTxid) {
    await input.productStateStore.upsertBuyerOrder({
      productOrderPinId,
      listingPinId: orderPayload.listingPinId,
      skuId: orderPayload.skuId,
      paymentTxid,
      sellerGlobalMetaId,
      buyerGlobalMetaId: input.buyerIdentity.globalMetaId,
      traceId,
      sessionId,
      state: 'failed',
    });
    return {
      ok: false,
      code: 'product_order_txid_missing',
      message: 'Product order simplemsg sender did not return an order txid.',
    };
  }

  await input.productStateStore.upsertBuyerOrder({
    productOrderPinId,
    listingPinId: orderPayload.listingPinId,
    skuId: orderPayload.skuId,
    paymentTxid,
    orderTxid,
    sellerGlobalMetaId,
    buyerGlobalMetaId: input.buyerIdentity.globalMetaId,
    traceId,
    sessionId,
    state: 'notified',
  });

  return {
    ok: true,
    data: {
      traceId,
      sessionId,
      productOrderPinId,
      paymentTxid,
      orderTxid,
      ...(normalizeText(input.localUiUrl) ? { localUiUrl: normalizeText(input.localUiUrl) } : {}),
      product: plan.product,
      sku: plan.sku,
      seller: {
        globalMetaId: sellerGlobalMetaId,
        name: normalizeText(sellerIdentity?.name) || normalizeText(plan.seller.name) || null,
      },
      payment: plan.payment,
    },
  };
}
