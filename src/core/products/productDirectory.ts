import { normalizeComparableGlobalMetaId } from '../discovery/serviceDirectory';
import {
  decorateRecordsWithOnlineBots,
  decorateRecordsWithSocketPresence,
  type SocketPresenceFailureMode,
} from '../discovery/socketPresenceProjection';
import type { OnlineMetaBotDirectoryItem } from '../discovery/socketPresenceDirectory';
import { PRODUCT_LISTING_PROTOCOL_PATH } from './productPublishChain';
import type { ProductDirectoryCacheRecord, ProductStateStore } from './productStateStore';
import type { ProductListingPayload } from './productTypes';
import { validateProductListingPayload } from './productValidation';

const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_PRODUCT_PAGE_SIZE = 200;
const DEFAULT_PRODUCT_MAX_PAGES = 20;
const DEFAULT_PRODUCT_LIMIT = 20;
const MAX_PRODUCT_LIMIT = 100;
const UNIX_SECONDS_MAX = 10_000_000_000;

export interface ProductDirectoryProduct {
  listingPinId: string;
  name: string;
  title: string;
  productType: ProductListingPayload['productType'];
  skuCount: number;
  payload: ProductListingPayload;
  sellerGlobalMetaId: string | null;
  sellerName: string | null;
  online: boolean;
  lastSeenAt?: number | null;
  lastSeenAgoSeconds?: number | null;
  deviceCount?: number | null;
  cachedAt?: number;
  updatedAt?: number;
}

export interface ProductDirectoryResult {
  products: ProductDirectoryProduct[];
  total: number;
  source: 'cache' | 'chain';
  onlineOnly: boolean;
  cacheUpdatedAt: number | null;
}

export interface ListProductDirectoryOptions {
  productStateStore: ProductStateStore;
  cached?: boolean;
  onlineOnly?: boolean;
  query?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
  chainApiBaseUrl?: string;
  productPageSize?: number;
  productMaxPages?: number;
  socketPresenceApiBaseUrl?: string;
  socketPresenceLimit?: number;
  socketPresenceFailureMode?: SocketPresenceFailureMode;
  onlineBots?: OnlineMetaBotDirectoryItem[];
}

interface ChainProductRow {
  listingPinId: string;
  payload: ProductListingPayload;
  sellerGlobalMetaId: string | null;
  sellerName: string | null;
  updatedAt: number;
}

interface ProductListPage {
  list: Record<string, unknown>[];
  nextCursor: string | null;
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

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = normalizeText(value);
  return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}

function normalizePositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value as number)));
}

function normalizeTimestampMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed < UNIX_SECONDS_MAX ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
}

