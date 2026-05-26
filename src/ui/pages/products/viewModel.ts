import { validateProductListingPayload } from '../../../core/products/productValidation';
import type {
  ProductDirectoryProduct,
} from '../../../core/products/productDirectory';
import type {
  ProductListingPayload,
  ProductOrderState,
  ProductPrice,
  ProductSku,
} from '../../../core/products/productTypes';

export interface ProductCommerceRowViewModel {
  listingPinId: string;
  title: string;
  sellerLabel: string;
  onlineStateLabel: string;
  skuCountLabel: string;
  firstPriceLabel: string;
  coverPreviewUri: string;
  canPurchase: boolean;
  blockedReason: string;
}

export interface ProductCommerceSkuViewModel {
  skuId: string;
  name: string;
  priceLabel: string;
  stockLabel: string;
  imagePreviewUri: string;
  descriptionLabel: string;
}

export interface ProductCommerceOrderRowViewModel {
  orderId: string;
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  roleLabel: string;
  stateLabel: string;
  paymentTxid: string;
  orderTxid: string;
  buyerLabel: string;
  sellerLabel: string;
  createdAtLabel: string;
  updatedAtLabel: string;
}

export interface ProductCommerceListingFormInput {
  name?: unknown;
  title?: unknown;
  coverImage?: unknown;
  galleryImages?: unknown;
  descriptionContentType?: unknown;
  description?: unknown;
  fulfillmentSkills?: unknown;
  fulfillmentType?: unknown;
  deliveryEndpoint?: unknown;
  estimatedDeliverySeconds?: unknown;
  deliverableDescription?: unknown;
  skuId?: unknown;
  skuName?: unknown;
  skuImage?: unknown;
  skuDescriptionContentType?: unknown;
  skuDescription?: unknown;
  priceAmount?: unknown;
  priceCurrency?: unknown;
  initialStock?: unknown;
}

export interface ProductCommercePurchaseSelectionInput {
  listingPinId?: unknown;
  skuId?: unknown;
  spendCap?: unknown;
  comment?: unknown;
}

export interface ProductCommercePageViewModel {
  productRows: ProductCommerceRowViewModel[];
  selectedProductRow: ProductCommerceRowViewModel | null;
  selectedSkuRows: ProductCommerceSkuViewModel[];
  purchasePreviewRequest: {
    confirmed: false;
    listingPinId: string;
    skuId: string;
    spendCap: string;
    comment?: string;
  } | null;
  listingPreviewPayload: ProductListingPayload | null;
  orderRows: ProductCommerceOrderRowViewModel[];
  fulfillmentLabel: string;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null;
}

function formatPrice(amount: unknown, currency: unknown): string {
  const normalizedAmount = normalizeText(amount);
  const normalizedCurrency = normalizeText(currency).toUpperCase();
  return [normalizedAmount, normalizedCurrency].filter(Boolean).join(' ') || 'No price';
}

function formatTimestamp(value: unknown): string {
  const numeric = Number(value);
  let date: Date | null = null;
  if (Number.isFinite(numeric) && numeric > 0) {
    date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
  } else {
    const raw = normalizeText(value);
    if (raw) {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) {
        date = new Date(parsed);
      }
    }
  }
  if (!date || !Number.isFinite(date.getTime())) {
    return '';
  }
  const pad = (part: number): string => String(part).padStart(2, '0');
  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
  ].join(' ');
}

function formatOrderStateLabel(state: unknown): string {
  switch (normalizeText(state)) {
    case 'created':
      return 'Created';
    case 'payment_pending':
      return 'Payment pending';
    case 'paid':
      return 'Paid';
    case 'notified':
      return 'Notified';
    case 'accepted':
      return 'Accepted';
    case 'fulfilling':
      return 'Fulfilling';
    case 'delivered':
      return 'Delivered';
    case 'failed':
      return 'Failed';
    case 'closed':
      return 'Closed';
    default:
      return 'Unknown';
  }
}

function isMetafileUri(value: unknown): value is string {
  const normalized = normalizeText(value);
  return normalized.startsWith('metafile://') && normalized.length > 'metafile://'.length;
}

