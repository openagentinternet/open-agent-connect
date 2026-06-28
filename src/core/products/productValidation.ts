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
const PAYMENT_TXID_PATTERN = /^[0-9a-fA-F]{64}$/;

function failure(code: ProductValidationFailureCode, message: string): ProductValidationFailure {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasSurroundingWhitespace(value: string): boolean {
  return value.trim() !== value;
}

function isMetafileUri(value: unknown): value is string {
  if (typeof value !== 'string' || hasSurroundingWhitespace(value)) {
    return false;
  }
  return value.startsWith('metafile://') && value.length > 'metafile://'.length;
}

function isSupportedDescriptionContentType(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !hasSurroundingWhitespace(value) &&
    DESCRIPTION_CONTENT_TYPES.has(value)
  );
}

function isPositiveDecimalString(value: unknown): value is string {
  if (typeof value !== 'string' || hasSurroundingWhitespace(value)) {
    return false;
  }
  if (!DECIMAL_AMOUNT_PATTERN.test(value)) {
    return false;
  }
  return /[1-9]/.test(value.replace('.', ''));
}

export function normalizeProductCurrency(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
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
      amount: value.amount,
      currency,
    },
  };
}

function validateSku(value: unknown): ProductValidationResult<ProductSku> {
  if (!isRecord(value)) {
    return failure('invalid_sku', 'SKU must be an object.');
  }

  if (
    !isNonEmptyString(value.skuId) ||
    hasSurroundingWhitespace(value.skuId) ||
    !isNonEmptyText(value.name)
  ) {
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

  if (!isNonEmptyText(value.description)) {
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
      skuId: value.skuId,
      name: value.name,
      image: value.image,
      descriptionContentType: value.descriptionContentType,
      description: value.description,
      price: price.value,
      initialStock,
    },
  };
}

function validateFulfillment(value: unknown): ProductValidationResult<ProductFulfillment> {
  if (!isRecord(value)) {
    return failure('invalid_product_payload', 'fulfillment must be an object.');
  }

  const fulfillmentType = asString(value.fulfillmentType);
  if (
    fulfillmentType === null ||
    hasSurroundingWhitespace(fulfillmentType) ||
    !FULFILLMENT_TYPES.has(fulfillmentType as ProductFulfillmentType)
  ) {
    return failure(
      'invalid_fulfillment_type',
      'fulfillment.fulfillmentType must be digital_delivery or physical_shipping.',
    );
  }

  const deliveryEndpoint = asString(value.deliveryEndpoint);
  if (
    deliveryEndpoint === null ||
    hasSurroundingWhitespace(deliveryEndpoint) ||
    !DELIVERY_ENDPOINTS.has(deliveryEndpoint as ProductDeliveryEndpoint)
  ) {
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

  const fulfillmentSkills = value.fulfillmentSkills;
  if (
    fulfillmentSkills.some(
      (skill) => typeof skill !== 'string' || skill.length === 0 || hasSurroundingWhitespace(skill),
    )
  ) {
    return failure('invalid_fulfillment_skill', 'fulfillmentSkills must be non-empty strings.');
  }
  const validatedFulfillmentSkills = fulfillmentSkills as string[];

  const fulfillment: ProductFulfillment = {
    fulfillmentType: fulfillmentType as ProductFulfillmentType,
    deliveryEndpoint: deliveryEndpoint as ProductDeliveryEndpoint,
    fulfillmentSkills: [...validatedFulfillmentSkills],
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
    fulfillment.deliverableDescription = value.deliverableDescription;
  }

  return { ok: true, value: fulfillment };
}

export function validateProductListingPayload(
  input: unknown,
): ProductValidationResult<ProductListingPayload> {
  if (!isRecord(input)) {
    return failure('invalid_product_payload', 'Product listing payload must be an object.');
  }

  if (!isNonEmptyText(input.name)) {
    return failure('invalid_product_name', 'name must be a non-empty string.');
  }

  if (!isNonEmptyText(input.title)) {
    return failure('invalid_product_title', 'title must be a non-empty string.');
  }

  const productType = asString(input.productType);
  if (
    productType === null ||
    hasSurroundingWhitespace(productType) ||
    !PRODUCT_TYPES.has(productType as ProductType)
  ) {
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

  if (!isNonEmptyText(input.description)) {
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
    name: input.name,
    title: input.title,
    productType: productType as ProductType,
    coverImage: input.coverImage,
    descriptionContentType: input.descriptionContentType,
    description: input.description,
    fulfillment: fulfillment.value,
    skus,
  };

  if (galleryImages !== undefined) {
    value.galleryImages = galleryImages as string[];
  }

  return { ok: true, value };
}

export function validateProductOrderPayload(
  input: unknown,
): ProductValidationResult<ProductOrderPayload> {
  if (!isRecord(input)) {
    return failure('invalid_product_payload', 'Product order payload must be an object.');
  }

  if (!isNonEmptyString(input.listingPinId) || hasSurroundingWhitespace(input.listingPinId)) {
    return failure('missing_listing_pin_id', 'listingPinId is required.');
  }

  if (!isNonEmptyString(input.skuId) || hasSurroundingWhitespace(input.skuId)) {
    return failure('missing_sku_id', 'skuId is required.');
  }

  if (typeof input.paymentTxid !== 'string' || !PAYMENT_TXID_PATTERN.test(input.paymentTxid)) {
    return failure('invalid_payment_txid', 'paymentTxid must be a 64-character hex txid.');
  }

  const settlementKind =
    input.settlementKind === undefined ? 'native' : asString(input.settlementKind);
  if (
    settlementKind === null ||
    hasSurroundingWhitespace(settlementKind) ||
    !SETTLEMENT_KINDS.has(settlementKind as ProductSettlementKind)
  ) {
    return failure('unsupported_settlement_kind', 'settlementKind must be native.');
  }

  const value: ProductOrderPayload = {
    listingPinId: input.listingPinId,
    skuId: input.skuId,
    settlementKind: settlementKind as ProductSettlementKind,
    paymentTxid: input.paymentTxid,
  };

  if (input.comment !== undefined) {
    if (typeof input.comment !== 'string') {
      return failure('invalid_comment', 'comment must be plain text.');
    }
    value.comment = input.comment;
  }

  return { ok: true, value };
}
