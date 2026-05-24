import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import { resolveMetabotPaths } from '../state/paths';
import { ensureRuntimeLayout } from '../state/runtimeStateStore';
import type {
  ProductListingPayload,
  ProductOrderState,
} from './productTypes';

const PRODUCT_STATE_SCHEMA_VERSION = 1;

export interface OwnedProductListingRecord {
  listingPinId: string;
  localMetabotSlug: string | null;
  name: string;
  title: string;
  productType: ProductListingPayload['productType'];
  skuCount: number;
  fulfillmentSkills: string[];
  payload: ProductListingPayload;
  available: boolean;
  revokedAt: number | null;
  localUpdatedAt: number;
}

export interface ProductDirectoryCacheRecord {
  listingPinId: string;
  name: string;
  title: string;
  productType: ProductListingPayload['productType'];
  skuCount: number;
  fulfillmentSkills: string[];
  payload: ProductListingPayload;
  sellerGlobalMetaId: string | null;
  sellerName: string | null;
  online: boolean;
  cachedAt: number;
}

export interface ProductBuyerOrderRecord {
  role: 'buyer';
  productOrderPinId: string | null;
  listingPinId: string;
  skuId: string;
  paymentTxid: string | null;
  orderTxid: string | null;
  sellerGlobalMetaId: string | null;
  state: ProductOrderState;
  localUpdatedAt: number;
}

export interface ProductSellerOrderRecord {
  role: 'seller';
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
  orderTxid: string | null;
  buyerGlobalMetaId: string | null;
  fulfillmentSkills: string[];
  state: ProductOrderState;
  localUpdatedAt: number;
}

export interface ProductState {
  version: number;
  ownedListings: OwnedProductListingRecord[];
  directoryCache: ProductDirectoryCacheRecord[];
  buyerOrders: ProductBuyerOrderRecord[];
  sellerOrders: ProductSellerOrderRecord[];
}

export interface ProductStateStore {
  paths: MetabotPaths;
  productsRoot: string;
  productStatePath: string;
  ensureLayout(): Promise<MetabotPaths>;
  readState(): Promise<ProductState>;
  writeState(nextState: ProductState): Promise<ProductState>;
  updateState(updater: (currentState: ProductState) => ProductState | Promise<ProductState>): Promise<ProductState>;
  upsertOwnedListing(input: UpsertOwnedListingInput): Promise<OwnedProductListingRecord>;
  upsertDirectoryItem(input: UpsertDirectoryItemInput): Promise<ProductDirectoryCacheRecord>;
  upsertBuyerOrder(input: UpsertBuyerOrderInput): Promise<ProductBuyerOrderRecord>;
  upsertSellerOrder(input: UpsertSellerOrderInput): Promise<ProductSellerOrderRecord>;
  findListingByPinId(listingPinId: string): Promise<ProductListingLookup | null>;
  findOrderByProductOrderPinId(productOrderPinId: string): Promise<ProductOrderLookup | null>;
  findOrderByPaymentTxid(paymentTxid: string): Promise<ProductOrderLookup | null>;
  findOrderByOrderTxid(orderTxid: string): Promise<ProductOrderLookup | null>;
}

export interface UpsertOwnedListingInput {
  listingPinId: string;
  localMetabotSlug?: string | null;
  payload: ProductListingPayload;
  available?: boolean;
  revokedAt?: number | null;
  localUpdatedAt?: number;
}

export interface UpsertDirectoryItemInput {
  listingPinId: string;
  payload: ProductListingPayload;
  sellerGlobalMetaId?: string | null;
  sellerName?: string | null;
  online?: boolean;
  cachedAt?: number;
}

export interface UpsertBuyerOrderInput {
  productOrderPinId?: string | null;
  listingPinId: string;
  skuId: string;
  paymentTxid?: string | null;
  orderTxid?: string | null;
  sellerGlobalMetaId?: string | null;
  state?: ProductOrderState;
  localUpdatedAt?: number;
}

