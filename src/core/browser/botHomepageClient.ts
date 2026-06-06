export interface BotHomepageClientInput {
  baseUrl: string;
  fetch?: typeof fetch;
}

export type BotHomepageClientResult = {
  ok: true;
  data: Record<string, unknown>;
  fetchedAt: number;
  url: string;
} | {
  ok: false;
  code: string;
  message: string;
  status?: number;
  fetchedAt: number;
  url: string;
};

export interface BotHomepageClient {
  getByGlobalMetaId(globalMetaId: string): Promise<BotHomepageClientResult>;
}

function trimTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMessage(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function createBotHomepageClient(input: BotHomepageClientInput): BotHomepageClient {
  const baseUrl = trimTrailingSlashes(input.baseUrl);
  const fetchImpl = input.fetch ?? globalThis.fetch;

  return {
    async getByGlobalMetaId(globalMetaId: string): Promise<BotHomepageClientResult> {
      const encodedId = encodeURIComponent(globalMetaId.trim());
      const url = `${baseUrl}/api/bot-homepage/globalmetaid/${encodedId}?includeServices=true&includeProofs=true&includePresence=true`;
      const fetchedAt = Date.now();

      try {
        const response = await fetchImpl(url);
        const status = response.status;
        let envelope: unknown = null;
        try {
          envelope = await response.json();
        } catch {
          envelope = null;
        }

        if (!isRecord(envelope)) {
          return {
            ok: false,
            code: 'bot_homepage_fetch_failed',
            message: `Bot homepage response was not valid JSON.`,
            status,
            fetchedAt,
            url,
          };
        }

        if (envelope.code === 0 && isRecord(envelope.data)) {
          return {
            ok: true,
            data: envelope.data,
            fetchedAt,
            url,
          };
        }

        const code = envelope.code === 40400 || status === 404
          ? 'bot_homepage_not_found'
          : 'bot_homepage_fetch_failed';
        return {
          ok: false,
          code,
          message: normalizeMessage(envelope.message, code === 'bot_homepage_not_found'
            ? 'Bot homepage was not found.'
            : 'Bot homepage request failed.'),
          status,
          fetchedAt,
          url,
        };
      } catch (error) {
        return {
          ok: false,
          code: 'bot_homepage_fetch_failed',
          message: error instanceof Error ? error.message : 'Bot homepage request failed.',
          fetchedAt,
          url,
        };
      }
    },
  };
}
