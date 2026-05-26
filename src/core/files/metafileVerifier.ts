import { setTimeout as delay } from 'node:timers/promises';
import { buildMetafileContentUrls } from './metafileUrls';

export interface VerifyMetafileAvailabilityInput {
  pinId: string;
  fetchImpl?: typeof fetch;
  attempts?: number;
  delayMs?: number;
}

export interface VerifyMetafileAvailabilityResult {
  ok: boolean;
  url: string | null;
  attempts: number;
  error?: string;
}

interface FetchResponseLike {
  ok: boolean;
  status?: number;
  body?: {
    cancel?: () => Promise<unknown> | unknown;
    releaseLock?: () => void;
  } | null;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 250;

function normalizeAttempts(value: unknown): number {
  const attempts = Math.floor(Number(value));
  return Number.isFinite(attempts) && attempts > 0 ? attempts : DEFAULT_ATTEMPTS;
}

function normalizeDelayMs(value: unknown): number {
  const ms = Math.floor(Number(value));
  return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_DELAY_MS;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  const text = String(error ?? '').trim();
  return text || 'Metafile verification failed.';
}

function isBodySafeFallback(response: FetchResponseLike): boolean {
  return response.status === 403 || response.status === 405;
}

async function releaseResponseBody(response: FetchResponseLike | null | undefined): Promise<void> {
  const body = response?.body;
  if (!body) {
    return;
  }

  try {
    if (typeof body.cancel === 'function') {
      await body.cancel();
      return;
    }
  } catch {
    return;
  }

  try {
    body.releaseLock?.();
  } catch {
    // Ignore cleanup failures.
  }
}

async function probeUrl(
  fetchImpl: typeof fetch,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const headResponse = (await fetchImpl(url, { method: 'HEAD' })) as FetchResponseLike;
  if (headResponse?.ok) {
    await releaseResponseBody(headResponse);
    return { ok: true };
  }

  if (!isBodySafeFallback(headResponse)) {
    await releaseResponseBody(headResponse);
    return { ok: false, error: `HEAD ${headResponse?.status ?? 'unavailable'}` };
  }

  const getResponse = (await fetchImpl(url, { method: 'GET' })) as FetchResponseLike;
  if (getResponse?.ok) {
    await releaseResponseBody(getResponse);
    return { ok: true };
  }

  await releaseResponseBody(getResponse);
  return { ok: false, error: `GET ${getResponse?.status ?? 'unavailable'}` };
}

export async function verifyMetafileAvailability(
  input: VerifyMetafileAvailabilityInput,
): Promise<VerifyMetafileAvailabilityResult> {
  const pinId = String(input?.pinId || '').trim();
  if (!pinId) {
    throw new Error('pinId is required.');
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const attempts = normalizeAttempts(input.attempts);
  const delayMs = normalizeDelayMs(input.delayMs);
  const urls = buildMetafileContentUrls(pinId);
  const candidateUrls = [urls.accelerateUrl, urls.contentUrl, urls.legacyContentUrl];
  let lastError = 'Metafile verification failed.';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const url of candidateUrls) {
      try {
        const result = await probeUrl(fetchImpl, url);
        if (result.ok) {
          return { ok: true, url, attempts: attempt };
        }
        if (result.error) {
          lastError = result.error;
        }
      } catch (error) {
        lastError = normalizeError(error);
      }
    }

    if (attempt < attempts && delayMs > 0) {
      await delay(delayMs);
    }
  }

  return {
    ok: false,
    url: null,
    attempts,
    error: lastError,
  };
}
