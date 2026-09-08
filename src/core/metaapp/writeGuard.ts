/**
 * Idempotency window + per-app write serialization for MetaApp chain writes.
 * Ported from the IDBots metaAppOwnerService behavior: a 60 s idempotency
 * window keyed on a stable hash of the write short-circuits double-clicks
 * and LLM retries (two same-semantics calls must not each hit the chain and
 * create duplicate root pins), and per-app mutexes serialize modify/revoke
 * writes against one root pin. In-memory by design: the window only covers
 * immediate retries inside the daemon process.
 */
import { createHash } from 'node:crypto';
import { commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';

export const METAAPP_WRITE_IDEMPOTENCY_WINDOW_MS = 60_000;

type MetaAppWriteCommandResult = MetabotCommandResult<Record<string, unknown>>;

export function stableMetaAppWriteHash(kind: string, parts: Array<string | undefined | null>): string {
  return createHash('sha256')
    .update(JSON.stringify([kind, ...parts.map((part) => (part ?? '').trim())]), 'utf8')
    .digest('hex');
}

export interface MetaAppWriteGuard {
  run(input: {
    idemKey: string;
    lockKey?: string;
    fn: () => Promise<MetaAppWriteCommandResult>;
  }): Promise<MetaAppWriteCommandResult>;
}

export function createMetaAppWriteGuard(input?: {
  now?: () => number;
  windowMs?: number;
}): MetaAppWriteGuard {
  const now = input?.now ?? Date.now;
  const windowMs = input?.windowMs ?? METAAPP_WRITE_IDEMPOTENCY_WINDOW_MS;
  const recent = new Map<string, { at: number; result: MetaAppWriteCommandResult }>();
  const locks = new Map<string, Promise<void>>();

  const prune = (): void => {
    const at = now();
    for (const [key, entry] of recent) {
      if (at - entry.at >= windowMs) recent.delete(key);
    }
  };

  const replay = (entry: { result: MetaAppWriteCommandResult }): MetaAppWriteCommandResult => {
    const { result } = entry;
    if (!result.ok || result.state !== 'success' || !result.data || typeof result.data !== 'object') {
      return result;
    }
    return commandSuccess({ ...(result.data as Record<string, unknown>), idempotent: true });
  };

  const lookup = (idemKey: string): MetaAppWriteCommandResult | null => {
    prune();
    const entry = recent.get(idemKey);
    return entry ? replay(entry) : null;
  };

  const runLocked = async <T>(lockKey: string | undefined, fn: () => Promise<T>): Promise<T> => {
    if (!lockKey) return fn();
    const previous = locks.get(lockKey) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    locks.set(lockKey, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(lockKey) === tail) locks.delete(lockKey);
    }
  };

  return {
    run: async ({ idemKey, lockKey, fn }) => {
      const cached = lookup(idemKey);
      if (cached) return cached;
      return runLocked(lockKey, async () => {
        // Re-check after waiting on the app lock: the call we queued behind
        // may have been the identical retry, already written by the holder.
        const awaited = lookup(idemKey);
        if (awaited) return awaited;
        const result = await fn();
        if (result.ok && result.state === 'success') {
          recent.set(idemKey, { at: now(), result });
        }
        return result;
      });
    },
  };
}
