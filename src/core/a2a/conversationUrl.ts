/**
 * Canonical builders for the Conversations local-UI surface.
 *
 * The Conversations page (`/ui/conversations`) is the unified, live-updating
 * view for watching two bots interact — it renders both private-chat messages
 * and skill-service (order protocol) interactions in a single thread. It
 * deep-links via `?local=<globalMetaId>&peer=<globalMetaId>`.
 *
 * Every runtime producer that used to emit a `/ui/trace` URL should emit a
 * Conversations URL built here instead. The legacy `/ui/trace` route is kept
 * only as a 302 redirect to `/ui/conversations` (with parameter translation)
 * so existing bookmarks and persisted links keep working.
 */

/**
 * Daemon record shape used to resolve an absolute Conversations URL. Only the
 * `baseUrl` field is read; accepting a broader record keeps callers ergonomic
 * (they already hold a `RuntimeDaemonRecord`-like value).
 */
export interface ConversationDaemonRef {
  baseUrl?: string | null;
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/**
 * Build an absolute Conversations URL for a local↔peer bot pair.
 *
 * Returns `undefined` when the daemon has no `baseUrl` or either side of the
 * conversation is missing — mirroring the "no daemon → no URL" contract of the
 * legacy `buildDaemonLocalUiUrl` helper. Producers should treat `undefined` as
 * "do not surface a link".
 */
export function buildConversationLocalUiUrl(
  daemon: ConversationDaemonRef | null | undefined,
  localGlobalMetaId: string | null | undefined,
  peerGlobalMetaId: string | null | undefined,
): string | undefined {
  const baseUrl = normalizeText(daemon?.baseUrl);
  const local = normalizeText(localGlobalMetaId);
  const peer = normalizeText(peerGlobalMetaId);
  if (!baseUrl || !local || !peer) {
    return undefined;
  }
  const url = new URL('/ui/conversations', baseUrl);
  url.searchParams.set('local', local);
  url.searchParams.set('peer', peer);
  return url.toString();
}

/**
 * Build a browser-relative Conversations href for in-page links (no host).
 *
 * Returns the bare `/ui/conversations` path when either id is missing so that
 * UI affordances always navigate somewhere useful rather than 404.
 */
export function buildConversationHref(
  localGlobalMetaId: string | null | undefined,
  peerGlobalMetaId: string | null | undefined,
): string {
  const local = normalizeText(localGlobalMetaId);
  const peer = normalizeText(peerGlobalMetaId);
  const query = new URLSearchParams();
  if (local) query.set('local', local);
  if (peer) query.set('peer', peer);
  const queryString = query.toString();
  return queryString ? `/ui/conversations?${queryString}` : '/ui/conversations';
}
