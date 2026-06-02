import { isSafeProviderSkillName } from './platformSkillCatalog';

export type SkillServicePaymentTiming = 'free' | 'prepaid' | 'postpaid';
export type SkillServiceSettlementKind = 'native' | 'fiat';

export interface SkillServicePaymentTerms {
  paymentTiming: SkillServicePaymentTiming;
  effectivePrice: string;
  currency: string;
  settlementKind: SkillServiceSettlementKind;
  isFree: boolean;
  isExecutable: boolean;
}

export interface BuildSkillServiceOrderPayloadInput {
  servicePinId?: unknown;
  paymentTxid?: unknown;
  price?: unknown;
  currency?: unknown;
  paymentTiming?: unknown;
  settlementKind?: unknown;
  protocolSettlementKind?: unknown;
  metadata?: unknown;
}

export interface SkillServiceOrderPayload {
  servicePinId: string;
  paymentTxid: string;
  price: string;
  currency: string;
  settlementKind: SkillServiceSettlementKind;
  metadata: string;
}

const VALID_PAYMENT_TIMINGS = new Set<SkillServicePaymentTiming>(['free', 'prepaid', 'postpaid']);
const VALID_SETTLEMENT_KINDS = new Set<SkillServiceSettlementKind>(['native', 'fiat']);
const PLAIN_NON_NEGATIVE_DECIMAL_RE = /^\d+(?:\.\d+)?$/;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeScalarText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function parsePlainNonNegativeDecimal(value: unknown): { value: string; isPositive: boolean } {
  const raw = normalizeScalarText(value);
  if (!PLAIN_NON_NEGATIVE_DECIMAL_RE.test(raw)) {
    return { value: '0', isPositive: false };
  }
  const isPositive = /[1-9]/.test(raw);
  return { value: isPositive ? raw : '0', isPositive };
}

export function normalizeProviderSkillList(value: unknown): string[] {
  const rawSkills = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const skills: string[] = [];

  for (const rawSkill of rawSkills) {
    const skillName = normalizeText(rawSkill);
    if (!skillName || !isSafeProviderSkillName(skillName) || seen.has(skillName)) {
      continue;
    }
    seen.add(skillName);
    skills.push(skillName);
  }

  return skills;
}

export function getPrimaryProviderSkill(value: unknown): string | null {
  return normalizeProviderSkillList(value)[0] ?? null;
}

export function normalizeSkillServicePaymentTiming(
  value: unknown,
  price: unknown,
): SkillServicePaymentTiming {
  const normalized = normalizeText(value).toLowerCase();
  if (VALID_PAYMENT_TIMINGS.has(normalized as SkillServicePaymentTiming)) {
    return normalized as SkillServicePaymentTiming;
  }
  return parsePlainNonNegativeDecimal(price).isPositive ? 'prepaid' : 'free';
}

export function normalizeSkillServiceSettlementKind(value: unknown): SkillServiceSettlementKind {
  const normalized = normalizeText(value).toLowerCase();
  return VALID_SETTLEMENT_KINDS.has(normalized as SkillServiceSettlementKind)
    ? normalized as SkillServiceSettlementKind
    : 'native';
}

export function normalizeSkillServiceCurrency(value: unknown): string {
  const normalized = normalizeScalarText(value).toUpperCase();
  if (!normalized || normalized === 'MVC' || normalized === 'MICROVISIONCHAIN') {
    return 'SPACE';
  }
  if (normalized === 'BITCOIN') return 'BTC';
  if (normalized === 'DOGECOIN') return 'DOGE';
  if (normalized === 'OPCAT' || normalized === 'BTC_OPCAT') return 'BTC-OPCAT';
  return normalized;
}

export function isExecutableSkillServicePaymentTerm(value: {
  paymentTiming?: unknown;
  effectivePrice?: unknown;
  price?: unknown;
  settlementKind?: unknown;
}): boolean {
  const price = parsePlainNonNegativeDecimal(value.effectivePrice ?? value.price);
  const paymentTiming = normalizeSkillServicePaymentTiming(value.paymentTiming, price.value);
  const settlementKind = normalizeSkillServiceSettlementKind(value.settlementKind);

  if (paymentTiming === 'free') {
    return true;
  }
  if (paymentTiming === 'prepaid' && settlementKind === 'native' && price.isPositive) {
    return true;
  }
  return false;
}

export function resolveSkillServicePaymentTerms(input: {
  price?: unknown;
  currency?: unknown;
  paymentTiming?: unknown;
  settlementKind?: unknown;
  protocolSettlementKind?: unknown;
} = {}): SkillServicePaymentTerms {
  const paymentTiming = normalizeSkillServicePaymentTiming(input.paymentTiming, input.price);
  const parsedPrice = parsePlainNonNegativeDecimal(input.price);
  const effectivePrice = paymentTiming === 'free' ? '0' : parsedPrice.value;
  const settlementKind = normalizeSkillServiceSettlementKind(
    input.protocolSettlementKind ?? input.settlementKind,
  );
  const term = {
    paymentTiming,
    effectivePrice,
    currency: normalizeSkillServiceCurrency(input.currency),
    settlementKind,
    isFree: paymentTiming === 'free',
  };

  return {
    ...term,
    isExecutable: isExecutableSkillServicePaymentTerm(term),
  };
}

export function buildSkillServiceOrderPayload(
  input: BuildSkillServiceOrderPayloadInput = {},
): SkillServiceOrderPayload {
  const paymentTerms = resolveSkillServicePaymentTerms(input);
  return {
    servicePinId: normalizeText(input.servicePinId),
    paymentTxid: paymentTerms.isFree ? '' : normalizeText(input.paymentTxid),
    price: paymentTerms.effectivePrice,
    currency: paymentTerms.currency,
    settlementKind: paymentTerms.settlementKind,
    metadata: normalizeText(input.metadata),
  };
}
