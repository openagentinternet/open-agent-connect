export interface SimplemsgDisplayContent {
  content: string;
  contentType: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const normalized = normalizeText(value);
  if (!normalized || normalized[0] !== '{') {
    return null;
  }
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function contentTypeBase(value: string): string {
  return normalizeText(value).split(';', 1)[0]?.toLowerCase() ?? '';
}

function shouldPreferPayloadContentType(outerContentType: string): boolean {
  const base = contentTypeBase(outerContentType);
  return !base || base === 'text/plain' || base === 'application/json';
}

export function readSimplemsgPayloadContentType(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }
  const record = value as Record<string, unknown>;
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload as Record<string, unknown>
    : null;
  return normalizeText(record.contentType)
    || normalizeText(record.content_type)
    || normalizeText(payload?.contentType)
    || normalizeText(payload?.content_type);
}

export function normalizeSimplemsgDisplayContent(input: {
  content: unknown;
  contentType?: unknown;
  payloadContentType?: unknown;
}): SimplemsgDisplayContent {
  const content = typeof input.content === 'string' ? input.content : String(input.content ?? '');
  const outerContentType = normalizeText(input.contentType);
  const payloadContentType = normalizeText(input.payloadContentType);
  const parsed = parseJsonObject(content);
  if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'content') || typeof parsed.content !== 'string') {
    return {
      content,
      contentType: payloadContentType && shouldPreferPayloadContentType(outerContentType)
        ? payloadContentType
        : outerContentType || 'text/plain',
    };
  }

  const parsedContentType = normalizeText(parsed.contentType) || normalizeText(parsed.content_type);
  const fallbackContentType = contentTypeBase(outerContentType) === 'application/json'
    ? 'text/plain'
    : outerContentType || 'text/plain';
  return {
    content: parsed.content,
    contentType: (parsedContentType || payloadContentType) && shouldPreferPayloadContentType(outerContentType)
      ? parsedContentType || payloadContentType
      : fallbackContentType,
  };
}
