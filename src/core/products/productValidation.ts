import type {
  ProductDeliveryEndpoint,
  ProductFulfillment,
  ProductFulfillmentType,
  ProductListingPayload,
  ProductOrderPayload,
  ProductSettlementKind,
  ProductSku,
  ProductType,
} from './productTypes';

export type ProductValidationFailureCode =
  | 'invalid_product_payload'
  | 'invalid_product_name'
  | 'invalid_product_title'
  | 'invalid_product_type'
  | 'invalid_cover_image_uri'
  | 'invalid_gallery_image_uri'
  | 'invalid_description_content_type'
  | 'invalid_description'
  | 'invalid_fulfillment_type'
  | 'unsupported_fulfillment_endpoint'
  | 'missing_fulfillment_skill'
  | 'invalid_fulfillment_skill'
  | 'invalid_sku'
  | 'duplicate_sku_id'
  | 'invalid_sku_price'
  | 'invalid_initial_stock'
  | 'missing_listing_pin_id'
  | 'missing_sku_id'
  | 'invalid_payment_txid'
  | 'unsupported_settlement_kind'
  | 'invalid_comment';

export interface ProductValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ProductValidationFailure {
  ok: false;
  code: ProductValidationFailureCode;
  message: string;
}

export type ProductValidationResult<T> = ProductValidationSuccess<T> | ProductValidationFailure;

