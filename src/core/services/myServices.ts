import type { RuntimeIdentityRecord } from '../state/runtimeStateStore';
import type { SellerOrderRecord } from '../orders/sellerOrderState';
import type { RatingDetailItem } from '../ratings/ratingDetailState';
import {
  resolvePublishedServiceSettlement,
  type PublishedServiceDraft,
  type PublishedServiceRecord,
} from './publishService';

export type MyServiceMutationAction = 'modify' | 'revoke';

export interface MyServicesProfileInput {
  slug: string;
  name: string;
  homeDir?: string | null;
  identity: RuntimeIdentityRecord | null;
  services: PublishedServiceRecord[];
  sellerOrders: SellerOrderRecord[];
  ratingDetails: RatingDetailItem[];
}

export interface MyServiceSummary {
  id: string;
  currentPinId: string;
  sourceServicePinId: string;
  chainPinIds: string[];
  serviceName: string;
  displayName: string;
  description: string;
  price: string;
  currency: string;
  paymentChain: string | null;
  settlementKind: string | null;
  mrc20Ticker: string | null;
  mrc20Id: string | null;
  providerGlobalMetaId: string;
  providerAddress: string;
  paymentAddress: string;
  serviceIcon: string | null;
  providerSkill: string | null;
  outputType: string | null;
  creatorMetabotId: number | null;
  creatorMetabotSlug: string;
  creatorMetabotName: string;
  creatorMetabotHomeDir: string;
  canModify: boolean;
  canRevoke: boolean;
  blockedReason: string | null;
  successCount: number;
  refundCount: number;
  grossRevenue: string;
  netIncome: string;
  ratingAvg: number;
  ratingCount: number;
  updatedAt: number;
}

export interface MyServiceOrderRating {
  pinId?: string | null;
  rate: number;
  comment: string | null;
  createdAt: number | null;
  raterGlobalMetaId: string | null;
  raterMetaId: string | null;
}

export interface MyServiceOrderDetail {
  id: string;
  status: string;
  traceId: string;
  paymentTxid: string | null;
  orderMessageTxid: string | null;
  paymentAmount: string;
  paymentCurrency: string;
  servicePinId: string | null;
  createdAt: number | null;
  deliveredAt: number | null;
  refundCompletedAt: number | null;
  counterpartyGlobalMetaid: string | null;
  counterpartyName?: string | null;
  counterpartyAvatar?: string | null;
  coworkSessionId: string | null;
  runtimeId: string | null;
  runtimeProvider: string | null;
  llmSessionId: string | null;
  rating: MyServiceOrderRating | null;
}

export interface MyServicePageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface MyServiceMutationTarget {
  profileSlug: string;
  profileName: string;
  profileHomeDir: string;
  identity: RuntimeIdentityRecord | null;
  service: PublishedServiceRecord | null;
}

export interface MyServiceMutationValidationResult {
  ok: boolean;
  error?: string;
  errorCode?: string;
  creatorMetabotId?: number;
}

const DECIMAL_SCALE = 8n;
const DECIMAL_MULTIPLIER = 10n ** DECIMAL_SCALE;
const CLOSED_ORDER_STATES = new Set(['completed', 'refunded']);

function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
}

function toSafeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalNumber(value: unknown): number | null {
  const parsed = toSafeNumber(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDecimalToUnits(value: unknown): bigint {
  const normalized = toSafeString(value);
  if (!normalized) return 0n;
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return 0n;
  const sign = match[1] === '-' ? -1n : 1n;
  const integerPart = BigInt(match[2] || '0');
  const fractionPart = (match[3] || '')
    .slice(0, Number(DECIMAL_SCALE))
    .padEnd(Number(DECIMAL_SCALE), '0');
  return sign * ((integerPart * DECIMAL_MULTIPLIER) + BigInt(fractionPart || '0'));
}

function formatUnitsToDecimal(units: bigint): string {
  const sign = units < 0n ? '-' : '';
  const absolute = units < 0n ? -units : units;
  const integerPart = absolute / DECIMAL_MULTIPLIER;
  const fractionPart = (absolute % DECIMAL_MULTIPLIER)
    .toString()
    .padStart(Number(DECIMAL_SCALE), '0')
    .replace(/0+$/u, '');
  return fractionPart ? `${sign}${integerPart.toString()}.${fractionPart}` : `${sign}${integerPart.toString()}`;
}

function createPageResult<T>(items: T[], page: number, pageSize: number): MyServicePageResult<T> {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : Math.max(1, items.length);
  const total = items.length;
  const totalPages = total > 0 ? Math.ceil(total / normalizedPageSize) : 0;
  const start = (normalizedPage - 1) * normalizedPageSize;
  return {
    items: items.slice(start, start + normalizedPageSize),
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total,
    totalPages,
  };
}

function getServicePinIds(service: Partial<PublishedServiceRecord>): string[] {
  return [...new Set([
    ...(Array.isArray(service.chainPinIds) ? service.chainPinIds : []),
    service.sourceServicePinId,
    service.id,
    service.currentPinId,
  ].map(toSafeString).filter(Boolean))];
}

function isServiceVisible(service: PublishedServiceRecord): boolean {
  if (toSafeNumber(service.revokedAt) > 0) return false;
  return service.available !== 0;
}

function isClosedOrder(order: SellerOrderRecord): boolean {
  return CLOSED_ORDER_STATES.has(toSafeString(order.state));
}

function getOrderServicePinCandidates(order: SellerOrderRecord): string[] {
  return [...new Set([
    order.servicePinId,
    order.currentServicePinId,
  ].map(toSafeString).filter(Boolean))];
}

function orderMatchesService(order: SellerOrderRecord, servicePinIds: Set<string>): boolean {
  return getOrderServicePinCandidates(order).some((pinId) => servicePinIds.has(pinId));
}

function getOrderFinalizedAt(order: SellerOrderRecord): number {
  if (order.state === 'refunded') {
    return toSafeNumber(order.refundCompletedAt ?? order.refundedAt ?? order.updatedAt ?? order.createdAt);
  }
  return toSafeNumber(order.deliveredAt ?? order.updatedAt ?? order.createdAt);
}

function sortByUpdatedDesc<T extends { updatedAt?: number; currentPinId?: string; id?: string }>(left: T, right: T): number {
  const updatedSort = toSafeNumber(right.updatedAt) - toSafeNumber(left.updatedAt);
  if (updatedSort !== 0) return updatedSort;
  return toSafeString(right.currentPinId ?? right.id).localeCompare(toSafeString(left.currentPinId ?? left.id));
}

function sortOrdersDesc(left: SellerOrderRecord, right: SellerOrderRecord): number {
  const finalizedSort = getOrderFinalizedAt(right) - getOrderFinalizedAt(left);
  if (finalizedSort !== 0) return finalizedSort;
  if (left.state !== right.state) {
    return left.state === 'refunded' ? -1 : 1;
  }
  const updatedSort = toSafeNumber(right.updatedAt) - toSafeNumber(left.updatedAt);
  if (updatedSort !== 0) return updatedSort;
  return toSafeString(right.id).localeCompare(toSafeString(left.id));
}

function pickRatingDetail(
  ratings: RatingDetailItem[],
  paymentTxid: string,
  counterpartyGlobalMetaid?: string | null,
): MyServiceOrderRating | null {
  const normalizedPaymentTxid = toSafeString(paymentTxid);
  if (!normalizedPaymentTxid) return null;
  const buyerGlobalMetaId = toSafeString(counterpartyGlobalMetaid);
  const candidates = ratings
    .filter((rating) => toSafeString(rating.servicePaidTx) === normalizedPaymentTxid)
    .sort((left, right) => toSafeNumber(right.createdAt) - toSafeNumber(left.createdAt));
  const selected = buyerGlobalMetaId
    ? candidates.find((rating) => toSafeString(rating.raterGlobalMetaId) === buyerGlobalMetaId) ?? candidates[0]
    : candidates[0];
  if (!selected) return null;
  const rate = toSafeNumber(selected.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    pinId: toSafeString(selected.pinId) || null,
    rate,
    comment: toSafeString(selected.comment) || null,
    createdAt: selected.createdAt == null ? null : toSafeNumber(selected.createdAt),
    raterGlobalMetaId: toSafeString(selected.raterGlobalMetaId) || null,
    raterMetaId: toSafeString(selected.raterMetaId) || null,
  };
}

function buildRatingIndex(profile: MyServicesProfileInput, servicePinIds: Set<string>): RatingDetailItem[] {
  return profile.ratingDetails.filter((rating) => servicePinIds.has(toSafeString(rating.serviceId)));
}

function getPaymentAddress(identity: RuntimeIdentityRecord | null, currency: string, fallback: string): string {
  const normalizedCurrency = toSafeString(currency).toUpperCase();
  const addresses = identity?.addresses ?? {};
  if (normalizedCurrency === 'BTC') return toSafeString(addresses.btc) || fallback;
  if (normalizedCurrency === 'DOGE') return toSafeString(addresses.doge) || fallback;
  if (normalizedCurrency === 'BTC-OPCAT') return toSafeString(addresses.opcat) || toSafeString(addresses.btc) || fallback;
  return toSafeString(addresses.mvc) || toSafeString(identity?.mvcAddress) || fallback;
}

export function buildMyServiceSummaries(input: {
  profiles: MyServicesProfileInput[];
  page: number;
  pageSize: number;
}): MyServicePageResult<MyServiceSummary> {
  const summaries: MyServiceSummary[] = [];

  for (const profile of input.profiles) {
    const identity = profile.identity;
    const profileGlobalMetaId = toSafeString(identity?.globalMetaId);
    for (const service of profile.services.filter(isServiceVisible).sort(sortByUpdatedDesc)) {
      const providerGlobalMetaId = toSafeString(service.providerGlobalMetaId);
      if (profileGlobalMetaId && providerGlobalMetaId && providerGlobalMetaId !== profileGlobalMetaId) {
        continue;
      }

      const chainPinIds = getServicePinIds(service);
      const servicePinIdSet = new Set(chainPinIds);
      const closedOrders = profile.sellerOrders
        .filter(isClosedOrder)
        .filter((order) => orderMatchesService(order, servicePinIdSet));
      let successCount = 0;
      let refundCount = 0;
      let grossRevenueUnits = 0n;
      let netIncomeUnits = 0n;
      for (const order of closedOrders) {
        const amountUnits = parseDecimalToUnits(order.paymentAmount);
        grossRevenueUnits += amountUnits;
        if (order.state === 'completed') {
          successCount += 1;
          netIncomeUnits += amountUnits;
        } else if (order.state === 'refunded') {
          refundCount += 1;
        }
      }

      const ratings = buildRatingIndex(profile, servicePinIdSet)
        .map((rating) => toSafeNumber(rating.rate))
        .filter((rate) => Number.isFinite(rate) && rate > 0);
      const ratingCount = ratings.length;
      const ratingAvg = ratingCount > 0
        ? ratings.reduce((sum, rate) => sum + rate, 0) / ratingCount
        : 0;
      const currentPinId = toSafeString(service.currentPinId) || toSafeString(service.id);
      const sourceServicePinId = toSafeString(service.sourceServicePinId) || currentPinId;
      const creatorMetabotId = Number.isFinite(service.creatorMetabotId) && service.creatorMetabotId > 0
        ? Math.trunc(service.creatorMetabotId)
        : null;
      const mutation = validateMyServiceMutation({
        action: 'modify',
        target: {
          profileSlug: toSafeString(profile.slug),
          profileName: toSafeString(profile.name),
          profileHomeDir: toSafeString(profile.homeDir),
          identity,
          service,
        },
      });

      summaries.push({
        id: currentPinId,
        currentPinId,
        sourceServicePinId,
        chainPinIds,
        serviceName: toSafeString(service.serviceName),
        displayName: toSafeString(service.displayName) || toSafeString(service.serviceName) || 'Service',
        description: toSafeString(service.description),
        price: toSafeString(service.price),
        currency: toSafeString(service.currency),
        paymentChain: toSafeString(service.paymentChain) || null,
        settlementKind: toSafeString(service.settlementKind) || null,
        mrc20Ticker: toSafeString(service.mrc20Ticker) || null,
        mrc20Id: toSafeString(service.mrc20Id) || null,
        providerGlobalMetaId,
        providerAddress: toSafeString(service.paymentAddress),
        paymentAddress: toSafeString(service.paymentAddress),
        serviceIcon: toSafeString(service.serviceIcon) || null,
        providerSkill: toSafeString(service.providerSkill) || null,
        outputType: toSafeString(service.outputType) || null,
        creatorMetabotId,
        creatorMetabotSlug: toSafeString(profile.slug),
        creatorMetabotName: toSafeString(profile.name) || toSafeString(identity?.name),
        creatorMetabotHomeDir: toSafeString(profile.homeDir),
        canModify: mutation.ok,
        canRevoke: mutation.ok,
        blockedReason: mutation.ok ? null : mutation.errorCode ?? null,
        successCount,
        refundCount,
        grossRevenue: formatUnitsToDecimal(grossRevenueUnits),
        netIncome: formatUnitsToDecimal(netIncomeUnits),
        ratingAvg,
        ratingCount,
        updatedAt: toSafeNumber(service.updatedAt),
      });
    }
  }

  return createPageResult(summaries.sort(sortByUpdatedDesc), input.page, input.pageSize);
}

export function buildMyServiceOrderDetails(input: {
  serviceId: string;
  profiles: MyServicesProfileInput[];
  page: number;
  pageSize: number;
}): MyServicePageResult<MyServiceOrderDetail> {
  const normalizedServiceId = toSafeString(input.serviceId);
  const details: MyServiceOrderDetail[] = [];

  for (const profile of input.profiles) {
    const service = profile.services.find((candidate) => {
      const pinIds = getServicePinIds(candidate);
      return pinIds.includes(normalizedServiceId);
    });
    if (!service) continue;

    const chainPinIds = getServicePinIds(service);
    const servicePinIdSet = new Set(chainPinIds);
    const ratingDetails = buildRatingIndex(profile, servicePinIdSet);
    const orders = profile.sellerOrders
      .filter(isClosedOrder)
      .filter((order) => orderMatchesService(order, servicePinIdSet))
      .sort(sortOrdersDesc);

    for (const order of orders) {
      const paymentTxid = toSafeString(order.paymentTxid);
      details.push({
        id: toSafeString(order.id),
        status: toSafeString(order.state),
        traceId: toSafeString(order.traceId),
        paymentTxid: paymentTxid || null,
        orderMessageTxid: toSafeString(order.orderTxid) || toSafeString(order.orderPinId) || null,
        paymentAmount: toSafeString(order.paymentAmount),
        paymentCurrency: toSafeString(order.paymentCurrency),
        servicePinId: toSafeString(order.currentServicePinId) || toSafeString(order.servicePinId) || null,
        createdAt: toOptionalNumber(order.createdAt),
        deliveredAt: toOptionalNumber(order.deliveredAt),
        refundCompletedAt: toOptionalNumber(order.refundCompletedAt ?? order.refundedAt),
        counterpartyGlobalMetaid: toSafeString(order.buyerGlobalMetaId) || null,
        coworkSessionId: toSafeString(order.a2aSessionId) || null,
        runtimeId: toSafeString(order.runtimeId) || null,
        runtimeProvider: toSafeString(order.runtimeProvider) || null,
        llmSessionId: toSafeString(order.llmSessionId) || null,
        rating: pickRatingDetail(ratingDetails, paymentTxid, order.buyerGlobalMetaId),
      });
    }
  }

  details.sort((left, right) => {
    const leftFinalized = left.status === 'refunded'
      ? toSafeNumber(left.refundCompletedAt ?? left.createdAt)
      : toSafeNumber(left.deliveredAt ?? left.createdAt);
    const rightFinalized = right.status === 'refunded'
      ? toSafeNumber(right.refundCompletedAt ?? right.createdAt)
      : toSafeNumber(right.deliveredAt ?? right.createdAt);
    return rightFinalized - leftFinalized || toSafeString(right.id).localeCompare(toSafeString(left.id));
  });

  return createPageResult(details, input.page, input.pageSize);
}

export function validateMyServiceMutation(input: {
  action: MyServiceMutationAction;
  target: MyServiceMutationTarget | null | undefined;
}): MyServiceMutationValidationResult {
  const target = input.target;
  const service = target?.service;
  if (!target || !service) {
    return { ok: false, error: 'Service not found', errorCode: 'service_not_found' };
  }
  if (!toSafeString(service.currentPinId)) {
    return { ok: false, error: 'Service pin is missing', errorCode: 'service_pin_missing' };
  }
  const creatorMetabotId = Math.trunc(toSafeNumber(service.creatorMetabotId));
  if (!creatorMetabotId || !target.identity || !toSafeString(target.profileHomeDir)) {
    return {
      ok: false,
      error: 'Creator MetaBot profile is unavailable',
      errorCode: 'my_services_blocked_missing_creator_profile',
    };
  }
  if (!isServiceVisible(service)) {
    return {
      ok: false,
      error: 'Service is revoked',
      errorCode: 'my_services_blocked_revoked',
    };
  }
  return { ok: true, creatorMetabotId };
}

export function buildMyServiceModifyChainWrite(input: {
  targetPinId: string;
  payloadJson: string;
  network?: string;
}) {
  return {
    operation: 'modify',
    path: `@${toSafeString(input.targetPinId)}`,
    payload: input.payloadJson,
    contentType: 'application/json',
    network: toSafeString(input.network).toLowerCase() || 'mvc',
  };
}

export function buildMyServiceRevokeChainWrite(input: {
  targetPinId: string;
  network?: string;
}) {
  return {
    operation: 'revoke',
    path: `@${toSafeString(input.targetPinId)}`,
    payload: '',
    contentType: 'application/json',
    network: toSafeString(input.network).toLowerCase() || 'mvc',
  };
}

export function buildMyServicePayload(input: {
  draft: PublishedServiceDraft;
  providerGlobalMetaId: string;
  paymentAddress: string;
}): Record<string, string | null> {
  const settlement = resolvePublishedServiceSettlement(input.draft.currency);
  return {
    serviceName: toSafeString(input.draft.serviceName),
    displayName: toSafeString(input.draft.displayName),
    description: toSafeString(input.draft.description),
    serviceIcon: toSafeString(input.draft.serviceIconUri) || '',
    providerMetaBot: toSafeString(input.providerGlobalMetaId),
    providerSkill: toSafeString(input.draft.providerSkill),
    price: toSafeString(input.draft.price),
    currency: settlement.currency,
    paymentChain: settlement.paymentChain,
    settlementKind: settlement.settlementKind,
    mrc20Ticker: settlement.mrc20Ticker,
    mrc20Id: settlement.mrc20Id,
    skillDocument: '',
    inputType: 'text',
    outputType: toSafeString(input.draft.outputType).toLowerCase() || 'text',
    endpoint: 'simplemsg',
    paymentAddress: toSafeString(input.paymentAddress),
  };
}

export function buildMyServiceModifyRecord(input: {
  service: PublishedServiceRecord;
  currentPinId: string;
  providerGlobalMetaId: string;
  paymentAddress: string;
  draft: PublishedServiceDraft;
  payloadJson: string;
  now: number;
}): PublishedServiceRecord {
  const settlement = resolvePublishedServiceSettlement(input.draft.currency);
  const currentPinId = toSafeString(input.currentPinId) || toSafeString(input.service.currentPinId);
  const sourceServicePinId = toSafeString(input.service.sourceServicePinId) || toSafeString(input.service.currentPinId);
  return {
    ...input.service,
    id: sourceServicePinId,
    sourceServicePinId,
    currentPinId,
    chainPinIds: [...new Set([...getServicePinIds(input.service), currentPinId].filter(Boolean))],
    providerGlobalMetaId: toSafeString(input.providerGlobalMetaId),
    providerSkill: toSafeString(input.draft.providerSkill),
    serviceName: toSafeString(input.draft.serviceName),
    displayName: toSafeString(input.draft.displayName) || toSafeString(input.draft.serviceName),
    description: toSafeString(input.draft.description),
    serviceIcon: toSafeString(input.draft.serviceIconUri) || null,
    price: toSafeString(input.draft.price),
    currency: settlement.currency,
    paymentChain: settlement.paymentChain,
    settlementKind: settlement.settlementKind,
    mrc20Ticker: settlement.mrc20Ticker,
    mrc20Id: settlement.mrc20Id,
    skillDocument: '',
    inputType: 'text',
    outputType: toSafeString(input.draft.outputType).toLowerCase() || 'text',
    endpoint: 'simplemsg',
    paymentAddress: toSafeString(input.paymentAddress),
    payloadJson: input.payloadJson,
    available: 1,
    revokedAt: null,
    updatedAt: input.now,
  };
}

export function buildMyServiceRevokeRecord(input: {
  service: PublishedServiceRecord;
  now: number;
}): PublishedServiceRecord {
  return {
    ...input.service,
    chainPinIds: getServicePinIds(input.service),
    available: 0,
    revokedAt: input.now,
    updatedAt: input.now,
  };
}

export function resolveMyServicePaymentAddress(input: {
  identity: RuntimeIdentityRecord | null;
  currency: string;
  fallback: string;
}): string {
  return getPaymentAddress(input.identity, input.currency, input.fallback);
}
