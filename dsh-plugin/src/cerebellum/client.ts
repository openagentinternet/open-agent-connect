/**
 * Cerebellum (小脑) call context for the OAC dsh plugin — port of IDBots
 * src/main/services/jevRelayService.ts (transport layer) + main.ts
 * `resolveCerebellumCallContext`/`cerebellumFetchFor` semantics @ commit
 * d75bea8ac2249da4886bfa0f6f1db838d234ef1f.
 *
 * Every decision executor goes through this module's client:
 *  - per-call lazy config re-resolution (settings edits apply next turn, no
 *    restart);
 *  - a signal-bounded fetch wrapper that enforces the caller's AbortSignal
 *    IN OUR CODE instead of trusting the underlying fetch;
 *  - the free-relay credential chain (in-memory cache -> kv -> injected
 *    provider read -> ONE shared in-flight identity-signed bootstrap) and a
 *    401 re-bootstrap-retry wrapper bounded to one retry;
 *  - a result-code recorder (per-call codes + daily aggregate) and the
 *    5-minute quota breaker.
 *
 * Mechanical differences from IDBots (all semantics-preserving; listed in
 * this PR's diff table):
 *  1. Node fetch instead of Electron `session.defaultSession.fetch`. Node's
 *     global fetch does NOT honor HTTPS_PROXY by itself, so the default
 *     fetch factory additionally attaches an undici EnvHttpProxyAgent when a
 *     proxy env var is set and undici is resolvable (fail-open to plain
 *     fetch). NODE_USE_ENV_PROXY=1 (Node 24+) also honors the env natively.
 *     IDBots' 451 lesson came from exactly this bare-Node-fetch blind spot.
 *  2. Instance-based service instead of module-global singletons: OAC has no
 *     global SqliteStore, so the kv store, the provider-credentials reader,
 *     the bootstrap implementation, and the log sink are injected per client
 *     (`createCerebellumClient`). The shared in-flight bootstrap, breaker,
 *     and day accumulator are per-client state — one client per host run.
 *  3. The kv store, the metaid-free provider read, and the identity-signed
 *     bootstrap are injected seams. PR-1 ships them un-wired (free relay
 *     silently stays off without credentials); wiring the OAC relay
 *     credential chain is deferred to the upstream discussion (design doc
 *     §2.2 B2, §5.5 talking point 3).
 *
 * Logging contract (design doc §5.3): verdict/latency/ids only — never
 * memory text, never question text, never the API key.
 */

import {
  CEREBELLUM_FREE_PROVIDER,
  resolveCerebellumConfig,
  type ResolvedCerebellumConfig,
} from './config.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal structural subset of a kv store (get/set/delete by string key). */
export interface CerebellumKvStore {
  get(key: string): unknown;
  set(key: string, value: string): unknown;
  delete(key: string): unknown;
}

export interface JevRelayCredentials {
  apiKey: string;
  baseUrl: string;
}

export interface JevRelayClientDeps {
  /** Persistent kv for cached relay credentials (null = memory only). */
  store?: CerebellumKvStore | null;
  /** Fallback provider-credential read (IDBots: app_config metaid-free provider). */
  readProviderCredentials?: (() => JevRelayCredentials | null) | null;
  /** Identity-signed relay bootstrap. Absent => the free relay silently stays off. */
  bootstrapImpl?: (() => Promise<{ apiKey: string; baseUrl: string }>) | null;
  /** Log sink for per-call result lines + the daily aggregate. */
  sink?: JevRelayLogSink | null;
  /** Underlying fetch (tests inject fakes; default: proxy-aware Node fetch). */
  fetchImpl?: ((url: string, init: Record<string, unknown>) => Promise<Response>) | null;
  /** Injected clock for tests. */
  now?: (() => number) | null;
}

/** kv keys for the cached JEV relay credentials (IDBots visionRelay-style). */
export const JEV_RELAY_API_KEY_KV = 'jevRelay.apiKey';
export const JEV_RELAY_BASE_URL_KV = 'jevRelay.baseUrl';