export interface UpsertSellerOrderInput {
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
  orderTxid?: string | null;
  buyerGlobalMetaId?: string | null;
  fulfillmentSkills?: string[];
  state?: ProductOrderState;
  localUpdatedAt?: number;
}

export type ProductListingLookup =
  | { source: 'ownedListings'; item: OwnedProductListingRecord }
  | { source: 'directoryCache'; item: ProductDirectoryCacheRecord };

export type ProductOrderLookup =
  | { source: 'buyerOrders'; item: ProductBuyerOrderRecord }
  | { source: 'sellerOrders'; item: ProductSellerOrderRecord };

function emptyState(): ProductState {
  return {
    version: PRODUCT_STATE_SCHEMA_VERSION,
    ownedListings: [],
    directoryCache: [],
    buyerOrders: [],
    sellerOrders: [],
  };
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

function normalizeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function listingSummary(payload: ProductListingPayload) {
  return {
    name: payload.name,
    title: payload.title,
    productType: payload.productType,
    skuCount: payload.skus.length,
    fulfillmentSkills: [...payload.fulfillment.fulfillmentSkills],
  };
}

function normalizeOwnedListing(value: unknown): OwnedProductListingRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<OwnedProductListingRecord>;
  if (!source.payload || !normalizeText(source.listingPinId)) return null;
  const summary = listingSummary(source.payload);
  return {
    listingPinId: normalizeText(source.listingPinId),
    localMetabotSlug: normalizeNullableText(source.localMetabotSlug),
    ...summary,
    payload: source.payload,
    available: source.available !== false,
    revokedAt: source.revokedAt === null ? null : normalizeNumber(source.revokedAt, 0) || null,
    localUpdatedAt: normalizeNumber(source.localUpdatedAt, 0),
  };
}

function normalizeDirectoryItem(value: unknown): ProductDirectoryCacheRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ProductDirectoryCacheRecord>;
  if (!source.payload || !normalizeText(source.listingPinId)) return null;
  const summary = listingSummary(source.payload);
  return {
    listingPinId: normalizeText(source.listingPinId),
    ...summary,
    payload: source.payload,
    sellerGlobalMetaId: normalizeNullableText(source.sellerGlobalMetaId),
    sellerName: normalizeNullableText(source.sellerName),
    online: source.online === true,
    cachedAt: normalizeNumber(source.cachedAt, 0),
  };
}

function normalizeBuyerOrder(value: unknown): ProductBuyerOrderRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ProductBuyerOrderRecord>;
  if (!normalizeText(source.listingPinId) || !normalizeText(source.skuId)) return null;
  return {
    role: 'buyer',
    productOrderPinId: normalizeNullableText(source.productOrderPinId),
    listingPinId: normalizeText(source.listingPinId),
    skuId: normalizeText(source.skuId),
    paymentTxid: normalizeNullableText(source.paymentTxid),
    orderTxid: normalizeNullableText(source.orderTxid),
    sellerGlobalMetaId: normalizeNullableText(source.sellerGlobalMetaId),
    state: source.state || 'created',
    localUpdatedAt: normalizeNumber(source.localUpdatedAt, 0),
  };
}

function normalizeSellerOrder(value: unknown): ProductSellerOrderRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ProductSellerOrderRecord>;
  if (
    !normalizeText(source.productOrderPinId) ||
    !normalizeText(source.listingPinId) ||
    !normalizeText(source.skuId) ||
    !normalizeText(source.paymentTxid)
  ) {
    return null;
  }
  return {
    role: 'seller',
    productOrderPinId: normalizeText(source.productOrderPinId),
    listingPinId: normalizeText(source.listingPinId),
    skuId: normalizeText(source.skuId),
    paymentTxid: normalizeText(source.paymentTxid),
    orderTxid: normalizeNullableText(source.orderTxid),
    buyerGlobalMetaId: normalizeNullableText(source.buyerGlobalMetaId),
    fulfillmentSkills: Array.isArray(source.fulfillmentSkills)
      ? source.fulfillmentSkills.filter((skill): skill is string => typeof skill === 'string')
      : [],
    state: source.state || 'created',
    localUpdatedAt: normalizeNumber(source.localUpdatedAt, 0),
  };
}

