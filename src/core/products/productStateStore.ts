import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import { resolveMetabotPaths } from '../state/paths';
import { ensureRuntimeLayout } from '../state/runtimeStateStore';
import type {
  ProductListingPayload,
  ProductOrderPayload,
  ProductOrderState,
  ProductSku,
} from './productTypes';
import { validateProductListingPayload, validateProductOrderPayload } from './productValidation';

const PRODUCT_STATE_SCHEMA_VERSION = 1;
const LOCKFILE_BASE_DELAY_MS = 25;
const LOCKFILE_MAX_ATTEMPTS = 200;
const LOCKFILE_STALE_WITH_PID_MS = 5 * 60 * 1000;
const LOCKFILE_STALE_WITHOUT_PID_MS = 30_000;

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
  sellerMvcAddress: string | null;
  sellerChatPublicKey: string | null;
  online: boolean;
  cachedAt: number;
}

export interface ProductDeliverySummary {
  result: string | null;
  deliveryPinId: string | null;
  deliveredAt: number | null;
}

export interface ProductBuyerOrderRecord {
  role: 'buyer';
  productOrderPinId: string | null;
  listingPinId: string;
  skuId: string;
  paymentTxid: string | null;
  orderTxid: string | null;
  sellerGlobalMetaId: string | null;
  buyerGlobalMetaId: string | null;
  traceId: string | null;
  sessionId: string | null;
  deliverySummary: ProductDeliverySummary | null;
  state: ProductOrderState;
  localUpdatedAt: number;
}

export interface ProductSellerOrderRecord {
  role: 'seller';
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
  productOrderPayload: ProductOrderPayload | null;
  orderTxid: string | null;
  buyerGlobalMetaId: string | null;
  fulfillmentSkills: string[];
  paymentVerified: boolean | null;
  selectedSku: ProductSku | null;
  fulfillmentState: ProductOrderState | null;
  deliveryPinId: string | null;
  deliverySummary: ProductDeliverySummary | null;
  failureReason: string | null;
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
  claimSellerOrderFulfillment(input: ClaimSellerOrderFulfillmentInput): Promise<ClaimSellerOrderFulfillmentResult>;
  findListingByPinId(listingPinId: string): Promise<ProductListingLookup | null>;
  listOrders(): Promise<ProductOrderLookup[]>;
  findOrderByOrderId(orderId: string): Promise<ProductOrderLookup | null>;
  findOrderByProductOrderPinId(productOrderPinId: string): Promise<ProductOrderLookup | null>;
  findSellerOrderByProductOrderPinId(productOrderPinId: string): Promise<ProductSellerOrderLookup | null>;
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
  sellerMvcAddress?: string | null;
  sellerChatPublicKey?: string | null;
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
  buyerGlobalMetaId?: string | null;
  traceId?: string | null;
  sessionId?: string | null;
  deliverySummary?: ProductDeliverySummary | null;
  state?: ProductOrderState;
  localUpdatedAt?: number;
}

export interface UpsertSellerOrderInput {
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
  productOrderPayload?: ProductOrderPayload | null;
  orderTxid?: string | null;
  buyerGlobalMetaId?: string | null;
  fulfillmentSkills?: string[];
  paymentVerified?: boolean | null;
  selectedSku?: ProductSku | null;
  fulfillmentState?: ProductOrderState | null;
  deliveryPinId?: string | null;
  deliverySummary?: ProductDeliverySummary | null;
  failureReason?: string | null;
  state?: ProductOrderState;
  localUpdatedAt?: number;
}

export interface ClaimSellerOrderFulfillmentInput {
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
  productOrderPayload?: ProductOrderPayload | null;
  orderTxid: string;
  buyerGlobalMetaId?: string | null;
  fulfillmentSkills?: string[];
  selectedSku?: ProductSku | null;
  localUpdatedAt?: number;
}

export type ClaimSellerOrderFulfillmentResult =
  | { status: 'claimed'; record: ProductSellerOrderRecord }
  | { status: 'duplicate_delivered'; record: ProductSellerOrderRecord }
  | { status: 'in_progress'; record: ProductSellerOrderRecord };

export type ProductListingLookup =
  | { source: 'ownedListings'; item: OwnedProductListingRecord }
  | { source: 'directoryCache'; item: ProductDirectoryCacheRecord };

export type ProductOrderLookup =
  | { source: 'buyerOrders'; item: ProductBuyerOrderRecord }
  | { source: 'sellerOrders'; item: ProductSellerOrderRecord };

export type ProductSellerOrderLookup = { source: 'sellerOrders'; item: ProductSellerOrderRecord };

