"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planProductPurchase = planProductPurchase;
const delegationPolicy_1 = require("../a2a/delegationPolicy");
const spendPolicy_1 = require("../delegation/spendPolicy");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeCaseInsensitive(value) {
    return normalizeText(value).toLowerCase();
}
function searchableText(product) {
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
function queryMatchesProduct(product, query) {
    const ignoredTerms = new Set(['buy', 'purchase', 'please', 'a', 'an', 'the']);
    const terms = query.toLowerCase().split(/\s+/u).filter((term) => term && !ignoredTerms.has(term));
    if (terms.length === 0)
        return false;
    const haystack = searchableText(product);
    const matchedTerms = terms.filter((term) => haystack.includes(term)).length;
    return matchedTerms > 0 && matchedTerms / terms.length >= 0.6;
}
function selectProduct(input) {
    const requestedListingPinId = normalizeCaseInsensitive(input.request.listingPinId);
    if (requestedListingPinId) {
        return input.products.find((product) => (normalizeCaseInsensitive(product.listingPinId) === requestedListingPinId)) ?? null;
    }
    const query = normalizeText(input.request.query);
    if (!query)
        return null;
    return input.products.find((product) => product.online && queryMatchesProduct(product, query)) ?? null;
}
function selectSku(product, request) {
    const requestedSkuId = normalizeCaseInsensitive(request.skuId);
    if (requestedSkuId) {
        return product.payload.skus.find((sku) => normalizeCaseInsensitive(sku.skuId) === requestedSkuId) ?? null;
    }
    return product.payload.skus[0] ?? null;
}
function buildPlanBase(input) {
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
function normalizeConfirmSpendCap(value) {
    if (!value)
        return null;
    const amount = normalizeText(value.amount);
    const currency = (0, spendPolicy_1.normalizeSpendCurrency)(value.currency);
    if (!amount || !currency)
        return null;
    return { amount, currency };
}
function buildConfirmRequest(input) {
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
            confirmed: true,
        },
    };
}
function planProductPurchase(input) {
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
    const currency = (0, spendPolicy_1.normalizeSpendCurrency)(sku.price.currency);
    const confirmation = (0, delegationPolicy_1.evaluateDelegationPolicy)({
        policyMode: input.request.policyMode,
        estimatedCostAmount: sku.price.amount,
        estimatedCostCurrency: currency,
    });
    const spendDecision = (0, spendPolicy_1.evaluateSpendCap)({
        price: sku.price.amount,
        currency,
        spendCap: input.request.spendCap,
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
