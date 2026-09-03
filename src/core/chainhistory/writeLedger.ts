// Chain write ledger: a Signer wrapper that mirrors every successful chain
// write into the per-bot chain history store (storage layout v2 amendment
// 2026-09-03). Private/group chat pins and identity-sync pins are excluded —
// they are already persisted by their own stores. Recording is best-effort
// and idempotent per pinId: failures are logged and swallowed, never
// propagated into the chain write path, and overlapping wrappers cannot
// duplicate a record.
import type { ChainWriteRequest } from '../chain/writePin';
import type { Signer } from '../signing/signer';
import type { MetabotPaths } from '../state/paths';
import { createChainHistoryStore, type ChainHistoryStore } from './store';

// Private chat, group chat, and group task pins are persisted by their own
// chat stores; identity sync pins under `/info/` are republished state, not
// user content.
const EXCLUDED_EXACT_PATHS = new Set([
  '/protocols/simplemsg',
  '/protocols/simplegroupcreate',
  '/protocols/simplegroupjoin',
  '/protocols/simplegroupchat',
  '/protocols/simplegroupremoveuser',
]);
const EXCLUDED_PATH_PREFIX = '/info/';

/** Whether a chain write to `path` belongs in the chain history store. */
export function shouldRecordChainWrite(path: string | null | undefined): boolean {
  if (!path) {
    return true;
  }
  if (EXCLUDED_EXACT_PATHS.has(path)) {
    return false;
  }
  return !path.startsWith(EXCLUDED_PATH_PREFIX);
}

export interface WrapSignerWithChainHistoryDeps {
  store?: ChainHistoryStore;
  warn?: (message: string) => void;
}

/** Map one write request payload to the store's content fields: full text for
 * plain string payloads (the store caps/truncates it), byte counts only for
 * base64 strings and Buffers. */
function describeWritePayload(request: ChainWriteRequest): { contentText: string | null; contentBytes?: number } {
  const payload = request.payload;
  if (typeof payload === 'string') {
    if (request.encoding === 'base64') {
      return { contentText: null, contentBytes: Buffer.from(payload, 'base64').byteLength };
    }
    return { contentText: payload };
  }
  if (Buffer.isBuffer(payload)) {
    return { contentText: null, contentBytes: payload.byteLength };
  }
  return { contentText: null, contentBytes: 0 };
}

/** Wrap `signer` so every successful writePin is recorded under
 * `paths.chainHistoryRoot`. Identity reads delegate unchanged; a failed
 * writePin propagates unchanged and is never recorded. */
export function wrapSignerWithChainHistory(
  signer: Signer,
  paths: MetabotPaths,
  deps: WrapSignerWithChainHistoryDeps = {},
): Signer {
  const store = deps.store ?? createChainHistoryStore(paths);
  const warn = deps.warn ?? console.warn;
  return {
    getIdentity: () => signer.getIdentity(),
    getPrivateChatIdentity: () => signer.getPrivateChatIdentity(),
    writePin: async (request) => {
      const result = await signer.writePin(request);
      const pinId = typeof result.pinId === 'string' ? result.pinId.trim() : '';
      if (!pinId || !shouldRecordChainWrite(request.path)) {
        return result;
      }
      try {
        await store.recordWrite({
          pinId,
          txId: result.txids?.[0] ?? null,
          path: request.path ?? null,
          operation: request.operation ?? result.operation ?? null,
          network: request.network ?? result.network ?? null,
          ...describeWritePayload(request),
          contentType: request.contentType ?? null,
          occurredAtMs: Date.now(),
        });
      } catch (error) {
        warn(`[chain-history] failed to record chain write: ${error instanceof Error ? error.message : String(error)}`);
      }
      return result;
    },
  };
}