export function getProductOrderRecordId(record: ProductBuyerOrderRecord | ProductSellerOrderRecord): string {
  return normalizeText(record.productOrderPinId)
    || normalizeText(record.orderTxid)
    || normalizeText(record.paymentTxid)
    || `${record.role}:${record.listingPinId}:${record.skuId}:${record.localUpdatedAt}`;
}

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

function normalizeNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
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

function normalizeListingPayload(value: unknown): ProductListingPayload | null {
  const result = validateProductListingPayload(value);
  return result.ok ? result.value : null;
}

function normalizeProductOrderPayload(value: unknown): ProductOrderPayload | null {
  const result = validateProductOrderPayload(value);
  return result.ok ? result.value : null;
}

function requireListingPayload(value: unknown): ProductListingPayload {
  const result = validateProductListingPayload(value);
  if (!result.ok) {
    throw new Error(`Invalid product listing payload: ${result.code}`);
  }
  return result.value;
}

function requireText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function normalizeOwnedListing(value: unknown): OwnedProductListingRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<OwnedProductListingRecord>;
  const listingPinId = normalizeText(source.listingPinId);
  const payload = normalizeListingPayload(source.payload);
  if (!listingPinId || !payload) return null;
  const summary = listingSummary(payload);
  return {
    listingPinId,
    localMetabotSlug: normalizeNullableText(source.localMetabotSlug),
    ...summary,
    payload,
    available: source.available !== false,
    revokedAt: source.revokedAt === null ? null : normalizeNumber(source.revokedAt, 0) || null,
    localUpdatedAt: normalizeNumber(source.localUpdatedAt, 0),
  };
}

function normalizeDirectoryItem(value: unknown): ProductDirectoryCacheRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ProductDirectoryCacheRecord>;
  const listingPinId = normalizeText(source.listingPinId);
  const payload = normalizeListingPayload(source.payload);
  if (!listingPinId || !payload) return null;
  const summary = listingSummary(payload);
  return {
    listingPinId,
    ...summary,
    payload,
    sellerGlobalMetaId: normalizeNullableText(source.sellerGlobalMetaId),
    sellerName: normalizeNullableText(source.sellerName),
    sellerMvcAddress: normalizeNullableText(source.sellerMvcAddress),
    sellerChatPublicKey: normalizeNullableText(source.sellerChatPublicKey),
    online: source.online === true,
    cachedAt: normalizeNumber(source.cachedAt, 0),
  };
}

function normalizeDeliverySummary(value: unknown): ProductDeliverySummary | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ProductDeliverySummary>;
  const result = normalizeNullableText(source.result);
  const deliveryPinId = normalizeNullableText(source.deliveryPinId);
  const deliveredAt = normalizeNullableNumber(source.deliveredAt);
  if (!result && !deliveryPinId && deliveredAt === null) return null;
  return {
    result,
    deliveryPinId,
    deliveredAt,
  };
}

function normalizeSelectedSku(value: unknown): ProductSku | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ProductSku>;
  if (!normalizeText(source.skuId)) return null;
  return source as ProductSku;
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
    buyerGlobalMetaId: normalizeNullableText(source.buyerGlobalMetaId),
    traceId: normalizeNullableText(source.traceId),
    sessionId: normalizeNullableText(source.sessionId),
    deliverySummary: normalizeDeliverySummary(source.deliverySummary),
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
    productOrderPayload: normalizeProductOrderPayload(source.productOrderPayload),
    orderTxid: normalizeNullableText(source.orderTxid),
    buyerGlobalMetaId: normalizeNullableText(source.buyerGlobalMetaId),
    fulfillmentSkills: Array.isArray(source.fulfillmentSkills)
      ? source.fulfillmentSkills.filter((skill): skill is string => typeof skill === 'string')
      : [],
    paymentVerified: normalizeNullableBoolean(source.paymentVerified),
    selectedSku: normalizeSelectedSku(source.selectedSku),
    fulfillmentState: source.fulfillmentState || null,
    deliveryPinId: normalizeNullableText(source.deliveryPinId),
    deliverySummary: normalizeDeliverySummary(source.deliverySummary),
    failureReason: normalizeNullableText(source.failureReason),
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
  let handle: fs.FileHandle | null = null;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    handle = await fs.open(tempPath, 'w');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
    try {
      const directoryHandle = await fs.open(path.dirname(filePath), 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EINVAL' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EBADF') {
        throw error;
      }
    }
  } catch (error) {
    if (handle) {
      await handle.close();
    }
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

async function readLockInfo(filePath: string): Promise<{ pid?: number; acquiredAt?: number } | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown; acquiredAt?: unknown };
    return {
      pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
      acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : undefined,
    };
  } catch {
    return null;
  }
}