function parseContentSummary(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function getProductListPage(payload: unknown): ProductListPage {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : {};
  const list = Array.isArray(data.list)
    ? data.list.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
  return {
    list,
    nextCursor: typeof data.nextCursor === 'string' && data.nextCursor.trim() ? data.nextCursor : null,
  };
}

function parseChainProductRow(row: Record<string, unknown>): ChainProductRow | null {
  const listingPinId = normalizeText(row.id ?? row.pinId ?? row.pinID);
  const payloadResult = validateProductListingPayload(parseContentSummary(row.contentSummary ?? row.content));
  if (!listingPinId || !payloadResult.ok) return null;

  return {
    listingPinId,
    payload: payloadResult.value,
    sellerGlobalMetaId: normalizeComparableGlobalMetaId(
      row.globalMetaId
        ?? row.createGlobalMetaId
        ?? row.creatorGlobalMetaId
        ?? row.createMetaId
        ?? row.metaid
        ?? row.createAddress
    ) || null,
    sellerName: normalizeNullableText(
      row.sellerName
        ?? row.name
        ?? row.userName
        ?? row.displayName
        ?? (row.userInfo && typeof row.userInfo === 'object'
          ? (row.userInfo as Record<string, unknown>).name
          : undefined)
    ),
    updatedAt: normalizeTimestampMs(row.timestamp ?? row.updatedAt ?? row.createdAt) || Date.now(),
  };
}

async function fetchChainProductRows(options: ListProductDirectoryOptions): Promise<ChainProductRow[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const chainApiBaseUrl = normalizeBaseUrl(options.chainApiBaseUrl);
  const pageSize = normalizePositiveInteger(options.productPageSize, DEFAULT_PRODUCT_PAGE_SIZE, DEFAULT_PRODUCT_PAGE_SIZE);
  const maxPages = normalizePositiveInteger(options.productMaxPages, DEFAULT_PRODUCT_MAX_PAGES, DEFAULT_PRODUCT_MAX_PAGES);
  const rows: Array<ChainProductRow | null> = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${chainApiBaseUrl}/pin/path/list`);
    url.searchParams.set('path', PRODUCT_LISTING_PROTOCOL_PATH);
    url.searchParams.set('size', String(pageSize));
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(`product_directory_http_${response.status}`);
    }
    const payload = await response.json() as unknown;
    const productPage = getProductListPage(payload);
    rows.push(...productPage.list.map((item) => parseChainProductRow(item)));
    if (!productPage.nextCursor || seenCursors.has(productPage.nextCursor)) {
      break;
    }
    seenCursors.add(productPage.nextCursor);
    cursor = productPage.nextCursor;
  }

  const currentByListingPinId = new Map<string, ChainProductRow>();
  for (const row of rows) {
    if (!row) continue;
    const existing = currentByListingPinId.get(row.listingPinId);
    if (!existing || row.updatedAt >= existing.updatedAt) {
      currentByListingPinId.set(row.listingPinId, row);
    }
  }
  return [...currentByListingPinId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt || right.listingPinId.localeCompare(left.listingPinId));
}

function fromCacheRecord(record: ProductDirectoryCacheRecord): ProductDirectoryProduct {
  return {
    listingPinId: record.listingPinId,
    name: record.name,
    title: record.title,
    productType: record.productType,
    skuCount: record.skuCount,
    payload: record.payload,
    sellerGlobalMetaId: record.sellerGlobalMetaId,
    sellerName: record.sellerName,
    online: record.online,
    cachedAt: record.cachedAt,
  };
}

function fromChainRow(row: ChainProductRow): ProductDirectoryProduct {
  return {
    listingPinId: row.listingPinId,
    name: row.payload.name,
    title: row.payload.title,
    productType: row.payload.productType,
    skuCount: row.payload.skus.length,
    payload: row.payload,
    sellerGlobalMetaId: row.sellerGlobalMetaId,
    sellerName: row.sellerName,
    online: false,
    updatedAt: row.updatedAt,
  };
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
    ]),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function projectProductDirectory(input: {
  products: ProductDirectoryProduct[];
  onlineOnly?: boolean;
  query?: string;
  limit?: number;
}): ProductDirectoryProduct[] {
  const query = normalizeText(input.query).toLowerCase();
  const limit = normalizePositiveInteger(input.limit, DEFAULT_PRODUCT_LIMIT, MAX_PRODUCT_LIMIT);
  return input.products
    .filter((product) => input.onlineOnly === true ? product.online : true)
    .filter((product) => query ? searchableText(product).includes(query) : true)
    .slice(0, limit);
}

async function decorateProducts(
  products: ProductDirectoryProduct[],
  options: ListProductDirectoryOptions,
): Promise<ProductDirectoryProduct[]> {
  if (options.onlineBots) {
    return decorateRecordsWithOnlineBots({
      records: products.map((product) => ({
        ...product,
        providerGlobalMetaId: product.sellerGlobalMetaId,
      })),
      onlineBots: options.onlineBots,
      onlineOnly: false,
    }).map((product) => {
      const { providerGlobalMetaId: _providerGlobalMetaId, providerName, ...rest } = product as ProductDirectoryProduct & {
        providerGlobalMetaId?: string | null;
        providerName?: string;
      };
      return {
        ...rest,
        sellerName: rest.sellerName || providerName || null,
      };
    });
  }

  if (options.cached === true) {
    return products;
  }

  return decorateRecordsWithSocketPresence(
    products.map((product) => ({
      ...product,
      providerGlobalMetaId: product.sellerGlobalMetaId,
    })),
    {
      fetchImpl: options.fetchImpl,
      socketPresenceApiBaseUrl: options.socketPresenceApiBaseUrl,
      socketPresenceLimit: options.socketPresenceLimit,
      socketPresenceFailureMode: options.socketPresenceFailureMode,
      onlineOnly: false,
    },
  ).then((decorated) => decorated.map((product) => {
    const { providerGlobalMetaId: _providerGlobalMetaId, providerName, ...rest } = product as ProductDirectoryProduct & {
      providerGlobalMetaId?: string | null;
      providerName?: string;
    };
    return {
      ...rest,
      sellerName: rest.sellerName || providerName || null,
    };
  }));
}

function cacheUpdatedAt(products: ProductDirectoryProduct[]): number | null {
  const values = products
    .map((product) => product.cachedAt)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

async function readCachedProducts(productStateStore: ProductStateStore): Promise<ProductDirectoryProduct[]> {
  const state = await productStateStore.readState();
  return state.directoryCache.map(fromCacheRecord);
}

export async function listProductDirectory(
  options: ListProductDirectoryOptions,
): Promise<ProductDirectoryResult> {
  const onlineOnly = options.onlineOnly === true;
  let source: 'cache' | 'chain' = options.cached === true ? 'cache' : 'chain';
  let products: ProductDirectoryProduct[];

  if (options.cached === true) {
    products = await readCachedProducts(options.productStateStore);
  } else {
    try {
      const chainRows = await fetchChainProductRows(options);
      const decorated = await decorateProducts(chainRows.map(fromChainRow), options);
      const cached = [];
      for (const product of decorated) {
        cached.push(await options.productStateStore.upsertDirectoryItem({
          listingPinId: product.listingPinId,
          payload: product.payload,
          sellerGlobalMetaId: product.sellerGlobalMetaId,
          sellerName: product.sellerName,
          online: product.online,
          cachedAt: Date.now(),
        }));
      }
      products = cached.map(fromCacheRecord).map((product) => {
        const decoratedProduct = decorated.find((item) => item.listingPinId === product.listingPinId);
        return decoratedProduct ? { ...product, ...decoratedProduct, cachedAt: product.cachedAt } : product;
      });
    } catch (error) {
      const cachedProducts = await readCachedProducts(options.productStateStore);
      if (cachedProducts.length === 0) {
        throw error;
      }
      products = cachedProducts;
      source = 'cache';
    }
  }

  const decoratedProducts = options.cached === true
    ? await decorateProducts(products, options)
    : products;
  const filteredProducts = projectProductDirectory({
    products: decoratedProducts,
    onlineOnly,
    query: options.query,
    limit: options.limit,
  });

  return {
    products: filteredProducts,
    total: decoratedProducts
      .filter((product) => onlineOnly ? product.online : true)
      .filter((product) => normalizeText(options.query) ? searchableText(product).includes(normalizeText(options.query).toLowerCase()) : true)
      .length,
    source,
    onlineOnly,
    cacheUpdatedAt: cacheUpdatedAt(products),
  };
}
