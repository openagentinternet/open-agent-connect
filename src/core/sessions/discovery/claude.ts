/**
 * Passive discovery for Claude Code sessions (local session adapters P1).
 *
 * Claude Code keeps one `~/.claude/sessions/<pid>.json` per live session
 * (camelCase fields: pid, sessionId, cwd, name, nameSource, status,
 * statusUpdatedAt, startedAt, messagingSocketPath — the same registry
 * reason-network reads). Reading it lists every Claude session on this
 * machine, including ones without any OAC wiring. P1 treats these as
 * presence-only: they appear in the directory but cannot receive mail
 * (deliverable=false) until a P2+ registration path claims them.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DiscoveredSession, SessionActivityStatus } from '../types';

export interface ClaudeRegistrySession {
  pid: number;
  sessionId?: string;
  cwd?: string;
  name?: string;
  /** `user` after a /rename; `derived`/`auto` for host-made names. */
  nameSource?: string;
  status?: string;
  statusUpdatedAt?: number;
  startedAt?: number;
  /** Where the session takes peer messages (P3's push adapter; unused in P1). */
  messagingSocketPath?: string;
}

/** Default liveness probe: signal 0 (no-op) — false when the pid is gone. */
export function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function parseClaudeSessionFile(raw: string): ClaudeRegistrySession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const pid = typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0
    ? record.pid
    : null;
  if (pid === null) {
    return null;
  }
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;
  return {
    pid,
    sessionId: text(record.sessionId),
    cwd: text(record.cwd),
    name: text(record.name),
    nameSource: text(record.nameSource),
    status: text(record.status),
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : undefined,
    messagingSocketPath: text(record.messagingSocketPath),
  };
}

function normalizeActivityStatus(raw: string | undefined): SessionActivityStatus {
  return raw === 'busy' || raw === 'idle' ? raw : 'unknown';
}

/** Epoch values may arrive in seconds or ms; normalize to ms heuristically. */
export function epochToMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value < 10_000_000_000 ? value * 1_000 : value;
}

/** Claude Code's own names can be sentences; slug them down (3 words when auto-derived). */
function displayName(session: ClaudeRegistrySession): string | undefined {
  const name = session.name?.trim();
  if (!name) {
    return undefined;
  }
  const shortened = session.nameSource === 'auto'
    ? name.split(/\s+/).slice(0, 3).join(' ')
    : name;
  return shortened || undefined;
}

export interface ScanClaudeSessionsOptions {
  /** Overrides `~/.claude` (tests). The scanner reads `<claudeDir>/sessions`. */
  claudeDir?: string;
  pidAlive?: (pid: number) => boolean;
  /** Epoch ms "now"; defaults to Date.now() (tests). */
  now?: () => number;
}

export async function scanClaudeSessions(
  options: ScanClaudeSessionsOptions = {},
): Promise<DiscoveredSession[]> {
  const claudeDir = options.claudeDir ?? path.join(os.homedir(), '.claude');
  const sessionsDir = path.join(claudeDir, 'sessions');
  const pidAlive = options.pidAlive ?? defaultPidAlive;
  const now = options.now ?? Date.now;

  let fileNames: string[];
  try {
    fileNames = await fs.readdir(sessionsDir);
  } catch {
    return [];
  }

  const seenPids = new Set<number>();
  const discovered: DiscoveredSession[] = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith('.json')) {
      continue;
    }
    let raw: string;
    try {
      raw = await fs.readFile(path.join(sessionsDir, fileName), 'utf8');
    } catch {
      continue;
    }
    const session = parseClaudeSessionFile(raw);
    if (!session || seenPids.has(session.pid) || !pidAlive(session.pid)) {
      continue;
    }
    seenPids.add(session.pid);
    let lastSeenAt = now();
    try {
      const stats = await fs.stat(path.join(sessionsDir, fileName));
      lastSeenAt = Math.max(stats.mtimeMs, 0) || lastSeenAt;
    } catch {
      // mtime is an optimization; fall back to scan time.
    }
    discovered.push({
      agent: 'claude-code',
      sessionId: session.sessionId,
      pid: session.pid,
      cwd: session.cwd,
      name: displayName(session),
      doing: session.nameSource === 'auto' ? session.name : undefined,
      status: normalizeActivityStatus(session.status),
      startedAt: epochToMs(session.startedAt),
      inboxSocketPath: session.messagingSocketPath,
    });
  }
  return discovered;
}