function extractMetafileRef(value: unknown): string {
  const normalized = normalizeText(value);
  if (!isMetafileUri(normalized)) {
    return '';
  }
  return normalized
    .slice('metafile://'.length)
    .split(/[?#]/u)[0]
    .trim();
}

function normalizeMetafileUri(value: unknown): string {
  return isMetafileUri(value) ? normalizeText(value) : '';
}

function mediaPreviewUriFromMetafileUri(value: unknown): string {
  const ref = extractMetafileRef(value);
  return ref ? `/api/file/avatar?ref=${encodeURIComponent(ref)}` : '';
}

function readSkillCatalog(input: unknown): string[] {
  const skills = readArray(input).map((skill) => normalizeText(skill)).filter(Boolean);
  return [...new Set(skills)];
}

function assertPositiveIntegerStock(value: unknown): number {
  const normalized = normalizeInteger(value);
  if (normalized === null || normalized <= 0) {
    throw new Error('SKU initialStock must be a positive integer.');
  }
  return normalized;
}

function assertKnownFulfillmentSkills(selectedSkills: unknown, catalog: string[]): string[] {
  const skills = readArray(selectedSkills).map((skill) => normalizeText(skill)).filter(Boolean);
  if (skills.length === 0) {
    throw new Error('fulfillmentSkills must contain at least one skill name.');
  }
  const unknownSkill = skills.find((skill) => catalog.length > 0 && !catalog.includes(skill));
  if (unknownSkill) {
    throw new Error(`Unknown fulfillment skill: ${unknownSkill}`);
  }
  return [...new Set(skills)];
}

function buildProductSkuViewModel(sku: unknown): ProductCommerceSkuViewModel {
  const row = readObject(sku);
  const price = readObject(row.price);
  return {
    skuId: normalizeText(row.skuId),
    name: normalizeText(row.name),
    priceLabel: formatPrice(price.amount, price.currency),
    stockLabel: normalizeInteger(row.initialStock) !== null ? String(normalizeInteger(row.initialStock)) : '',
    imagePreviewUri: mediaPreviewUriFromMetafileUri(row.image),
    descriptionLabel: normalizeText(row.description),
  };
}

function buildProductDirectoryRowViewModel(product: unknown): ProductCommerceRowViewModel {
  const row = readObject(product);
  const listing = readObject(row.listing);
  const skus = readArray(row.skus || listing.skus);
  const firstSku = skus.length > 0 ? readObject(skus[0]) : {};
  const productType = normalizeText(row.productType || listing.productType);
  const fulfillment = readObject(row.fulfillment || listing.fulfillment);
  const fulfillmentType = normalizeText(fulfillment.fulfillmentType);
  const deliveryEndpoint = normalizeText(fulfillment.deliveryEndpoint);
  const canPurchase = row.online === true
    && productType === 'virtual'
    && fulfillmentType === 'digital_delivery'
    && deliveryEndpoint === 'simplemsg';
  const blockedReason = canPurchase
    ? ''
    : productType !== 'virtual'
      ? 'Physical products are not supported in Product V1.'
      : fulfillmentType !== 'digital_delivery'
        ? 'Only digital delivery products are supported in Product V1.'
        : deliveryEndpoint !== 'simplemsg'
          ? 'Only simplemsg fulfillment endpoints are supported in Product V1.'
          : 'Product seller is offline or unavailable.';

  return {
    listingPinId: normalizeText(row.listingPinId),
    title: normalizeText(row.title || listing.title),
    sellerLabel: normalizeText(row.sellerName || row.sellerLabel || row.providerName) || 'Unknown seller',
    onlineStateLabel: row.online === true ? 'Online' : 'Offline',
    skuCountLabel: `${skus.length || Number(row.skuCount) || 0} SKU${(skus.length || Number(row.skuCount) || 0) === 1 ? '' : 's'}`,
    firstPriceLabel: formatPrice(readObject(firstSku.price).amount, readObject(firstSku.price).currency),
    coverPreviewUri: mediaPreviewUriFromMetafileUri(listing.coverImage || row.coverImage),
    canPurchase,
    blockedReason,
  };
}

function buildProductOrderRowViewModel(order: unknown): ProductCommerceOrderRowViewModel {
  const row = readObject(order);
  return {
    orderId: normalizeText(row.orderId || row.id || row.productOrderPinId),
    productOrderPinId: normalizeText(row.productOrderPinId),
    listingPinId: normalizeText(row.listingPinId),
    skuId: normalizeText(row.skuId),
    roleLabel: normalizeText(row.role) === 'seller' ? 'Seller' : 'Buyer',
    stateLabel: formatOrderStateLabel(row.state),
    paymentTxid: normalizeText(row.paymentTxid),
    orderTxid: normalizeText(row.orderTxid),
    buyerLabel: normalizeText(row.buyerMetaId),
    sellerLabel: normalizeText(row.sellerMetaId),
    createdAtLabel: formatTimestamp(row.createdAt),
    updatedAtLabel: formatTimestamp(row.updatedAt),
  };
}

function buildProductListingPreviewPayload(
  form: ProductCommerceListingFormInput,
  skillCatalog: string[],
): ProductListingPayload {
  const coverImage = normalizeMetafileUri(form.coverImage);
  if (!coverImage) {
    throw new Error('coverImage must be a metafile URI.');
  }

  const galleryImages = readArray(form.galleryImages);
  const normalizedGalleryImages = galleryImages.map((uri) => normalizeMetafileUri(uri)).filter(Boolean);
  if (galleryImages.length > 0 && normalizedGalleryImages.length !== galleryImages.length) {
    throw new Error('galleryImages must contain only metafile URIs.');
  }

  const skuImage = normalizeMetafileUri(form.skuImage);
  if (!skuImage) {
    throw new Error('SKU image must be a metafile URI.');
  }
  const selectedSkills = assertKnownFulfillmentSkills(form.fulfillmentSkills, skillCatalog);

  const payload: ProductListingPayload = {
    name: normalizeText(form.name),
    title: normalizeText(form.title),
    productType: 'virtual',
    coverImage,
    descriptionContentType: normalizeText(form.descriptionContentType),
    description: normalizeText(form.description),
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: selectedSkills,
    },
    skus: [
      {
        skuId: normalizeText(form.skuId),
        name: normalizeText(form.skuName),
        image: skuImage,
        descriptionContentType: normalizeText(form.skuDescriptionContentType),
        description: normalizeText(form.skuDescription),
        price: {
          amount: normalizeText(form.priceAmount),
          currency: normalizeText(form.priceCurrency).toUpperCase(),
        },
        initialStock: assertPositiveIntegerStock(form.initialStock),
      },
    ],
  };

  if (normalizedGalleryImages.length > 0) {
    payload.galleryImages = normalizedGalleryImages;
  }
  const estimatedDeliverySeconds = normalizeInteger(form.estimatedDeliverySeconds);
  if (estimatedDeliverySeconds !== null) {
    payload.fulfillment.estimatedDeliverySeconds = estimatedDeliverySeconds;
  }
  const deliverableDescription = normalizeText(form.deliverableDescription);
  if (deliverableDescription) {
    payload.fulfillment.deliverableDescription = deliverableDescription;
  }

  const validation = validateProductListingPayload(payload);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  return validation.value;
}

function buildProductPurchasePreviewRequest(
  selection: ProductCommercePurchaseSelectionInput,
): {
  confirmed: false;
  listingPinId: string;
  skuId: string;
  spendCap: string;
  comment?: string;
} {
  const listingPinId = normalizeText(selection.listingPinId);
  const skuId = normalizeText(selection.skuId);
  const spendCap = normalizeText(selection.spendCap);
  if (!listingPinId || !skuId || !spendCap) {
    throw new Error('listingPinId, skuId, and spendCap are required for a purchase preview.');
  }
  const comment = normalizeText(selection.comment);
  return {
    confirmed: false,
    listingPinId,
    skuId,
    spendCap,
    ...(comment ? { comment } : {}),
  };
}

export function buildProductCommercePageViewModel(input: {
  products?: unknown;
  selectedListing?: unknown;
  selectedSku?: unknown;
  purchaseSelection?: unknown;
  listingForm?: ProductCommerceListingFormInput | null;
  orderRows?: unknown;
  skillCatalog?: unknown;
}): ProductCommercePageViewModel {
  const skillCatalog = readSkillCatalog(input.skillCatalog);
  const products = readArray(input.products);
  const productRows = products.map(buildProductDirectoryRowViewModel);
  const selectedListing = readObject(input.selectedListing);
  const selectedSkuSource = readObject(input.selectedSku);
  const selectedProductRow = selectedListing.listingPinId
    ? productRows.find((row) => row.listingPinId === normalizeText(selectedListing.listingPinId)) ?? null
    : productRows[0] ?? null;
  const selectedSkuRows = readArray(selectedListing.skus || selectedSkuSource.skus).map(buildProductSkuViewModel);
  const purchasePreviewRequest = input.purchaseSelection
    ? buildProductPurchasePreviewRequest(input.purchaseSelection as ProductCommercePurchaseSelectionInput)
    : null;
  const listingPreviewPayload = input.listingForm
    ? buildProductListingPreviewPayload(input.listingForm, skillCatalog)
    : null;
  const orderRows = readArray(input.orderRows).map(buildProductOrderRowViewModel);

  return {
    productRows,
    selectedProductRow,
    selectedSkuRows,
    purchasePreviewRequest,
    listingPreviewPayload,
    orderRows,
    fulfillmentLabel: skillCatalog.length > 0
      ? `All fulfillment skills available: ${skillCatalog.join(', ')}`
      : 'No fulfillment skills loaded',
  };
}

export function buildProductCommercePageViewModelRuntimeSource(): string {
  return [
    readObject,
    readArray,
    normalizeText,
    normalizeInteger,
    formatPrice,
    formatTimestamp,
    formatOrderStateLabel,
    isMetafileUri,
    extractMetafileRef,
    normalizeMetafileUri,
    mediaPreviewUriFromMetafileUri,
    readSkillCatalog,
    assertPositiveIntegerStock,
    assertKnownFulfillmentSkills,
    buildProductSkuViewModel,
    buildProductDirectoryRowViewModel,
    buildProductOrderRowViewModel,
    buildProductListingPreviewPayload,
    buildProductPurchasePreviewRequest,
    buildProductCommercePageViewModel,
  ].map((fn) => fn.toString()).join('\n\n');
}
