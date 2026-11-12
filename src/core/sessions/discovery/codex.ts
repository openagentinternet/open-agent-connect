/**
 * Passive discovery for Codex sessions (local session adapters P1).
 *
 * Codex keeps `~/.codex/session_index.jsonl`, one JSON object per line:
 * `{"id","thread_name","updated_at"}` (verified against a live install —
 * the index carries no cwd and no pid). Entries give the directory a
 * session id and a what-it-is-doing title; presence freshness is the
 * updated_at timestamp, since there is no process to probe. P1 treats
 * these as presence-only (deliverable=false) until a P2+ registration
 * path claims them.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DiscoveredSession } from '../types';

export interface CodexIndexEntry {
  id: string;
  threadName?: string;
  /** ISO timestamp string, as written by Codex. */
  updatedAt?: string;
}

export function parseCodexSessionIndexLine(raw: string): CodexIndexEntry | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : null;
  if (!id) {
    return null;
  }
  return {
    id,
    threadName: typeof record.thread_name === 'string' && record.thread_name.trim()
      ? record.thread_name.trim()
      : undefined,
    updatedAt: typeof record.updated_at === 'string' && record.updated_at.trim()
      ? record.updated_at.trim()
      : undefined,
  };
}

export function codexUpdatedAtMs(entry: CodexIndexEntry): number {
  if (!entry.updatedAt) {
    return 0;
  }
  const parsed = Date.parse(entry.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface ScanCodexSessionsOptions {
  /** Overrides `~/.codex` (tests). The scanner reads `<codexDir>/session_index.jsonl`. */
  codexDir?: string;
  /** Epoch ms "now"; defaults to Date.now() (tests). */
  now?: () => number;
  /** Entries older than this are skipped (default 24h — the registry's lapse TTL). */
  freshWindowMs?: number;
}

export async function scanCodexSessions(
  options: ScanCodexSessionsOptions = {},
): Promise<DiscoveredSession[]> {
  const codexDir = options.codexDir ?? path.join(os.homedir(), '.codex');
  const indexPath = path.join(codexDir, 'session_index.jsonl');
  const now = options.now ?? Date.now;
  const freshWindowMs = options.freshWindowMs ?? 24 * 60 * 60_000;

  let raw: string;
  try {
    raw = await fs.readFile(indexPath, 'utf8');
  } catch {
    return [];
  }

  const discovered = new Map<string, DiscoveredSession & { observedAt?: number }>();
  for (const line of raw.split('\n')) {
    const entry = parseCodexSessionIndexLine(line);
    if (!entry) {
      continue;
    }
    const updatedAtMs = codexUpdatedAtMs(entry);
    // Later lines win for the same id in Codex's append order: refresh the
    // title and observation time instead of skipping.
    const existing = discovered.get(entry.id);
    if (existing) {
      existing.doing = entry.threadName ?? existing.doing;
      existing.observedAt = updatedAtMs || existing.observedAt;
      continue;
    }
    if (updatedAtMs > 0 && now() - updatedAtMs > freshWindowMs) {
      continue;
    }
    discovered.set(entry.id, {
      agent: 'codex',
      sessionId: entry.id,
      doing: entry.threadName,
      status: 'unknown',
      startedAt: 0,
      observedAt: updatedAtMs || undefined,
    });
  }
  return [...discovered.values()];
}
