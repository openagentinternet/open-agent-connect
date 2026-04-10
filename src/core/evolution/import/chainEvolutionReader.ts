import { EVOLUTION_ARTIFACT_PROTOCOL_PATH } from '../protocol';
import { EVOLUTION_SEARCH_MAX_RAW_ROWS, parseMetafilePinId } from './publishedArtifactProtocol';

const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
function normalizeBaseUrl(value: string | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}

function getFetchImpl(fetchImpl: typeof fetch | undefined): typeof fetch {
  return fetchImpl ?? fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseContentSummary(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractListRows(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error('invalid_page_payload');
  }
  const { list } = payload.data;
  if (!Array.isArray(list)) {
    throw new Error('invalid_page_payload');
  }
  return list.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

function normalizeMetadataPayload(item: Record<string, unknown>): unknown {
  const summary = parseContentSummary(item.contentSummary);
  if (summary) {
    return summary;
  }
  return item;
}

function extractPinPayload(payload: unknown): unknown | null {
  if (!isRecord(payload)) {
    return null;
  }
  if (isRecord(payload.data)) {
    const dataSummary = parseContentSummary(payload.data.contentSummary);
    return dataSummary ?? payload.data;
  }
  const summary = parseContentSummary(payload.contentSummary);
  return summary ?? payload;
}

function extractContentPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  if (isRecord(payload.data)) {
    const content = payload.data.content ?? payload.data.body ?? payload.data.payload;
    return content ?? payload.data;
  }
  const content = payload.content ?? payload.body ?? payload.payload;
  return content ?? payload;
}

function normalizePinId(pinId: string): string {
  return pinId.trim();
}

function createInvalidSearchResultError(detail: string): Error {
  return new Error(`evolution_search_result_invalid:${detail}`);
}

export function createChainEvolutionReader(input: {
  chainApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): {
  fetchMetadataRows(): Promise<Array<{ pinId: string; payload: unknown }>>;
  readMetadataPinById(pinId: string): Promise<unknown | null>;
  readArtifactBodyByUri(uri: string): Promise<unknown>;
} {
  const chainApiBaseUrl = normalizeBaseUrl(input.chainApiBaseUrl);
  const fetchImpl = getFetchImpl(input.fetchImpl);

  return {
    async fetchMetadataRows() {
      const url = new URL(`${chainApiBaseUrl}/pin/path/list`);
      url.searchParams.set('path', EVOLUTION_ARTIFACT_PROTOCOL_PATH);
      url.searchParams.set('size', String(EVOLUTION_SEARCH_MAX_RAW_ROWS));

      const response = await fetchImpl(url.toString());
      if (!response.ok) {
        throw new Error(`chain_evolution_http_${response.status}`);
      }
      let payload: unknown;
      try {
        payload = await response.json() as unknown;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw createInvalidSearchResultError(message || 'invalid_page_payload');
      }
      let rows: Record<string, unknown>[];
      try {
        rows = extractListRows(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw createInvalidSearchResultError(message || 'invalid_page_payload');
      }

      return rows
        .map((item) => {
          const pinId = toNonEmptyString(item.id);
          if (!pinId) {
            return null;
          }
          return {
            pinId,
            payload: normalizeMetadataPayload(item),
          };
        })
        .filter((entry): entry is { pinId: string; payload: unknown } => Boolean(entry))
        .slice(0, EVOLUTION_SEARCH_MAX_RAW_ROWS);
    },
    async readMetadataPinById(pinId: string) {
      const normalizedPinId = normalizePinId(pinId);
      if (!normalizedPinId) {
        return null;
      }
      const response = await fetchImpl(`${chainApiBaseUrl}/pin/${encodeURIComponent(normalizedPinId)}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`chain_evolution_http_${response.status}`);
      }
      const payload = await response.json() as unknown;
      return extractPinPayload(payload);
    },
    async readArtifactBodyByUri(uri: string) {
      const contentPinId = parseMetafilePinId(uri);
      if (!contentPinId) {
        throw new Error(`Invalid metafile URI: ${uri}`);
      }
      const response = await fetchImpl(`${chainApiBaseUrl}/content/${encodeURIComponent(contentPinId)}`);
      if (!response.ok) {
        throw new Error(`chain_evolution_http_${response.status}`);
      }
      const payload = await response.json() as unknown;
      return extractContentPayload(payload);
    },
  };
}