// ---------------------------------------------------------------------------
// raceAbortSignal + signal-bounded fetch (verbatim semantics)
// ---------------------------------------------------------------------------

/** Resolve with `promise`, or reject with an AbortError the moment `signal`
 *  fires. The underlying promise is left running (callers use this to stop
 *  WAITING, not to cancel the work — shared bootstraps must complete so later
 *  callers find the cached result). Listener-safe on both paths. */
function raceAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | null,
  abortMessage = 'The JEV relay re-bootstrap was aborted',
): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException(abortMessage, 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = (fn: () => void) => {
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

/**
 * fetch wrapper that enforces the caller's AbortSignal IN OUR CODE instead of
 * trusting the underlying fetch to honor it. Empirically (IDBots 2026-10-16
 * follow-up on session 70fa10aa): the platform fetch rejects on abort on a
 * healthy network within ~1s, but when the connection stalls behind a
 * proxy/upstream (the free relay hung five cerebellum calls for 17s) the
 * abort never surfaced — every 1s/1.5s call budget blew past its deadline and
 * the turn's first sentence waited out the upstream recovery. This wrapper
 * rejects the CALLER at the abort edge regardless; the abandoned socket is
 * left to settle on its own (the decision call sites are fail-to-null, so a
 * late response is simply dropped).
 *
 * The resolved response's json() read rides the same race (2026-10-16 second
 * round): a headers-fast/body-stalled response used to slip past the bounded
 * window, since only the headers await was covered. If the response object
 * rejects the shadow property (frozen/exotic), the body read stays unbounded
 * — no regression, just the old behavior.
 */
export function createSignalBoundedFetch<R>(
  fetchImpl: (url: string, init: Record<string, unknown>) => Promise<R>,
): (url: string, init: Record<string, unknown>) => Promise<R> {
  return (url, init) => {
    const signal = (init as { signal?: AbortSignal | null }).signal ?? null;
    if (!signal) return fetchImpl(url, init);
    if (signal.aborted) {
      return Promise.reject(new DOMException('The cerebellum call was aborted before dispatch', 'AbortError'));
    }
    return raceAbortSignal(
      fetchImpl(url, init),
      signal,
      'The cerebellum call was aborted while awaiting the upstream response',
    ).then((response) => {
      try {
        const jsonRead = (response as { json?: unknown } | null | undefined)?.json;
        if (typeof jsonRead === 'function') {
          const boundRead = jsonRead.bind(response) as () => Promise<unknown>;
          (response as { json: () => Promise<unknown> }).json = () =>
            raceAbortSignal(
              boundRead(),
              signal,
              'The cerebellum call was aborted while reading the response body',
            );
        }
      } catch {
        // Non-extensible response: body reads stay on the caller's own handling.
      }
      return response;
    }) as Promise<R>;
  };
}

// ---------------------------------------------------------------------------
// Result-code classification (verbatim)
// ---------------------------------------------------------------------------

/** One code per relay call; the union of HTTP outcome and thrown outcome. */
export type JevRelayCallResultCode =
  | 'ok'
  | 'timeout'
  | 'http_401'
  | 'http_429_quota'
  | 'http_429_rate'
  | 'http_4xx'
  | 'http_5xx'
  | 'network';

/**
 * Error envelope code the relay returns on an exhausted JEV pool. The CHAT
 * pool's code is plain `free_quota_exhausted` — deliberately NOT matched
 * here, so a chat-pool 429 (wrong route) classifies as http_429_rate.
 */
export const JEV_FREE_QUOTA_EXHAUSTED_CODE = 'jev_free_quota_exhausted';

/** Log sink shape (levels kept identical to IDBots' coworkLog). */
export type JevRelayLogSink = (
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  tag: string,
  message: string,
  extra?: Record<string, unknown>,
) => void;

/**
 * Extract `error.code` from an OpenAI-style error envelope. Tolerates missing
 * or non-string codes; returns null for anything unparsable (the caller then
 * keeps the generic rate-limit classification).
 */
export function parseJevRelayErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || !code.trim()) {
    return null;
  }
  return code.trim();
}