const PRODUCT_TYPES = new Set<ProductType>(['virtual', 'physical']);
const FULFILLMENT_TYPES = new Set<ProductFulfillmentType>([
  'digital_delivery',
  'physical_shipping',
]);
const DELIVERY_ENDPOINTS = new Set<ProductDeliveryEndpoint>(['simplemsg', 'logistics']);
const DESCRIPTION_CONTENT_TYPES = new Set(['text/markdown', 'text/html']);
const SETTLEMENT_KINDS = new Set<ProductSettlementKind>(['native']);
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function failure(code: ProductValidationFailureCode, message: string): ProductValidationFailure {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isNonEmptyString(value: unknown): value is string {
  return normalizeString(value).length > 0;
}

function isMetafileUri(value: unknown): value is string {
  const uri = normalizeString(value);
  return uri.startsWith('metafile://') && uri.length > 'metafile://'.length;
}

function isSupportedDescriptionContentType(value: unknown): value is string {
  return DESCRIPTION_CONTENT_TYPES.has(normalizeString(value));
}

function isPositiveDecimalString(value: unknown): value is string {
  const amount = normalizeString(value);
  if (!DECIMAL_AMOUNT_PATTERN.test(amount)) {
    return false;
  }
  return /[1-9]/.test(amount.replace('.', ''));
}

export function normalizeProductCurrency(value: unknown): string {
  return normalizeString(value).toUpperCase();
}

function validatePrice(value: unknown): ProductValidationResult<{ amount: string; currency: string }> {
  if (!isRecord(value) || !isPositiveDecimalString(value.amount)) {
    return failure('invalid_sku_price', 'SKU price amount must be a positive decimal string.');
  }

  const currency = normalizeProductCurrency(value.currency);
  if (!currency) {
    return failure('invalid_sku_price', 'SKU price currency must be a non-empty string.');
  }

  return {
    ok: true,
    value: {
      amount: normalizeString(value.amount),
      currency,
    },
  };
}

function validateSku(value: unknown): ProductValidationResult<ProductSku> {
  if (!isRecord(value)) {
    return failure('invalid_sku', 'SKU must be an object.');
  }

  if (!isNonEmptyString(value.skuId) || !isNonEmptyString(value.name)) {
    return failure('invalid_sku', 'SKU requires skuId and name.');
  }

  if (!isMetafileUri(value.image)) {
    return failure('invalid_gallery_image_uri', 'SKU image must be a metafile URI.');
  }

  if (!isSupportedDescriptionContentType(value.descriptionContentType)) {
    return failure(
      'invalid_description_content_type',
      'SKU descriptionContentType must be text/markdown or text/html.',
    );
  }

  if (!isNonEmptyString(value.description)) {
    return failure('invalid_description', 'SKU description must be a non-empty string.');
  }

  const price = validatePrice(value.price);
  if (!price.ok) {
    return price;
  }

  const initialStock = value.initialStock;
  if (typeof initialStock !== 'number' || !Number.isInteger(initialStock) || initialStock <= 0) {
    return failure('invalid_initial_stock', 'SKU initialStock must be a positive integer.');
  }

  return {
    ok: true,
    value: {
      skuId: normalizeString(value.skuId),
      name: normalizeString(value.name),
      image: normalizeString(value.image),
      descriptionContentType: normalizeString(value.descriptionContentType),
      description: normalizeString(value.description),
      price: price.value,
      initialStock,
    },
  };
}

function validateFulfillment(value: unknown): ProductValidationResult<ProductFulfillment> {
  if (!isRecord(value)) {
    return failure('invalid_product_payload', 'fulfillment must be an object.');
  }

  const fulfillmentType = normalizeString(value.fulfillmentType);
  if (!FULFILLMENT_TYPES.has(fulfillmentType as ProductFulfillmentType)) {
    return failure(
      'invalid_fulfillment_type',
      'fulfillment.fulfillmentType must be digital_delivery or physical_shipping.',
    );
  }

  const deliveryEndpoint = normalizeString(value.deliveryEndpoint);
  if (!DELIVERY_ENDPOINTS.has(deliveryEndpoint as ProductDeliveryEndpoint)) {
    return failure(
      'unsupported_fulfillment_endpoint',
      'fulfillment.deliveryEndpoint must be simplemsg or logistics.',
    );
  }

  if (!Array.isArray(value.fulfillmentSkills) || value.fulfillmentSkills.length === 0) {
    return failure(
      'missing_fulfillment_skill',
      'fulfillment.fulfillmentSkills must contain at least one skill name.',
    );
  }

  const fulfillmentSkills = value.fulfillmentSkills.map((skill) => normalizeString(skill));
  if (fulfillmentSkills.some((skill) => !skill)) {
    return failure('invalid_fulfillment_skill', 'fulfillmentSkills must be non-empty strings.');
  }

  const fulfillment: ProductFulfillment = {
    fulfillmentType: fulfillmentType as ProductFulfillmentType,
    deliveryEndpoint: deliveryEndpoint as ProductDeliveryEndpoint,
    fulfillmentSkills,
  };

  const estimatedDeliverySeconds = value.estimatedDeliverySeconds;
  if (estimatedDeliverySeconds !== undefined) {
    if (
      typeof estimatedDeliverySeconds !== 'number' ||
      !Number.isInteger(estimatedDeliverySeconds) ||
      estimatedDeliverySeconds < 0
    ) {
      return failure(
        'invalid_product_payload',
        'fulfillment.estimatedDeliverySeconds must be a non-negative integer.',
      );
    }
    fulfillment.estimatedDeliverySeconds = estimatedDeliverySeconds;
  }

  if (value.deliverableDescription !== undefined) {
    if (typeof value.deliverableDescription !== 'string') {
      return failure(
        'invalid_product_payload',
        'fulfillment.deliverableDescription must be a string.',
      );
    }
    fulfillment.deliverableDescription = value.deliverableDescription.trim();
  }

  return { ok: true, value: fulfillment };
}

export function validateProductListingPayload(
  input: unknown,
): ProductValidationResult<ProductListingPayload> {
  if (!isRecord(input)) {
    return failure('invalid_product_payload', 'Product listing payload must be an object.');
  }

  if (!isNonEmptyString(input.name)) {
    return failure('invalid_product_name', 'name must be a non-empty string.');
  }

  if (!isNonEmptyString(input.title)) {
    return failure('invalid_product_title', 'title must be a non-empty string.');
  }

  const productType = normalizeString(input.productType);
  if (!PRODUCT_TYPES.has(productType as ProductType)) {
    return failure('invalid_product_type', 'productType must be virtual or physical.');
  }

  if (!isMetafileUri(input.coverImage)) {
    return failure('invalid_cover_image_uri', 'coverImage must be a metafile URI.');
  }

  const galleryImages = input.galleryImages;
  if (
    galleryImages !== undefined &&
    (!Array.isArray(galleryImages) || galleryImages.some((uri) => !isMetafileUri(uri)))
  ) {
    return failure('invalid_gallery_image_uri', 'galleryImages must contain only metafile URIs.');
  }

  if (!isSupportedDescriptionContentType(input.descriptionContentType)) {
    return failure(
      'invalid_description_content_type',
      'descriptionContentType must be text/markdown or text/html.',
    );
  }

  if (!isNonEmptyString(input.description)) {
    return failure('invalid_description', 'description must be a non-empty string.');
  }

  const fulfillment = validateFulfillment(input.fulfillment);
  if (!fulfillment.ok) {
    return fulfillment;
  }

  if (!Array.isArray(input.skus) || input.skus.length === 0) {
    return failure('invalid_sku', 'skus must contain at least one SKU.');
  }

  const skus: ProductSku[] = [];
  const skuIds = new Set<string>();
  for (const item of input.skus) {
    const sku = validateSku(item);
    if (!sku.ok) {
      return sku;
    }
    if (skuIds.has(sku.value.skuId)) {
      return failure('duplicate_sku_id', 'SKU IDs must be unique within a listing.');
    }
    skuIds.add(sku.value.skuId);
    skus.push(sku.value);
  }

  const value: ProductListingPayload = {
    name: normalizeString(input.name),
    title: normalizeString(input.title),
    productType: productType as ProductType,
    coverImage: normalizeString(input.coverImage),
    descriptionContentType: normalizeString(input.descriptionContentType),
    description: normalizeString(input.description),
    fulfillment: fulfillment.value,
    skus,
  };

  if (galleryImages !== undefined) {
    value.galleryImages = galleryImages.map((uri) => normalizeString(uri));
  }

  return { ok: true, value };
}

export function validateProductOrderPayload(
  input: unknown,
): ProductValidationResult<ProductOrderPayload> {
  if (!isRecord(input)) {
    return failure('invalid_product_payload', 'Product order payload must be an object.');
  }

  if (!isNonEmptyString(input.listingPinId)) {
    return failure('missing_listing_pin_id', 'listingPinId is required.');
  }

  if (!isNonEmptyString(input.skuId)) {
    return failure('missing_sku_id', 'skuId is required.');
  }

  if (!isNonEmptyString(input.paymentTxid)) {
    return failure('invalid_payment_txid', 'paymentTxid must be a non-empty chain txid string.');
  }

  const settlementKind =
    input.settlementKind === undefined ? 'native' : normalizeString(input.settlementKind);
  if (!SETTLEMENT_KINDS.has(settlementKind as ProductSettlementKind)) {
    return failure('unsupported_settlement_kind', 'settlementKind must be native.');
  }

  const value: ProductOrderPayload = {
    listingPinId: normalizeString(input.listingPinId),
    skuId: normalizeString(input.skuId),
    settlementKind: settlementKind as ProductSettlementKind,
    paymentTxid: normalizeString(input.paymentTxid),
  };

  if (input.comment !== undefined) {
    if (typeof input.comment !== 'string') {
      return failure('invalid_comment', 'comment must be plain text.');
    }
    value.comment = input.comment.trim();
  }

  return { ok: true, value };
}
