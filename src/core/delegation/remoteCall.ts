import { randomUUID } from 'node:crypto';
import { evaluateSpendCap, normalizeSpendCurrency, type SpendCap } from './spendPolicy';
import { evaluateDelegationPolicy } from '../a2a/delegationPolicy';
import type { DelegationPolicyDecision } from '../a2a/sessionTypes';
import { resolveSkillServicePaymentTerms } from '../services/skillServiceProtocol';

export interface RemoteServiceDescriptor {
  servicePinId?: string | null;
  pinId?: string | null;
  providerGlobalMetaId?: string | null;
  serviceName?: string | null;
  displayName?: string | null;
  description?: string | null;
  price?: string | null;
  currency?: string | null;
  paymentTiming?: string | null;
  settlementKind?: string | null;
  ratingAvg?: number | null;
  ratingCount?: number | null;
  providerName?: string | null;
  providerDaemonBaseUrl?: string | null;
  providerChatPublicKey?: string | null;
  updatedAt?: number | null;
  lastSeenAgoSeconds?: number | null;
}

export interface RemoteCallRequest {
  servicePinId: string;
  providerGlobalMetaId: string;
  userTask: string;
  taskContext: string;
  rawRequest?: string;
  spendCap?: SpendCap | null;
  policyMode?: unknown;
}

export type RemoteCallPlanResult =
  | {
      ok: true;
      state: 'ready';
      code: 'remote_call_ready';
      service: {
        servicePinId: string;
        providerGlobalMetaId: string;
        serviceName: string;
        price: string;
        currency: string;
      };
      payment: { amount: string; currency: string };
      traceId: string;
      confirmation: DelegationPolicyDecision;
    }
  | {
      ok: false;
      state: 'blocked' | 'offline' | 'manual_action_required';
      code: string;
      message: string;
      traceId?: string;
      confirmation?: DelegationPolicyDecision;
    };

