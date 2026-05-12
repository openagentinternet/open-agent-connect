export interface PublishedServiceDraft {
  serviceName: string;
  displayName: string;
  description: string;
  providerSkill: string;
  price: string;
  currency: string;
  outputType: string;
  serviceIconUri?: string | null;
  serviceIconDataUrl?: string | null;
}

export interface PublishedServiceRecord {
  id: string;
  sourceServicePinId: string;
  currentPinId: string;
  chainPinIds?: string[];
  creatorMetabotId: number;
  providerGlobalMetaId: string;
  providerSkill: string;
  serviceName: string;
  displayName: string;
  description: string;
  serviceIcon: string | null;
  price: string;
  currency: string;
  paymentChain: string | null;
  settlementKind: string | null;
  mrc20Ticker: string | null;
  mrc20Id: string | null;
  skillDocument: string;
  inputType: 'text';
  outputType: string;
  endpoint: 'simplemsg';
  paymentAddress: string;
  payloadJson: string;
  available: 0 | 1;
  revokedAt: number | null;
  updatedAt: number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizePublishedServiceCurrency(value: string): string {
  const normalized = normalizeText(value).toUpperCase();
  return normalized === 'MVC' ? 'SPACE' : normalized;
}

export function resolvePublishedServiceSettlement(value: string): {
  currency: string;
  paymentChain: string | null;
  settlementKind: string | null;
  mrc20Ticker: string | null;
  mrc20Id: string | null;
} {
  const normalized = normalizePublishedServiceCurrency(value);
  if (normalized === 'SPACE') {
    return {
      currency: 'SPACE',
      paymentChain: 'mvc',
      settlementKind: 'native',
      mrc20Ticker: null,
      mrc20Id: null,
    };
  }
  if (normalized === 'BTC') {
    return {
      currency: 'BTC',
      paymentChain: 'btc',
      settlementKind: 'native',
      mrc20Ticker: null,
      mrc20Id: null,
    };
  }
  if (normalized === 'DOGE') {
    return {
      currency: 'DOGE',
      paymentChain: 'doge',
      settlementKind: 'native',
      mrc20Ticker: null,
      mrc20Id: null,
    };
  }
  if (normalized === 'BTC-OPCAT' || normalized === 'BTC_OPCAT' || normalized === 'OPCAT') {
    return {
      currency: 'BTC-OPCAT',
      paymentChain: 'opcat',
      settlementKind: 'native',
      mrc20Ticker: null,
      mrc20Id: null,
    };
  }
  return {
    currency: normalized,
    paymentChain: null,
    settlementKind: null,
    mrc20Ticker: null,
    mrc20Id: null,
  };
}

function normalizeDraft(draft: PublishedServiceDraft): PublishedServiceDraft {
  return {
    serviceName: normalizeText(draft.serviceName),
    displayName: normalizeText(draft.displayName),
    description: normalizeText(draft.description),
    providerSkill: normalizeText(draft.providerSkill),
    price: normalizeText(draft.price),
    currency: normalizePublishedServiceCurrency(draft.currency),
    outputType: normalizeText(draft.outputType).toLowerCase() || 'text',
    serviceIconUri: normalizeText(draft.serviceIconUri) || null,
  };
}

export function buildPublishedService(input: {
  sourceServicePinId: string;
  currentPinId: string;
  creatorMetabotId: number;
  providerGlobalMetaId: string;
  paymentAddress: string;
  draft: PublishedServiceDraft;
  skillDocument: string;
  now: number;
}): {
  payload: Record<string, string | null>;
  record: PublishedServiceRecord;
} {
  const draft = normalizeDraft(input.draft);
  const settlement = resolvePublishedServiceSettlement(draft.currency);
  const payload = {
    serviceName: draft.serviceName,
    displayName: draft.displayName,
    description: draft.description,
    serviceIcon: draft.serviceIconUri || '',
    providerMetaBot: normalizeText(input.providerGlobalMetaId),
    providerSkill: draft.providerSkill,
    price: draft.price,
    currency: settlement.currency,
    paymentChain: settlement.paymentChain,
    settlementKind: settlement.settlementKind,
    mrc20Ticker: settlement.mrc20Ticker,
    mrc20Id: settlement.mrc20Id,
    skillDocument: '',
    inputType: 'text',
    outputType: draft.outputType || 'text',
    endpoint: 'simplemsg',
    paymentAddress: normalizeText(input.paymentAddress),
  };

  const record: PublishedServiceRecord = {
    id: normalizeText(input.sourceServicePinId),
    sourceServicePinId: normalizeText(input.sourceServicePinId),
    currentPinId: normalizeText(input.currentPinId) || normalizeText(input.sourceServicePinId),
    chainPinIds: [...new Set([
      normalizeText(input.sourceServicePinId),
      normalizeText(input.currentPinId) || normalizeText(input.sourceServicePinId),
    ].filter(Boolean))],
    creatorMetabotId: input.creatorMetabotId,
    providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
    providerSkill: draft.providerSkill,
    serviceName: draft.serviceName,
    displayName: draft.displayName,
    description: draft.description,
    serviceIcon: draft.serviceIconUri || null,
    price: draft.price,
    currency: settlement.currency,
    paymentChain: settlement.paymentChain,
    settlementKind: settlement.settlementKind,
    mrc20Ticker: settlement.mrc20Ticker,
    mrc20Id: settlement.mrc20Id,
    skillDocument: '',
    inputType: 'text',
    outputType: draft.outputType || 'text',
    endpoint: 'simplemsg',
    paymentAddress: normalizeText(input.paymentAddress),
    payloadJson: JSON.stringify(payload),
    available: 1,
    revokedAt: null,
    updatedAt: input.now,
  };

  return { payload, record };
}

export function buildRevokedPublishedService(input: {
  sourceServicePinId: string;
  currentPinId: string;
  creatorMetabotId: number;
  providerGlobalMetaId: string;
  providerSkill: string;
  serviceName: string;
  displayName: string;
  description: string;
  serviceIcon?: string | null;
  price: string;
  currency: string;
  paymentChain?: string | null;
  settlementKind?: string | null;
  mrc20Ticker?: string | null;
  mrc20Id?: string | null;
  skillDocument: string;
  now: number;
}): PublishedServiceRecord {
  const settlement = resolvePublishedServiceSettlement(input.currency);
  return {
    id: normalizeText(input.sourceServicePinId),
    sourceServicePinId: normalizeText(input.sourceServicePinId),
    currentPinId: normalizeText(input.currentPinId) || normalizeText(input.sourceServicePinId),
    chainPinIds: [...new Set([
      normalizeText(input.sourceServicePinId),
      normalizeText(input.currentPinId) || normalizeText(input.sourceServicePinId),
    ].filter(Boolean))],
    creatorMetabotId: input.creatorMetabotId,
    providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
    providerSkill: normalizeText(input.providerSkill),
    serviceName: normalizeText(input.serviceName),
    displayName: normalizeText(input.displayName) || normalizeText(input.serviceName),
    description: normalizeText(input.description),
    serviceIcon: normalizeText(input.serviceIcon) || null,
    price: normalizeText(input.price),
    currency: settlement.currency,
    paymentChain: normalizeText(input.paymentChain) || settlement.paymentChain,
    settlementKind: normalizeText(input.settlementKind) || settlement.settlementKind,
    mrc20Ticker: normalizeText(input.mrc20Ticker) || settlement.mrc20Ticker,
    mrc20Id: normalizeText(input.mrc20Id) || settlement.mrc20Id,
    skillDocument: '',
    inputType: 'text',
    outputType: 'text',
    endpoint: 'simplemsg',
    paymentAddress: '',
    payloadJson: '',
    available: 0,
    revokedAt: input.now,
    updatedAt: input.now,
  };
}