/** Cap for the logged 4xx `detail` excerpt (Pydantic arrays can be long). */
export const JEV_RELAY_ERROR_DETAIL_MAX_CHARS = 500;

/**
 * Extract the `detail` field of a 4xx error body for the result-code log.
 * The relay passes the upstream Pydantic validation errors through verbatim
 * on a 400 `upstream_bad_request`, and FastAPI shapes them as a detail ARRAY
 * — so the value is logged as-is when it is a string and JSON-serialized
 * otherwise, capped so one malformed bundle cannot flood the log.
 */
export function extractJevRelayErrorDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const detail = (payload as { detail?: unknown }).detail;
  if (detail === undefined || detail === null) {
    return null;
  }
  const rendered = typeof detail === 'string' ? detail : JSON.stringify(detail);
  if (!rendered || !rendered.trim()) {
    return null;
  }
  return rendered.slice(0, JEV_RELAY_ERROR_DETAIL_MAX_CHARS);
}

/**
 * Classify an HTTP outcome. 429 splits by the envelope code (quota vs rate);
 * non-2xx/non-4xx/non-5xx statuses (a redirect or 1xx leaking out of the
 * net stack) fall to `network` — they are transport anomalies, not relay
 * verdicts.
 */
export function classifyJevRelayHttpStatus(status: number, errorCode?: string | null): JevRelayCallResultCode {
  if (status >= 200 && status < 300) {
    return 'ok';
  }
  if (status === 401) {
    return 'http_401';
  }
  if (status === 429) {
    return errorCode === JEV_FREE_QUOTA_EXHAUSTED_CODE ? 'http_429_quota' : 'http_429_rate';
  }
  if (status >= 400 && status < 500) {
    return 'http_4xx';
  }
  if (status >= 500 && status < 600) {
    return 'http_5xx';
  }
  return 'network';
}

/** Classify a thrown outcome: abort/timeout vs everything else. */
export function classifyJevRelayThrownError(error: unknown): JevRelayCallResultCode {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    return 'timeout';
  }
  return 'network';
}

/**
 * How long a http_429_quota verdict keeps the free-relay cerebellum off.
 * The quota cycle resets weekly, but probing every few minutes is free (the
 * relay rejects in <50ms) and self-heals both a reset AND a misclassified 429
 * without a restart.
 */
export const JEV_RELAY_QUOTA_BREAKER_MS = 5 * 60 * 1000;