const NUMERIC_DELEGATION_PRICE_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const DECORATED_DELEGATION_PRICE_RE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s+([A-Za-z]+))$/;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCaseInsensitive(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function truncateTraceSegment(value: string): string {
  return value.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').slice(0, 16) || 'trace';
}

function resolveServiceIdentity(service: RemoteServiceDescriptor): {
  servicePinId: string;
  providerGlobalMetaId: string;
} {
  return {
    servicePinId: normalizeText(service.servicePinId) || normalizeText(service.pinId),
    providerGlobalMetaId: normalizeText(service.providerGlobalMetaId),
  };
}

function buildRemoteCallTraceId(input: {
  request: RemoteCallRequest;
  traceId?: string | null;
}): string {
  const explicit = normalizeText(input.traceId);
  if (explicit) return explicit;
  const provider = truncateTraceSegment(normalizeText(input.request.providerGlobalMetaId) || 'provider');
  const service = truncateTraceSegment(normalizeText(input.request.servicePinId) || 'service');
  const timestamp = Date.now().toString(36);
  const nonce = randomUUID().replace(/-/g, '').slice(0, 8);
  return `trace-${provider}-${service}-${timestamp}-${nonce}`;
}

export function normalizeDelegationPaymentTerms(
  rawPrice: unknown,
  rawCurrency: unknown,
): { price: string; currency: string } {
  let price = normalizeText(rawPrice);
  let currency = normalizeText(rawCurrency);

  const decoratedMatch = price.match(DECORATED_DELEGATION_PRICE_RE);
  if (decoratedMatch) {
    price = decoratedMatch[1];
    if (!currency && decoratedMatch[2]) {
      currency = decoratedMatch[2];
    }
  }

  return { price, currency };
}

export function isDelegationPriceNumeric(value: string): boolean {
  return NUMERIC_DELEGATION_PRICE_RE.test(normalizeText(value));
}

export function buildRemoteServicesPrompt(availableServices: RemoteServiceDescriptor[]): string | null {
  if (!availableServices || availableServices.length === 0) return null;

  const entries = availableServices
    .map((svc) => {
      const identity = resolveServiceIdentity(svc);
      return (
        `  <remote_service>` +
        `<service_pin_id>${identity.servicePinId}</service_pin_id>` +
        `<service_name>${normalizeText(svc.displayName) || normalizeText(svc.serviceName)}</service_name>` +
        `<description>${normalizeText(svc.description)}</description>` +
        `<price_amount>${normalizeText(svc.price)}</price_amount>` +
        `<price_currency>${resolveSkillServicePaymentTerms({
          price: svc.price,
          currency: svc.currency,
          paymentTiming: svc.paymentTiming,
          settlementKind: svc.settlementKind,
        }).currency}</price_currency>` +
        `<rating_avg>${svc.ratingAvg ?? 'N/A'}</rating_avg>` +
        `<rating_count>${svc.ratingCount ?? 0}</rating_count>` +
        `<updated_at>${svc.updatedAt ?? ''}</updated_at>` +
        `<provider_name>${normalizeText(svc.providerName)}</provider_name>` +
        `<provider_global_metaid>${identity.providerGlobalMetaId}</provider_global_metaid>` +
        `</remote_service>`
      );
    })
    .join('\n');

  return (
    `\n<available_remote_services>\n` +
    `  <notice>\n` +
    `    These are locally cached online remote on-chain services.\n` +
    `    Select the best match by service name, description, rating, rating count, and recency.\n` +
    `    If price is greater than 0, present provider, service, price, currency, and wait for explicit confirmation.\n` +
    `    If price_amount is an explicit numeric 0, the service is free and may be delegated directly when it matches the user's request.\n` +
    `    The provider is not the user. provider_name and provider_global_metaid identify the remote service provider.\n` +
    `    rawRequest MUST be the human user's original request text, not a sentence about selecting or requesting the provider.\n` +
    `    userTask MUST be a short imperative task for the provider, such as "查询微博热搜"; do not include provider names unless the human explicitly asked about that provider.\n` +
    `    taskContext may mention service selection or routing context; do not put routing context into rawRequest or userTask.\n` +
    `    Never emit wording like "用户请求 <provider> 的服务" in rawRequest or userTask.\n` +
    `    To delegate, emit [DELEGATE_REMOTE_SERVICE] plus JSON and include policyMode "confirm_paid_only".\n` +
    `    JSON format: {"servicePinId":"...","serviceName":"...","providerGlobalMetaid":"...","price":"0","currency":"SPACE","rawRequest":"human user's original request","userTask":"imperative task for provider","taskContext":"routing context","policyMode":"confirm_paid_only"}\n` +
    `  </notice>\n` +
    entries +
    '\n' +
    `</available_remote_services>\n`
  );
}

export function planRemoteCall(input: {
  request: RemoteCallRequest;
  availableServices: RemoteServiceDescriptor[];
  traceId?: string | null;
  manualRefundRequired?: boolean;
}): RemoteCallPlanResult {
  const requestedServicePinId = normalizeCaseInsensitive(input.request.servicePinId);
  const requestedProvider = normalizeCaseInsensitive(input.request.providerGlobalMetaId);
  const service = input.availableServices.find((candidate) => {
    const identity = resolveServiceIdentity(candidate);
    return (
      normalizeCaseInsensitive(identity.servicePinId) === requestedServicePinId
      && normalizeCaseInsensitive(identity.providerGlobalMetaId) === requestedProvider
    );
  });

  const traceId = buildRemoteCallTraceId({
    request: input.request,
    traceId: input.traceId,
  });

  if (!service) {
    return {
      ok: false,
      state: 'offline',
      code: 'service_offline',
      message: 'Remote service is offline or unavailable.',
      traceId,
    };
  }

  const normalizedTerms = normalizeDelegationPaymentTerms(service.price, service.currency);
  const paymentTerms = resolveSkillServicePaymentTerms({
    price: normalizedTerms.price,
    currency: normalizedTerms.currency,
    paymentTiming: service.paymentTiming,
    settlementKind: service.settlementKind,
  });
  const hasExplicitFreeTiming = normalizeCaseInsensitive(service.paymentTiming) === 'free';
  const paymentAmount = hasExplicitFreeTiming ? paymentTerms.effectivePrice : normalizedTerms.price;
  const paymentCurrency = paymentTerms.currency;
  const normalizedCurrency = normalizeSpendCurrency(paymentCurrency);
  const confirmation = evaluateDelegationPolicy({
    policyMode: input.request.policyMode,
    estimatedCostAmount: paymentAmount,
    estimatedCostCurrency: normalizedCurrency,
  });
  if (!paymentTerms.isExecutable) {
    return {
      ok: false,
      state: 'blocked',
      code: 'unsupported_payment_terms',
      message: 'Remote service payment terms are not executable by this local runtime.',
      traceId,
      confirmation,
    };
  }
  const spendDecision = evaluateSpendCap({
    price: paymentAmount,
    currency: normalizedCurrency,
    spendCap: input.request.spendCap,
  });
  if (!spendDecision.allowed) {
    return {
      ok: false,
      state: 'blocked',
      code: spendDecision.code || 'remote_call_blocked',
      message: spendDecision.reason || 'Remote call is blocked.',
      traceId,
      confirmation,
    };
  }

  if (input.manualRefundRequired) {
    return {
      ok: false,
      state: 'manual_action_required',
      code: 'manual_refund_required',
      message: 'Manual refund confirmation is required before continuing.',
      traceId,
      confirmation,
    };
  }

  return {
    ok: true,
    state: 'ready',
    code: 'remote_call_ready',
    service: {
      servicePinId: resolveServiceIdentity(service).servicePinId,
      providerGlobalMetaId: resolveServiceIdentity(service).providerGlobalMetaId,
      serviceName: normalizeText(service.displayName) || normalizeText(service.serviceName),
      price: paymentAmount,
      currency: paymentCurrency,
    },
    payment: {
      amount: paymentAmount,
      currency: paymentCurrency,
    },
    traceId,
    confirmation,
  };
}