function normalizeState(value: ProductState | null): ProductState {
  if (!value || typeof value !== 'object') {
    return emptyState();
  }
  return {
    version: PRODUCT_STATE_SCHEMA_VERSION,
    ownedListings: Array.isArray(value.ownedListings)
      ? value.ownedListings.map(normalizeOwnedListing).filter((entry): entry is OwnedProductListingRecord => Boolean(entry))
      : [],
    directoryCache: Array.isArray(value.directoryCache)
      ? value.directoryCache.map(normalizeDirectoryItem).filter((entry): entry is ProductDirectoryCacheRecord => Boolean(entry))
      : [],
    buyerOrders: Array.isArray(value.buyerOrders)
      ? value.buyerOrders.map(normalizeBuyerOrder).filter((entry): entry is ProductBuyerOrderRecord => Boolean(entry))
      : [],
    sellerOrders: Array.isArray(value.sellerOrders)
      ? value.sellerOrders.map(normalizeSellerOrder).filter((entry): entry is ProductSellerOrderRecord => Boolean(entry))
      : [],
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

function upsertBy<T>(items: T[], predicate: (item: T) => boolean, next: T): T[] {
  const index = items.findIndex(predicate);
  if (index < 0) {
    return [next, ...items];
  }
  return [next, ...items.slice(0, index), ...items.slice(index + 1)];
}

export function createProductStateStore(homeDirOrPaths: string | MetabotPaths): ProductStateStore {
  const paths =
    typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const productsRoot = path.join(paths.runtimeRoot, 'products');
  const productStatePath = path.join(productsRoot, 'products-state.json');

  const ensureLayout = async (): Promise<MetabotPaths> => {
    await ensureRuntimeLayout(paths);
    await fs.mkdir(productsRoot, { recursive: true });
    return paths;
  };

  const store: ProductStateStore = {
    paths,
    productsRoot,
    productStatePath,
    ensureLayout,
    async readState() {
      await ensureLayout();
      return normalizeState(await readJsonFile<ProductState>(productStatePath));
    },
    async writeState(nextState) {
      await ensureLayout();
      const normalized = normalizeState(nextState);
      await writeJsonFileAtomically(productStatePath, normalized);
      return normalized;
    },
    async updateState(updater) {
      await ensureLayout();
      const current = normalizeState(await readJsonFile<ProductState>(productStatePath));
      const next = await updater(current);
      const normalized = normalizeState(next);
      await writeJsonFileAtomically(productStatePath, normalized);
      return normalized;
    },
    async upsertOwnedListing(input) {
      const record: OwnedProductListingRecord = {
        listingPinId: normalizeText(input.listingPinId),
        localMetabotSlug: normalizeNullableText(input.localMetabotSlug),
        ...listingSummary(input.payload),
        payload: input.payload,
        available: input.available !== false,
        revokedAt: input.revokedAt ?? null,
        localUpdatedAt: input.localUpdatedAt ?? Date.now(),
      };
      await this.updateState(state => ({
        ...state,
        ownedListings: upsertBy(
          state.ownedListings,
          item => item.listingPinId === record.listingPinId,
          record,
        ),
      }));
      return record;
    },
    async upsertDirectoryItem(input) {
      const record: ProductDirectoryCacheRecord = {
        listingPinId: normalizeText(input.listingPinId),
        ...listingSummary(input.payload),
        payload: input.payload,
        sellerGlobalMetaId: normalizeNullableText(input.sellerGlobalMetaId),
        sellerName: normalizeNullableText(input.sellerName),
        online: input.online === true,
        cachedAt: input.cachedAt ?? Date.now(),
      };
      await this.updateState(state => ({
        ...state,
        directoryCache: upsertBy(
          state.directoryCache,
          item => item.listingPinId === record.listingPinId,
          record,
        ),
      }));
      return record;
    },
    async upsertBuyerOrder(input) {
      const record: ProductBuyerOrderRecord = {
        role: 'buyer',
        productOrderPinId: normalizeNullableText(input.productOrderPinId),
        listingPinId: normalizeText(input.listingPinId),
        skuId: normalizeText(input.skuId),
        paymentTxid: normalizeNullableText(input.paymentTxid),
        orderTxid: normalizeNullableText(input.orderTxid),
        sellerGlobalMetaId: normalizeNullableText(input.sellerGlobalMetaId),
        state: input.state || 'created',
        localUpdatedAt: input.localUpdatedAt ?? Date.now(),
      };
      await this.updateState(state => ({
        ...state,
        buyerOrders: upsertBy(
          state.buyerOrders,
          item =>
            Boolean(record.productOrderPinId && item.productOrderPinId === record.productOrderPinId) ||
            Boolean(record.paymentTxid && item.paymentTxid === record.paymentTxid) ||
            Boolean(record.orderTxid && item.orderTxid === record.orderTxid),
          record,
        ),
      }));
      return record;
    },
    async upsertSellerOrder(input) {
      const record: ProductSellerOrderRecord = {
        role: 'seller',
        productOrderPinId: normalizeText(input.productOrderPinId),
        listingPinId: normalizeText(input.listingPinId),
        skuId: normalizeText(input.skuId),
        paymentTxid: normalizeText(input.paymentTxid),
        orderTxid: normalizeNullableText(input.orderTxid),
        buyerGlobalMetaId: normalizeNullableText(input.buyerGlobalMetaId),
        fulfillmentSkills: [...(input.fulfillmentSkills || [])],
        state: input.state || 'created',
        localUpdatedAt: input.localUpdatedAt ?? Date.now(),
      };
      await this.updateState(state => ({
        ...state,
        sellerOrders: upsertBy(
          state.sellerOrders,
          item =>
            item.productOrderPinId === record.productOrderPinId ||
            item.paymentTxid === record.paymentTxid ||
            Boolean(record.orderTxid && item.orderTxid === record.orderTxid),
          record,
        ),
      }));
      return record;
    },
    async findListingByPinId(listingPinId) {
      const normalized = normalizeText(listingPinId);
      const state = await this.readState();
      const owned = state.ownedListings.find(item => item.listingPinId === normalized);
      if (owned) return { source: 'ownedListings', item: owned };
      const cached = state.directoryCache.find(item => item.listingPinId === normalized);
      return cached ? { source: 'directoryCache', item: cached } : null;
    },
    async findOrderByProductOrderPinId(productOrderPinId) {
      const normalized = normalizeText(productOrderPinId);
      const state = await this.readState();
      const buyer = state.buyerOrders.find(item => item.productOrderPinId === normalized);
      if (buyer) return { source: 'buyerOrders', item: buyer };
      const seller = state.sellerOrders.find(item => item.productOrderPinId === normalized);
      return seller ? { source: 'sellerOrders', item: seller } : null;
    },
    async findOrderByPaymentTxid(paymentTxid) {
      const normalized = normalizeText(paymentTxid);
      const state = await this.readState();
      const buyer = state.buyerOrders.find(item => item.paymentTxid === normalized);
      if (buyer) return { source: 'buyerOrders', item: buyer };
      const seller = state.sellerOrders.find(item => item.paymentTxid === normalized);
      return seller ? { source: 'sellerOrders', item: seller } : null;
    },
    async findOrderByOrderTxid(orderTxid) {
      const normalized = normalizeText(orderTxid);
      const state = await this.readState();
      const buyer = state.buyerOrders.find(item => item.orderTxid === normalized);
      if (buyer) return { source: 'buyerOrders', item: buyer };
      const seller = state.sellerOrders.find(item => item.orderTxid === normalized);
      return seller ? { source: 'sellerOrders', item: seller } : null;
    },
  };

  return store;
}
