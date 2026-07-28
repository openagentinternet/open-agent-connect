const METAAPP_PIN_ID_PATTERN = /^[0-9a-f]{64}i0$/i;

export function normalizeMetaAppPinId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.includes('/') || normalized.includes('\\') || normalized.includes('..')) {
    return null;
  }

  return METAAPP_PIN_ID_PATTERN.test(normalized) ? normalized : null;
}

export function assertMetaAppPinId(value: unknown, label = 'pinId'): string {
  const normalized = normalizeMetaAppPinId(value);
  if (!normalized) {
    throw new Error(`Invalid ${label}. Expected a 64-hex MetaWeb pinId ending in i0.`);
  }
  return normalized;
}

/** Accepts a bare pinId or a metaapp://<pinId> URI and returns the bare pinId. */
export function normalizeMetaAppPinIdOrUri(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  let normalized = value.trim();
  if (normalized.toLowerCase().startsWith('metaapp://')) {
    normalized = normalized.slice('metaapp://'.length).trim();
  }
  return normalizeMetaAppPinId(normalized);
}