function localDayKey(nowMs: number): string {
  const date = new Date(nowMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function percentileNearestRank(latencies: number[], share: number): number | null {
  if (latencies.length === 0) {
    return null;
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((share * sorted.length) / 100)));
  return Math.round(sorted[rank - 1]);
}

interface JevRelayDayAccumulator {
  counts: Partial<Record<JevRelayCallResultCode, number>>;
  latencies: number[];
}

// ---------------------------------------------------------------------------
// Default Node fetch (proxy-aware, fail-open)
// ---------------------------------------------------------------------------

/**
 * Default underlying fetch for the call context. Node's global fetch ignores
 * HTTPS_PROXY (the IDBots HTTP 451 region-block lesson), so when a proxy env
 * var is set we try to attach undici's EnvHttpProxyAgent as the dispatcher.
 * undici is not a declared dependency — if the dynamic import fails (or no
 * proxy is configured), this degrades fail-open to plain global fetch, which
 * NODE_USE_ENV_PROXY=1 (Node 24+) can also make proxy-aware natively.
 * Resolved once per client; the agent (when present) is reused for the host
 * lifetime.
 */
async function resolveDefaultNodeFetch(
  log?: (message: string) => void,
): Promise<(url: string, init: Record<string, unknown>) => Promise<Response>> {
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy
    ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? '';
  if (proxyUrl) {
    try {
      const undici = (await import('undici')) as unknown as {
        EnvHttpProxyAgent?: new () => unknown;
      };
      if (typeof undici.EnvHttpProxyAgent === 'function') {
        const dispatcher = new undici.EnvHttpProxyAgent();
        const fetchWithAgent = (url: string, init: Record<string, unknown>): Promise<Response> =>
          fetch(url, { ...init, dispatcher } as unknown as RequestInit);
        return fetchWithAgent;
      }
    } catch {
      log?.('cerebellum: HTTPS_PROXY is set but undici is unavailable; falling back to plain Node fetch (set NODE_USE_ENV_PROXY=1 on Node 24+ for native env-proxy support)');
    }
  }
  return (url: string, init: Record<string, unknown>) => fetch(url, init);
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export interface CerebellumClient {
  /** Credential chain (cache -> kv -> provider -> one shared bootstrap). */
  resolveJevRelayCredentials(): Promise<JevRelayCredentials>;
  /** Runtime cerebellum config for decision call sites (null = feature off). */
  resolveRuntimeConfig(appConfig: unknown): Promise<ResolvedCerebellumConfig | null>;
  /** The fetch stack for a resolved config (bounded -> [key-retry -> recorder]). */
  fetchFor(config: ResolvedCerebellumConfig): Promise<CerebellumFetchStack>;
  /** Opens the quota breaker (recorder does this automatically on quota 429). */
  noteQuotaExhaustion(nowMs?: number): void;
  /** True while the breaker is open — the free relay should be skipped. */
  isQuotaExhausted(nowMs?: number): boolean;
  /** Emit the current day's aggregate line and clear the accumulator. */
  flushCallStats(sink?: JevRelayLogSink | null): void;
  /** Testing hook: close the breaker, clear the accumulators and caches. */
  resetForTests(): void;
}

export type CerebellumFetchStack = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function createCerebellumClient(deps: JevRelayClientDeps = {}): CerebellumClient {
  const now: () => number = deps.now ?? Date.now;
  const fallbackSink: JevRelayLogSink = deps.sink ?? (() => {});

  let cachedCredentials: JevRelayCredentials | null = null;
  /**
   * Shared in-flight bootstrap. A revoked relay key surfaces as 401 on EVERY
   * decision call site of one turn (memory rank, skill shortlist, block gate,
   * …) at once; without sharing, each site fired its OWN identity-signed
   * bootstrap (IDBots 2026-10-15 first-sentence latency report: five parallel
   * bootstraps, each 15s+). One flight, everyone awaits it.
   */
  let bootstrapInFlight: Promise<JevRelayCredentials> | null = null;
  let quotaExhaustedUntil = 0;
  let activeDayStats: { dayKey: string; acc: JevRelayDayAccumulator } | null = null;
  let defaultFetch: ((url: string, init: Record<string, unknown>) => Promise<Response>) | null = deps.fetchImpl ?? null;
  let defaultFetchResolved = deps.fetchImpl != null;

  const readPersistedCredentials = (): JevRelayCredentials | null => {
    try {
      const store = deps.store ?? null;
      const apiKey = typeof store?.get(JEV_RELAY_API_KEY_KV) === 'string'
        ? (store.get(JEV_RELAY_API_KEY_KV) as string).trim()
        : '';
      const baseUrl = typeof store?.get(JEV_RELAY_BASE_URL_KV) === 'string'
        ? (store.get(JEV_RELAY_BASE_URL_KV) as string).trim()
        : '';
      if (apiKey && baseUrl) return { apiKey, baseUrl };
    } catch {
      // unreadable kv falls through to the next source
    }
    return null;
  };

  const readProviderCredentials = (): JevRelayCredentials | null => {
    try {
      return deps.readProviderCredentials?.() ?? null;
    } catch {
      // unreadable provider config falls through to bootstrap
      return null;
    }
  };

  const persistCredentials = (credentials: JevRelayCredentials): void => {
    try {
      const store = deps.store ?? null;
      if (store && typeof (store as { set?: unknown }).set === 'function') {
        store.set(JEV_RELAY_API_KEY_KV, credentials.apiKey);
        store.set(JEV_RELAY_BASE_URL_KV, credentials.baseUrl);
      }
    } catch {
      // persistence loss is non-fatal: the in-memory cache still serves this run
    }
  };

  const invalidateCredentials = (): void => {
    cachedCredentials = null;
    try {
      const store = deps.store ?? null;
      if (store && typeof (store as { delete?: unknown }).delete === 'function') {
        (store as Pick<CerebellumKvStore, 'delete'>).delete(JEV_RELAY_API_KEY_KV);
        (store as Pick<CerebellumKvStore, 'delete'>).delete(JEV_RELAY_BASE_URL_KV);
      }
    } catch {
      // best-effort
    }
  };

  /**
   * Resolve the relay key (+ chat baseUrl) for JEV calls. Order: in-memory
   * cache, persisted kv, the injected provider read, then a fresh
   * identity-signed bootstrap (persisted for later runs).
   */
  const resolveJevRelayCredentials = async (): Promise<JevRelayCredentials> => {
    if (cachedCredentials) return cachedCredentials;
    const persisted = readPersistedCredentials();
    if (persisted) {
      cachedCredentials = persisted;
      return persisted;
    }
    const fromProvider = readProviderCredentials();
    if (fromProvider) {
      cachedCredentials = fromProvider;
      persistCredentials(fromProvider);
      return fromProvider;
    }
    // One shared flight for concurrent resolvers (see bootstrapInFlight);
    // losers await the winner's result. A failed flight unshares in the
    // finally below so the next caller retries instead of latching the
    // rejection; a resolver that lost to an invalidated cache still returns
    // the freshest credentials any flight produced.
    if (!bootstrapInFlight) {
      bootstrapInFlight = (async () => {
        if (!deps.bootstrapImpl) {
          throw new Error('JEV relay bootstrap is not configured on this client');
        }
        const info = await deps.bootstrapImpl();
        const credentials = { apiKey: info.apiKey.trim(), baseUrl: info.baseUrl.trim() };
        if (!credentials.apiKey || !credentials.baseUrl) {
          throw new Error('JEV relay bootstrap returned no apiKey/baseUrl');
        }
        cachedCredentials = credentials;
        persistCredentials(credentials);
        return credentials;
      })().finally(() => {
        bootstrapInFlight = null;
      });
    }
    try {
      return await bootstrapInFlight;
    } catch (error) {
      if (cachedCredentials) return cachedCredentials;
      throw error;
    }
  };

  const noteQuotaExhaustion = (nowMs: number = now()): void => {
    quotaExhaustedUntil = nowMs + JEV_RELAY_QUOTA_BREAKER_MS;
  };

  const isQuotaExhausted = (nowMs: number = now()): boolean => nowMs < quotaExhaustedUntil;

  const emitDailyLine = (day: { dayKey: string; acc: JevRelayDayAccumulator }, sink: JevRelayLogSink): void => {
    const calls = day.acc.latencies.length;
    if (calls === 0) {
      return;
    }
    const counts: Record<string, number> = {};
    for (const [code, count] of Object.entries(day.acc.counts)) {
      if (count) {
        counts[code] = count;
      }
    }
    sink('INFO', 'jevRelay:daily', 'JEV relay daily result-code report', {
      date: day.dayKey,
      calls,
      okRate: Number(((day.acc.counts.ok ?? 0) / calls).toFixed(4)),
      counts,
      p50Ms: percentileNearestRank(day.acc.latencies, 50),
      p90Ms: percentileNearestRank(day.acc.latencies, 90),
    });
  };

  /**
   * Fold one classified outcome into the active day. The first call of a NEW
   * local day emits the previous day's aggregate line first, so exactly one
   * report per day lands in the log. Breaker maintenance rides along: quota
   * 429s open it, ok calls close it.
   */
  const recordCallResult = (
    code: JevRelayCallResultCode,
    latencyMs: number,
    sink: JevRelayLogSink,
    nowMs: number,
  ): void => {
    const dayKey = localDayKey(nowMs);
    if (!activeDayStats || activeDayStats.dayKey !== dayKey) {
      if (activeDayStats) {
        emitDailyLine(activeDayStats, sink);
      }
      activeDayStats = { dayKey, acc: { counts: {}, latencies: [] } };
    }
    activeDayStats.acc.counts[code] = (activeDayStats.acc.counts[code] ?? 0) + 1;
    activeDayStats.acc.latencies.push(Math.max(0, Math.round(latencyMs)));
    if (code === 'http_429_quota') {
      noteQuotaExhaustion(nowMs);
    } else if (code === 'ok') {
      quotaExhaustedUntil = 0;
    }
  };

  const flushCallStats = (sink: JevRelayLogSink | null = null): void => {
    const target = sink ?? fallbackSink;
    if (!target || !activeDayStats) {
      return;
    }
    emitDailyLine(activeDayStats, target);
    activeDayStats = null;
  };

  /**
   * Runtime cerebellum config for decision call sites. Wraps the pure
   * resolver: direct TypeSafe configs pass through untouched; the free
   * provider gets its relay key injected from the credential chain (baseUrl
   * and model are already pinned by the resolver). Never throws — a free
   * provider with no obtainable key maps to null so the cerebellum silently
   * stays off, exactly like enabled=false.
   *
   * While the quota breaker is open (a recent http_429_quota) the free
   * provider maps to null WITHOUT a key resolution: skipping the call
   * entirely keeps per-turn logs clean and avoids burning the 1.5s budget on
   * a known-dead path. The breaker expires on its own so a reset cycle (or a
   * server-side fix) self-heals.
   */
  const resolveRuntimeConfig = async (appConfig: unknown): Promise<ResolvedCerebellumConfig | null> => {
    const config = resolveCerebellumConfig(appConfig);
    if (!config || config.provider !== CEREBELLUM_FREE_PROVIDER) {
      return config;
    }
    if (isQuotaExhausted()) {
      return null;
    }
    try {
      const { apiKey } = await resolveJevRelayCredentials();
      if (!apiKey) {
        return null;
      }
      return { ...config, apiKey };
    } catch {
      // bootstrap failure (offline, relay down, not configured): feature off
      // for this call
      return null;
    }
  };

  /**
   * fetch wrapper for free-provider cerebellum calls: on a 401 (revoked relay
   * key) it re-bootstraps ONCE and retries the same request with the fresh
   * key. Any failure (including a second 401) returns the last response
   * unchanged — the decision call sites keep their catch-to-null paths.
   *
   * The caller's AbortSignal bounds the whole wrapper, re-bootstrap included
   * (IDBots 2026-10-15 first-sentence lesson): decision call sites run 1.5s
   * budgets; the identity-signed bootstrap has been observed taking 15s+ and
   * used to blow straight through that budget. On abort the stale 401 returns
   * immediately and the shared bootstrap keeps running in the background —
   * the next turn finds the fresh key cached.
   */
  const createKeyRetryFetch = <R extends { ok: boolean; status: number }>(
    fetchImpl: (url: string, init: Record<string, unknown>) => Promise<R>,
  ): ((url: string, init: Record<string, unknown>) => Promise<R>) =>
    async (url, init) => {
      const first = await fetchImpl(url, init);
      if (first.status !== 401) {
        return first;
      }
      const signal = (init as { signal?: AbortSignal | null }).signal ?? null;
      if (signal?.aborted) {
        return first;
      }
      try {
        invalidateCredentials();
        const { apiKey } = await raceAbortSignal(resolveJevRelayCredentials(), signal);
        const headers = {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${apiKey}`,
        };
        return await fetchImpl(url, { ...init, headers });
      } catch {
        return first;
      }
    };

  /**
   * Result-code recorder riding OUTERMOST on the free-relay fetch stack so
   * one recorded outcome covers the whole logical call, bootstrap retry
   * included. 4xx/429 bodies are read ONCE and callers get a reconstructed
   * response whose json() replays the SAME parsed body — no call site can
   * consume the stream twice; 2xx/5xx responses pass through untouched.
   * Thrown errors are classified, recorded, and re-thrown so the decision
   * call sites keep their catch-to-null paths (an AbortError classifies as
   * `timeout`).
   */
  const createCallRecorder = <R extends { ok: boolean; status: number; json(): Promise<unknown> }>(
    fetchImpl: (url: string, init: Record<string, unknown>) => Promise<R>,
    options?: { sink?: JevRelayLogSink; now?: () => number },
  ): ((url: string, init: Record<string, unknown>) => Promise<R>) => {
    const sink: JevRelayLogSink = options?.sink ?? fallbackSink;
    const clock: () => number = options?.now ?? now;
    return async (url, init) => {
      const startedAt = clock();
      let response: R;
      try {
        response = await fetchImpl(url, init);
        if (response.status === 429) {
          let parsed: unknown = null;
          let parsedOk = false;
          try {
            parsed = await response.json();
            parsedOk = true;
          } catch {
            // Non-JSON 429 body: rate-limit classification stands.
          }
          const errorCode = parsedOk ? parseJevRelayErrorCode(parsed) : null;
          const result = classifyJevRelayHttpStatus(response.status, errorCode);
          const latencyMs = clock() - startedAt;
          recordCallResult(result, latencyMs, sink, clock());
          sink('INFO', 'jevRelay:call', 'JEV relay call finished', {
            endpoint: url.endsWith('/v1/systemone') ? '/v1/systemone' : url.endsWith('/v1/models') ? '/v1/models' : url,
            result,
            status: response.status,
            errorCode,
            latencyMs,
          });
          if (parsedOk) {
            const body = parsed;
            return { ok: response.ok, status: response.status, json: async () => body } as unknown as R;
          }
          return response;
        }
        if (response.status >= 400 && response.status < 500) {
          // A non-429 4xx verdict: read the JSON body ONCE, log the envelope
          // code + the `detail` excerpt (the relay forwards the upstream
          // Pydantic validation info on a 400 upstream_bad_request), and hand
          // callers the same reconstructed replay-the-body response the 429
          // path established. A non-JSON body keeps the generic
          // classification.
          let parsed: unknown = null;
          let parsedOk = false;
          try {
            parsed = await response.json();
            parsedOk = true;
          } catch {
            // Non-JSON 4xx body: the generic classification stands.
          }
          const errorCode = parsedOk ? parseJevRelayErrorCode(parsed) : null;
          const detail = parsedOk ? extractJevRelayErrorDetail(parsed) : null;
          const result = classifyJevRelayHttpStatus(response.status, errorCode);
          const latencyMs = clock() - startedAt;
          recordCallResult(result, latencyMs, sink, clock());
          sink('INFO', 'jevRelay:call', 'JEV relay call finished', {
            endpoint: url.endsWith('/v1/systemone') ? '/v1/systemone' : url.endsWith('/v1/models') ? '/v1/models' : url,
            result,
            status: response.status,
            errorCode,
            detail,
            latencyMs,
          });
          if (parsedOk) {
            const body = parsed;
            return { ok: response.ok, status: response.status, json: async () => body } as unknown as R;
          }
          return response;
        }
        const result = classifyJevRelayHttpStatus(response.status);
        const latencyMs = clock() - startedAt;
        recordCallResult(result, latencyMs, sink, clock());
        sink('INFO', 'jevRelay:call', 'JEV relay call finished', {
          endpoint: url.endsWith('/v1/systemone') ? '/v1/systemone' : url.endsWith('/v1/models') ? '/v1/models' : url,
          result,
          status: response.status,
          latencyMs,
        });
        return response;
      } catch (error) {
        const result = classifyJevRelayThrownError(error);
        const latencyMs = clock() - startedAt;
        recordCallResult(result, latencyMs, sink, clock());
        sink('INFO', 'jevRelay:call', 'JEV relay call finished', {
          endpoint: url.endsWith('/v1/systemone') ? '/v1/systemone' : url.endsWith('/v1/models') ? '/v1/models' : url,
          result,
          status: null,
          latencyMs,
        });
        throw error;
      }
    };
  };

  const ensureDefaultFetch = async (): Promise<(url: string, init: Record<string, unknown>) => Promise<Response>> => {
    if (!defaultFetchResolved) {
      defaultFetch = await resolveDefaultNodeFetch(
        deps.sink ? (message) => deps.sink!('WARN', 'cerebellum:fetch', message) : undefined,
      );
      defaultFetchResolved = true;
    }
    return defaultFetch!;
  };

  /**
   * The fetch stack for a resolved config — port of IDBots
   * `cerebellumFetchFor`: signal-bounded FIRST (our own race enforces the
   * deadline even when the platform fetch stalls); the free relay layers the
   * 401 key-retry wrapper on top (its retry rides the same bounded fetch);
   * the result-code recorder rides OUTERMOST so one recorded outcome covers
   * the whole logical call, bootstrap retry included. Direct providers ride
   * the bounded fetch alone (no relay, no recorder — there is no relay result
   * code to record).
   */
  const fetchFor = async (config: ResolvedCerebellumConfig): Promise<CerebellumFetchStack> => {
    const rawFetch = createSignalBoundedFetch(await ensureDefaultFetch());
    if (config.provider !== CEREBELLUM_FREE_PROVIDER) {
      return rawFetch as unknown as CerebellumFetchStack;
    }
    return createCallRecorder(createKeyRetryFetch(rawFetch)) as unknown as CerebellumFetchStack;
  };

  const resetForTests = (): void => {
    cachedCredentials = null;
    bootstrapInFlight = null;
    quotaExhaustedUntil = 0;
    activeDayStats = null;
  };

  return {
    resolveJevRelayCredentials,
    resolveRuntimeConfig,
    fetchFor,
    noteQuotaExhaustion,
    isQuotaExhausted,
    flushCallStats,
    resetForTests,
  };
}

// ---------------------------------------------------------------------------
// Plugin binding (config-kv read, default OFF)
// ---------------------------------------------------------------------------

/** The plugin-config cerebellum section (mirrors the IDBots app_config shape). */
export interface CerebellumPluginConfigSection {
  enabled?: boolean;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface CerebellumRuntime {
  /** Resolve the per-call context (null = feature off for this call). */
  resolveCallContext(): Promise<{ config: ResolvedCerebellumConfig; fetchImpl: CerebellumFetchStack } | null>;
  /** The underlying client (tests; later gate/ranker PRs). */
  client: CerebellumClient;
}

/**
 * Bind the cerebellum core from the plugin config. DEFAULT OFF: with
 * `enabled !== true` (or the section absent) the runtime resolves null on
 * every call and NOTHING on any turn path is consulted — behavior is
 * byte-identical to a build without this module. Even when enabled, PR-1
 * wires no turn-path consumers; the gates/rankers/effort hooks land in later
 * PRs. The free-relay credential seams stay un-wired in PR-1, so the free
 * provider resolves null until the OAC relay integration is decided
 * upstream (design doc §5.5) — the direct `typesafe-jev` provider with an
 * explicit API key works end-to-end.
 */
export function bindCerebellumCore(
  section: CerebellumPluginConfigSection | undefined,
  deps: JevRelayClientDeps = {},
): CerebellumRuntime {
  const client = createCerebellumClient(deps);
  const appConfigShape = section && section.enabled === true
    ? { cerebellum: section as unknown as Record<string, unknown> }
    : { cerebellum: undefined };
  return {
    client,
    resolveCallContext: async () => {
      const config = await client.resolveRuntimeConfig(appConfigShape);
      if (!config) {
        return null;
      }
      return { config, fetchImpl: await client.fetchFor(config) };
    },
  };
}
