import type {
  MasterServiceValidationFailure,
  MasterServiceValidationResult,
  PublishedMasterDraft,
} from './masterTypes';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized = [];
  for (const entry of value) {
    const text = normalizeText(entry);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function normalizeCurrency(value: unknown): string {
  const normalized = normalizeText(value).toUpperCase();
  return normalized === 'MVC' ? 'SPACE' : normalized;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function buildFailure(issues: string[]): MasterServiceValidationFailure {
  return {
    ok: false,
    code: 'invalid_master_service_payload',
    message: issues.join(' '),
    issues,
  };
}

export function validateMasterServicePayload(value: unknown): MasterServiceValidationResult {
  const payload = readObject(value);
  if (!payload) {
    return buildFailure(['Master service payload must be a JSON object.']);
  }

  const draft: PublishedMasterDraft = {
    serviceName: normalizeText(payload.serviceName),
    displayName: normalizeText(payload.displayName),
    description: normalizeText(payload.description),
    masterKind: normalizeText(payload.masterKind),
    specialties: normalizeStringArray(payload.specialties),
    hostModes: normalizeStringArray(payload.hostModes),
    modelInfo: readObject(payload.modelInfo),
    style: normalizeText(payload.style) || null,
    pricingMode: normalizeText(payload.pricingMode) || null,
    price: normalizeText(payload.price),
    currency: normalizeCurrency(payload.currency),
    responseMode: normalizeText(payload.responseMode) || null,
    contextPolicy: normalizeText(payload.contextPolicy) || null,
    official: payload.official === true,
    trustedTier: normalizeText(payload.trustedTier) || null,
  };

  const issues: string[] = [];
  if (!draft.serviceName) issues.push('serviceName is required.');
  if (!draft.displayName) issues.push('displayName is required.');
  if (!draft.description) issues.push('description is required.');
  if (!draft.masterKind) issues.push('masterKind is required.');
  if (draft.specialties.length === 0) issues.push('specialties must contain at least one entry.');
  if (draft.hostModes.length === 0) issues.push('hostModes must contain at least one entry.');
  if (!draft.price) issues.push('price is required.');
  if (!draft.currency) issues.push('currency is required.');
  if (!draft.pricingMode) issues.push('pricingMode is required.');
  if (!draft.responseMode) issues.push('responseMode is required.');
  if (!draft.contextPolicy) issues.push('contextPolicy is required.');

  if (issues.length > 0) {
    return buildFailure(issues);
  }

  return {
    ok: true,
    value: draft,
  };
}
