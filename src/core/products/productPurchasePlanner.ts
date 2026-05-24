import { evaluateDelegationPolicy } from '../a2a/delegationPolicy';
import type { DelegationPolicyDecision } from '../a2a/sessionTypes';
import { evaluateSpendCap, normalizeSpendCurrency, type SpendCap } from '../delegation/spendPolicy';
import type { ProductDirectoryProduct } from './productDirectory';
import type { ProductPrice, ProductSku } from './productTypes';

export interface ProductPurchasePlannerRequest {
  query?: string;
  listingPinId?: string;
  skuId?: string;
  comment?: string;
  spendCap?: { amount?: unknown; currency?: unknown } | null;
  policyMode?: unknown;
  confirmed?: boolean;
}

export interface ProductPurchasePlannerInput {
  request: ProductPurchasePlannerRequest;
  products: ProductDirectoryProduct[];
}

export type ProductPurchasePlannerResult =
  | {
      ok: true;
      state: 'ready' | 'awaiting_confirmation';
      code: 'product_purchase_ready' | 'product_purchase_awaiting_confirmation';
      product: {
        listingPinId: string;
        title: string;
      };
      sku: {
        skuId: string;
        name: string;
      };
      seller: {
        globalMetaId: string | null;
        name: string | null;
      };
      payment: ProductPrice;
      confirmation: DelegationPolicyDecision;
      confirmRequest?: {
        request: {
          query?: string;
          listingPinId: string;
          skuId: string;
          comment?: string;
          spendCap?: { amount?: unknown; currency?: unknown } | null;
          policyMode: DelegationPolicyDecision['policyMode'];
          confirmed: true;
        };
      };
    }
  | {
      ok: false;
      state: 'blocked' | 'offline' | 'not_found';
      code: string;
      message: string;
      confirmation?: DelegationPolicyDecision;
    };

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCaseInsensitive(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function searchableText(product: ProductDirectoryProduct): string {
  return [
    product.name,
    product.title,
    product.payload.description,
    product.sellerName,
    ...product.payload.skus.flatMap((sku) => [
      sku.name,
      sku.description,
      sku.price.currency,
      sku.price.amount,
    ]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function queryMatchesProduct(product: ProductDirectoryProduct, query: string): boolean {
  const ignoredTerms = new Set(['buy', 'purchase', 'please', 'a', 'an', 'the']);
  const terms = query.toLowerCase().split(/\s+/u).filter((term) => term && !ignoredTerms.has(term));
  if (terms.length === 0) return false;
  const haystack = searchableText(product);
  const matchedTerms = terms.filter((term) => haystack.includes(term)).length;
  return matchedTerms > 0 && matchedTerms / terms.length >= 0.6;
}

function selectProduct(input: ProductPurchasePlannerInput): ProductDirectoryProduct | null {
  const requestedListingPinId = normalizeCaseInsensitive(input.request.listingPinId);
  if (requestedListingPinId) {
    return input.products.find((product) => (
      normalizeCaseInsensitive(product.listingPinId) === requestedListingPinId
    )) ?? null;
  }

  const query = normalizeText(input.request.query);
  if (!query) return null;
  return input.products.find((product) => product.online && queryMatchesProduct(product, query)) ?? null;
}

function selectSku(product: ProductDirectoryProduct, request: ProductPurchasePlannerRequest): ProductSku | null {
  const requestedSkuId = normalizeCaseInsensitive(request.skuId);
  if (requestedSkuId) {
    return product.payload.skus.find((sku) => normalizeCaseInsensitive(sku.skuId) === requestedSkuId) ?? null;
  }
  return product.payload.skus[0] ?? null;
}

function buildPlanBase(input: {
  product: ProductDirectoryProduct;
  sku: ProductSku;
  confirmation: DelegationPolicyDecision;
}) {
  return {
    product: {
      listingPinId: input.product.listingPinId,
      title: input.product.title,
    },
    sku: {
      skuId: input.sku.skuId,
      name: input.sku.name,
    },
    seller: {
      globalMetaId: input.product.sellerGlobalMetaId,
      name: input.product.sellerName,
    },
    payment: {
      amount: input.sku.price.amount,
      currency: input.sku.price.currency,
    },
    confirmation: input.confirmation,
  };
}

function normalizeConfirmSpendCap(value: ProductPurchasePlannerRequest['spendCap']): SpendCap | null {
  if (!value) return null;
  const amount = normalizeText(value.amount);
  const currency = normalizeSpendCurrency(value.currency);
  if (!amount || !currency) return null;
  return { amount, currency };
}

function buildConfirmRequest(input: {
  request: ProductPurchasePlannerRequest;
  product: ProductDirectoryProduct;
  sku: ProductSku;
  confirmation: DelegationPolicyDecision;
}) {
  const query = normalizeText(input.request.query);
  const comment = normalizeText(input.request.comment);
  const spendCap = normalizeConfirmSpendCap(input.request.spendCap);
  return {
    request: {
      ...(query ? { query } : {}),
      listingPinId: input.product.listingPinId,
      skuId: input.sku.skuId,
      ...(comment || input.request.comment === '' ? { comment } : {}),
      ...(spendCap ? { spendCap } : {}),
      policyMode: input.confirmation.policyMode,
      confirmed: true as const,
    },
  };
}

export function planProductPurchase(input: ProductPurchasePlannerInput): ProductPurchasePlannerResult {
  const product = selectProduct(input);
  if (!product) {
    return {
      ok: false,
      state: 'not_found',
      code: 'cached_product_match_not_found',
      message: 'No cached online product matched this purchase request.',
    };
  }

  const sku = selectSku(product, input.request);
  if (!sku) {
    return {
      ok: false,
      state: 'not_found',
      code: 'cached_product_match_not_found',
      message: 'No cached product SKU matched this purchase request.',
    };
  }

  if (!product.online) {
    return {
      ok: false,
      state: 'offline',
      code: 'product_offline',
      message: 'Product seller is offline or unavailable.',
    };
  }

  if (product.productType !== 'virtual') {
    return {
      ok: false,
      state: 'blocked',
      code: 'unsupported_product_type',
      message: 'Physical products are not supported in Product V1.',
    };
  }

  if (product.fulfillment.fulfillmentType !== 'digital_delivery') {
    return {
      ok: false,
      state: 'blocked',
      code: 'unsupported_fulfillment_type',
      message: 'Only digital delivery products are supported in Product V1.',
    };
  }

  if (product.fulfillment.deliveryEndpoint !== 'simplemsg') {
    return {
      ok: false,
      state: 'blocked',
      code: 'unsupported_fulfillment_endpoint',
      message: 'Only simplemsg fulfillment endpoints are supported in Product V1.',
    };
  }

  const currency = normalizeSpendCurrency(sku.price.currency);
  const confirmation = evaluateDelegationPolicy({
    policyMode: input.request.policyMode,
    estimatedCostAmount: sku.price.amount,
    estimatedCostCurrency: currency,
  });
  const spendDecision = evaluateSpendCap({
    price: sku.price.amount,
    currency,
    spendCap: input.request.spendCap as SpendCap | null | undefined,
  });
  if (!spendDecision.allowed) {
    return {
      ok: false,
      state: 'blocked',
      code: spendDecision.code === 'spend_cap_exceeded'
        ? 'product_spend_cap_exceeded'
        : `product_${spendDecision.code ?? 'spend_cap_blocked'}`,
      message: spendDecision.reason ?? 'Product purchase is blocked by spend policy.',
      confirmation,
    };
  }

  const base = buildPlanBase({ product, sku, confirmation });
  if (confirmation.requiresConfirmation && input.request.confirmed !== true) {
    return {
      ok: true,
      state: 'awaiting_confirmation',
      code: 'product_purchase_awaiting_confirmation',
      ...base,
      confirmRequest: buildConfirmRequest({
        request: input.request,
        product,
        sku,
        confirmation,
      }),
    };
  }

  return {
    ok: true,
    state: 'ready',
    code: 'product_purchase_ready',
    ...base,
  };
}
