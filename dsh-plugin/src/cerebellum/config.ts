/**
 * Cerebellum (小脑) config resolver — port of IDBots
 * src/main/libs/cerebellumConfig.ts @ commit d75bea8ac2249da4886bfa0f6f1db838d234ef1f
 * (byte-synced semantics; only this header and the file location differ).
 *
 * The cerebellum is an optional fast decision model (first provider:
 * TypeSafe JEV, POST {baseUrl}/v1/systemone) layered next to the generative
 * "brain" LLM. This resolver is the single seam future decision call sites
 * (memory ranking, intent routing, ...) read; it returns null whenever the
 * feature is off or unusable, so callers need no shape checks of their own.
 * The second provider, idbots-jev-free, rides the official free relay with
 * the same wire shape — its relay key is injected at call time (see
 * cerebellum/client.ts), so an empty apiKey resolves fine here.
 *
 * OAC difference from IDBots: the plugin ships the cerebellum DISABLED by
 * default (IDBots' desktop default is the free relay ON). Enabling changes
 * what a headless host sends to a third-party endpoint — a consent decision,
 * not a port detail (design doc §5.1, talking point §5.5).
 */

export type CerebellumProvider = 'typesafe-jev' | 'idbots-jev-free';

export interface ResolvedCerebellumConfig {
  provider: CerebellumProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const CEREBELLUM_DEFAULT_BASE_URL = 'https://api.typesafe.ai';
export const CEREBELLUM_DEFAULT_MODEL = 'jev-latest';

/**
 * Official free relay provider: assist-base-service proxies the TypeSafe JEV
 * upstream and holds the real upstream key server-side, so users need no
 * TypeSafe key of their own. The wire shape is identical to `typesafe-jev`
 * (POST {baseUrl}/v1/systemone), only the credentials differ: a free-quota
 * relay key (mrk_...) resolved at runtime — see the relay client in
 * cerebellum/client.ts.
 */
export const CEREBELLUM_FREE_PROVIDER = 'idbots-jev-free' as const;
/** Hardcoded JEV relay base (backend doc《JEV 小脑模型中转接口.md》§3). */
export const CEREBELLUM_FREE_RELAY_BASE_URL = 'https://www.metaso.network/assist-open-api/v2/assist/llm/jev';
export const CEREBELLUM_FREE_MODEL = 'jev-latest';

const CEREBELLUM_PROVIDERS: readonly string[] = ['typesafe-jev', 'idbots-jev-free'];

/**
 * Resolve the stored config (the `cerebellum` envelope) into a ready-to-use
 * cerebellum config, or null when the feature is disabled, missing,
 * malformed, or has no API key. Never throws: every shape anomaly maps to
 * null.
 */
export function resolveCerebellumConfig(appConfig: unknown): ResolvedCerebellumConfig | null {
  if (!appConfig || typeof appConfig !== 'object') {
    return null;
  }
  const raw = (appConfig as { cerebellum?: unknown }).cerebellum;
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate.enabled !== true) {
    return null;
  }
  if (typeof candidate.provider !== 'string' || !CEREBELLUM_PROVIDERS.includes(candidate.provider)) {
    return null;
  }
  const isFreeProvider = candidate.provider === CEREBELLUM_FREE_PROVIDER;
  // Free provider: the apiKey comes from the relay credential chain at call
  // time, so an empty stored key is valid here (the runtime resolver injects
  // it or disables the feature); baseUrl/model are fixed to the relay values
  // regardless of what is stored. Direct TypeSafe keeps requiring a key.
  const apiKey = typeof candidate.apiKey === 'string' ? candidate.apiKey.trim() : '';
  if (!apiKey && !isFreeProvider) {
    return null;
  }

  let baseUrl: string;
  let model: string;
  if (isFreeProvider) {
    baseUrl = CEREBELLUM_FREE_RELAY_BASE_URL;
    model = CEREBELLUM_FREE_MODEL;
  } else {
    const rawBaseUrl = typeof candidate.baseUrl === 'string' ? candidate.baseUrl.trim() : '';
    baseUrl = (rawBaseUrl || CEREBELLUM_DEFAULT_BASE_URL).replace(/\/+$/, '');
    model = typeof candidate.model === 'string' && candidate.model.trim()
      ? candidate.model.trim()
      : CEREBELLUM_DEFAULT_MODEL;
  }

  if (!baseUrl) {
    return null;
  }

  return {
    provider: candidate.provider as CerebellumProvider,
    apiKey,
    baseUrl,
    model,
  };
}