async function withLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < LOCKFILE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`, 'utf8');
        return await operation();
      } finally {
        await handle.close();
        try {
          await fs.rm(lockPath, { force: true });
        } catch {
          // Best effort cleanup; stale lock recovery handles leftover lock files later.
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
      try {
        const lockInfo = await readLockInfo(lockPath);
        const stat = await fs.stat(lockPath);
        const lockPid = typeof lockInfo?.pid === 'number' ? lockInfo.pid : null;
        const acquiredAt =
          typeof lockInfo?.acquiredAt === 'number' ? lockInfo.acquiredAt : stat.mtimeMs;
        const ownerAlive = lockPid ? isProcessAlive(lockPid) : false;
        if (lockPid && !ownerAlive) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
        const staleThreshold = lockPid ? LOCKFILE_STALE_WITH_PID_MS : LOCKFILE_STALE_WITHOUT_PID_MS;
        const stale = Date.now() - acquiredAt > staleThreshold;
        if (!lockPid && stale) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch {
        // Another writer may have released the lock between stat/remove attempts.
      }
      await sleep(Math.min(LOCKFILE_BASE_DELAY_MS * (attempt + 1), 250));
    }
  }
  throw new Error(`Timed out acquiring product-state lock: ${lockPath}`);
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
  const lockPath = path.join(paths.locksRoot, 'product-state.lock');
  let pendingWrite = Promise.resolve();

  const ensureLayout = async (): Promise<MetabotPaths> => {
    await ensureRuntimeLayout(paths);
    await fs.mkdir(productsRoot, { recursive: true });
    return paths;
  };

  const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = pendingWrite.then(
      async () => {
        await ensureLayout();
        return withLock(lockPath, operation);
      },
      async () => {
        await ensureLayout();
        return withLock(lockPath, operation);
      },
    );
    pendingWrite = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
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
      return runExclusive(async () => {
        await ensureLayout();
        const normalized = normalizeState(nextState);
        await writeJsonFileAtomically(productStatePath, normalized);
        return normalized;
      });
    },
    async updateState(updater) {
      return runExclusive(async () => {
        await ensureLayout();
        const current = normalizeState(await readJsonFile<ProductState>(productStatePath));
        const next = await updater(current);
        const normalized = normalizeState(next);
        await writeJsonFileAtomically(productStatePath, normalized);
        return normalized;
      });
    },
    async upsertOwnedListing(input) {
      const listingPinId = requireText(input.listingPinId, 'listingPinId');
      const payload = requireListingPayload(input.payload);
      const record: OwnedProductListingRecord = {
        listingPinId,
        localMetabotSlug: normalizeNullableText(input.localMetabotSlug),
        ...listingSummary(payload),
        payload,
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
      const listingPinId = requireText(input.listingPinId, 'listingPinId');
      const payload = requireListingPayload(input.payload);
      const record: ProductDirectoryCacheRecord = {
        listingPinId,
        ...listingSummary(payload),
        payload,
        sellerGlobalMetaId: normalizeNullableText(input.sellerGlobalMetaId),
        sellerName: normalizeNullableText(input.sellerName),
        sellerMvcAddress: normalizeNullableText(input.sellerMvcAddress),
        sellerChatPublicKey: normalizeNullableText(input.sellerChatPublicKey),
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
      const listingPinId = requireText(input.listingPinId, 'listingPinId');
      const skuId = requireText(input.skuId, 'skuId');
      const record: ProductBuyerOrderRecord = {
        role: 'buyer',
        productOrderPinId: normalizeNullableText(input.productOrderPinId),
        listingPinId,
        skuId,
        paymentTxid: normalizeNullableText(input.paymentTxid),
        orderTxid: normalizeNullableText(input.orderTxid),
        sellerGlobalMetaId: normalizeNullableText(input.sellerGlobalMetaId),
        buyerGlobalMetaId: normalizeNullableText(input.buyerGlobalMetaId),
        traceId: normalizeNullableText(input.traceId),
        sessionId: normalizeNullableText(input.sessionId),
        deliverySummary: normalizeDeliverySummary(input.deliverySummary),
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
      const productOrderPinId = requireText(input.productOrderPinId, 'productOrderPinId');
      const listingPinId = requireText(input.listingPinId, 'listingPinId');
      const skuId = requireText(input.skuId, 'skuId');
      const paymentTxid = requireText(input.paymentTxid, 'paymentTxid');
      const record: ProductSellerOrderRecord = {
        role: 'seller',
        productOrderPinId,
        listingPinId,
        skuId,
        paymentTxid,
        productOrderPayload: normalizeProductOrderPayload(input.productOrderPayload),
        orderTxid: normalizeNullableText(input.orderTxid),
        buyerGlobalMetaId: normalizeNullableText(input.buyerGlobalMetaId),
        fulfillmentSkills: [...(input.fulfillmentSkills || [])],
        paymentVerified: normalizeNullableBoolean(input.paymentVerified),
        selectedSku: normalizeSelectedSku(input.selectedSku),
        fulfillmentState: input.fulfillmentState || null,
        deliveryPinId: normalizeNullableText(input.deliveryPinId),
        deliverySummary: normalizeDeliverySummary(input.deliverySummary),
        failureReason: normalizeNullableText(input.failureReason),
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
    async claimSellerOrderFulfillment(input) {
      const productOrderPinId = requireText(input.productOrderPinId, 'productOrderPinId');
      const listingPinId = requireText(input.listingPinId, 'listingPinId');
      const skuId = requireText(input.skuId, 'skuId');
      const paymentTxid = requireText(input.paymentTxid, 'paymentTxid');
      const orderTxid = requireText(input.orderTxid, 'orderTxid');
      let result: ClaimSellerOrderFulfillmentResult | null = null;
      await this.updateState(state => {
        const existing = state.sellerOrders.find(item => item.productOrderPinId === productOrderPinId) ?? null;
        const samePurchase = Boolean(existing) && existing?.paymentTxid === paymentTxid;
        if (
          samePurchase &&
          existing?.state === 'delivered' &&
          (existing.deliveryPinId || existing.deliverySummary?.deliveryPinId)
        ) {
          result = { status: 'duplicate_delivered', record: existing };
          return state;
        }
        if (samePurchase && existing?.state === 'fulfilling') {
          result = { status: 'in_progress', record: existing };
          return state;
        }
        const record: ProductSellerOrderRecord = {
          role: 'seller',
          productOrderPinId,
          listingPinId,
          skuId,
          paymentTxid,
          productOrderPayload: normalizeProductOrderPayload(input.productOrderPayload),
          orderTxid: normalizeNullableText(existing?.orderTxid ?? orderTxid),
          buyerGlobalMetaId: normalizeNullableText(input.buyerGlobalMetaId),
          fulfillmentSkills: [...(input.fulfillmentSkills || [])],
          paymentVerified: null,
          selectedSku: normalizeSelectedSku(input.selectedSku),
          fulfillmentState: 'fulfilling',
          deliveryPinId: null,
          deliverySummary: null,
          failureReason: null,
          state: 'fulfilling',
          localUpdatedAt: input.localUpdatedAt ?? Date.now(),
        };
        result = { status: 'claimed', record };
        return {
          ...state,
          sellerOrders: upsertBy(
            state.sellerOrders,
            item => item.productOrderPinId === record.productOrderPinId,
            record,
          ),
        };
      });
      if (!result) {
        throw new Error('Seller order fulfillment claim did not produce a result.');
      }
      return result;
    },
    async findListingByPinId(listingPinId) {
      const normalized = normalizeText(listingPinId);
      const state = await this.readState();
      const owned = state.ownedListings.find(item => item.listingPinId === normalized);
      if (owned) return { source: 'ownedListings', item: owned };
      const cached = state.directoryCache.find(item => item.listingPinId === normalized);
      return cached ? { source: 'directoryCache', item: cached } : null;
    },
    async listOrders() {
      const state = await this.readState();
      return [
        ...state.buyerOrders.map(item => ({ source: 'buyerOrders' as const, item })),
        ...state.sellerOrders.map(item => ({ source: 'sellerOrders' as const, item })),
      ];
    },
    async findOrderByOrderId(orderId) {
      const normalized = normalizeText(orderId);
      const orders = await this.listOrders();
      return orders.find(order => getProductOrderRecordId(order.item) === normalized) ?? null;
    },
    async findOrderByProductOrderPinId(productOrderPinId) {
      const normalized = normalizeText(productOrderPinId);
      const state = await this.readState();
      const buyer = state.buyerOrders.find(item => item.productOrderPinId === normalized);
      if (buyer) return { source: 'buyerOrders', item: buyer };
      const seller = state.sellerOrders.find(item => item.productOrderPinId === normalized);
      return seller ? { source: 'sellerOrders', item: seller } : null;
    },
    async findSellerOrderByProductOrderPinId(productOrderPinId) {
      const normalized = normalizeText(productOrderPinId);
      const state = await this.readState();
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
