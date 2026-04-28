import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
import {
  MASTER_SERVICE_PROTOCOL_PATH,
  PENDING_MASTER_PIN_ID,
  type PublishedMasterDraft,
  type PublishedMasterRecord,
} from './masterTypes';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCurrency(value: string): string {
  const normalized = normalizeText(value).toUpperCase();
  return normalized === 'MVC' ? 'SPACE' : normalized;
}

export function buildPublishedMaster(input: {
  sourceMasterPinId: string;
  currentPinId: string;
  creatorMetabotId: number;
  providerGlobalMetaId: string;
  providerAddress: string;
  draft: PublishedMasterDraft;
  now: number;
}): {
  payload: Record<string, unknown>;
  record: PublishedMasterRecord;
} {
  const payload = {
    serviceName: normalizeText(input.draft.serviceName),
    displayName: normalizeText(input.draft.displayName),
    description: normalizeText(input.draft.description),
    providerMetaBot: normalizeText(input.providerGlobalMetaId),
    masterKind: normalizeText(input.draft.masterKind),
    specialties: [...input.draft.specialties],
    hostModes: [...input.draft.hostModes],
    modelInfo: input.draft.modelInfo ? { ...input.draft.modelInfo } : null,
    style: input.draft.style,
    pricingMode: input.draft.pricingMode,
    price: normalizeText(input.draft.price),
    currency: normalizeCurrency(input.draft.currency),
    responseMode: input.draft.responseMode,
    contextPolicy: input.draft.contextPolicy,
    official: input.draft.official,
    trustedTier: input.draft.trustedTier,
  };

  const record: PublishedMasterRecord = {
    id: normalizeText(input.sourceMasterPinId),
    sourceMasterPinId: normalizeText(input.sourceMasterPinId),
    currentPinId: normalizeText(input.currentPinId) || normalizeText(input.sourceMasterPinId),
    creatorMetabotId: input.creatorMetabotId,
    providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
    providerAddress: normalizeText(input.providerAddress),
    serviceName: normalizeText(input.draft.serviceName),
    displayName: normalizeText(input.draft.displayName),
    description: normalizeText(input.draft.description),
    masterKind: normalizeText(input.draft.masterKind),
    specialties: [...input.draft.specialties],
    hostModes: [...input.draft.hostModes],
    modelInfoJson: input.draft.modelInfo ? JSON.stringify(input.draft.modelInfo) : null,
    style: input.draft.style,
    pricingMode: input.draft.pricingMode,
    price: normalizeText(input.draft.price),
    currency: normalizeCurrency(input.draft.currency),
    responseMode: input.draft.responseMode,
    contextPolicy: input.draft.contextPolicy,
    official: input.draft.official ? 1 : 0,
    trustedTier: input.draft.trustedTier,
    payloadJson: JSON.stringify(payload),
    available: 1,
    revokedAt: null,
    updatedAt: input.now,
  };

  return { payload, record };
}

export function buildMasterPublishChainWrite(input: {
  payload: Record<string, unknown>;
  network?: string;
}) {
  return {
    operation: 'create',
    path: MASTER_SERVICE_PROTOCOL_PATH,
    payload: JSON.stringify(input.payload),
    contentType: 'application/json',
    network: normalizeText(input.network).toLowerCase() || 'mvc',
  };
}

export interface PublishMasterToChainResult {
  payload: Record<string, unknown>;
  record: PublishedMasterRecord;
  chainWrite: ChainWriteResult;
}

export async function publishMasterToChain(input: {
  signer: Pick<Signer, 'writePin'>;
  creatorMetabotId: number;
  providerGlobalMetaId: string;
  providerAddress: string;
  draft: PublishedMasterDraft;
  now: number;
  network?: string;
}): Promise<PublishMasterToChainResult> {
  const prepared = buildPublishedMaster({
    sourceMasterPinId: PENDING_MASTER_PIN_ID,
    currentPinId: PENDING_MASTER_PIN_ID,
    creatorMetabotId: input.creatorMetabotId,
    providerGlobalMetaId: input.providerGlobalMetaId,
    providerAddress: input.providerAddress,
    draft: input.draft,
    now: input.now,
  });

  const chainWriteRequest = buildMasterPublishChainWrite({
    payload: prepared.payload,
    network: input.network,
  });
  const chainWrite = await input.signer.writePin(chainWriteRequest);
  const chainPinId = normalizeText(chainWrite.pinId);

  const published = buildPublishedMaster({
    sourceMasterPinId: chainPinId,
    currentPinId: chainPinId,
    creatorMetabotId: input.creatorMetabotId,
    providerGlobalMetaId: input.providerGlobalMetaId,
    providerAddress: input.providerAddress,
    draft: input.draft,
    now: input.now,
  });

  return {
    payload: published.payload,
    record: published.record,
    chainWrite,
  };
}
