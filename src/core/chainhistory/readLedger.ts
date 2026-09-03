// Chain read ledger: maps a MetaWeb pin read result into the per-bot chain
// history store (storage layout v2 amendment 2026-09-03) and records it
// best-effort. Every reader surface (interactive `read_metaweb_pin` tool,
// unattended study jobs) funnels through these helpers so a read failure in
// the ledger never breaks the read itself: errors are logged with a
// `[chain-history]` prefix and swallowed, never propagated.
import type { MetawebPin } from '../metaweb/pinRead';
import type { MetabotPaths } from '../state/paths';
import { createChainHistoryStore } from './store';
import type { RecordChainReadInput } from './types';

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Map one MetaWeb pin to a recordRead input. Returns null when the pin has
 * no usable pinId (nothing to key the record on). Tolerates missing nested
 * fields (`meta`, `creator`) on partial pin shapes. */
export function readInputFromMetawebPin(pin: MetawebPin, source: string): RecordChainReadInput | null {
  const pinId = textOrNull(pin?.pinId);
  if (!pinId) {
    return null;
  }
  return {
    pinId,
    path: textOrNull(pin.path),
    protocol: textOrNull(pin.protocol),
    title: textOrNull(pin.meta?.title),
    authorGlobalMetaId: textOrNull(pin.creator?.globalMetaId),
    contentText: typeof pin.text === 'string' && pin.text ? pin.text : null,
    source: textOrNull(source),
  };
}

export interface RecordMetawebPinReadDeps {
  warn?: (message: string) => void;
}

/** Record one MetaWeb pin read into the chain history store. Best-effort:
 * never throws; store failures go to `warn` (default console.warn). */
export async function recordMetawebPinRead(
  paths: MetabotPaths,
  pin: MetawebPin,
  source: string,
  deps: RecordMetawebPinReadDeps = {},
): Promise<void> {
  const warn = deps.warn ?? console.warn;
  try {
    const input = readInputFromMetawebPin(pin, source);
    if (!input) {
      return;
    }
    await createChainHistoryStore(paths).recordRead(input);
  } catch (error) {
    warn(`[chain-history] failed to record chain read: ${error instanceof Error ? error.message : String(error)}`);
  }
}
