/**
 * Content-hash ledger for chain writes with unknown broadcast finality.
 * When a broadcast's outcome is unknown (timeout / network drop), the daemon
 * records the attempt keyed by a stable content hash. A retry of identical
 * content soon after returns the recorded candidates instead of blindly
 * re-broadcasting — the definitive fix for "error shown → user retries →
 * duplicate on-chain note".
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface ChainWriteAttemptRecord {
  contentHash: string;
  kind: string;
  candidateTxids: string[];
  at: number;
  message: string;
}

const RETENTION_MS = 24 * 60 * 60 * 1000;

function attemptsPath(systemHomeDir: string): string {
  return path.join(systemHomeDir, '.metabot', 'runtime', 'state', 'chain-write-attempts.json');
}

async function readAttempts(filePath: string): Promise<ChainWriteAttemptRecord[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { attempts?: unknown };
    return Array.isArray(parsed?.attempts)
      ? (parsed.attempts as ChainWriteAttemptRecord[]).filter((row) => row && typeof row.contentHash === 'string')
      : [];
  } catch {
    return [];
  }
}

export function stableChainWriteHash(kind: string, parts: Array<string | undefined | null>): string {
  return createHash('sha256')
    .update(JSON.stringify([kind, ...parts.map((part) => (part ?? '').trim())]), 'utf8')
    .digest('hex');
}

export interface ChainWriteAttemptStore {
  /** A recent (<=24h) unknown-broadcast attempt for this hash, if any. */
  findRecent(contentHash: string, now?: number): Promise<ChainWriteAttemptRecord | null>;
  record(input: Omit<ChainWriteAttemptRecord, 'at'>): Promise<void>;
}

export function createChainWriteAttemptStore(systemHomeDir: string): ChainWriteAttemptStore {
  const filePath = attemptsPath(systemHomeDir);
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  async function writePruned(attempts: ChainWriteAttemptRecord[], now: number): Promise<void> {
    const kept = attempts.filter((row) => now - row.at < RETENTION_MS).slice(-500);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify({ attempts: kept }, null, 2), 'utf8');
    await fs.rename(tmpPath, filePath);
  }

  return {
    findRecent: async (contentHash, now = Date.now()) => {
      const attempts = await readAttempts(filePath);
      return attempts.find((row) => row.contentHash === contentHash && now - row.at < RETENTION_MS) ?? null;
    },
    record: (input) => enqueue(async () => {
      const now = Date.now();
      const attempts = await readAttempts(filePath);
      attempts.push({ ...input, at: now });
      await writePruned(attempts, now);
    }),
  };
}
