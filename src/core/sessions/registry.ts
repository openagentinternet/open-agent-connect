/**
 * Local session registry (local session adapters P1).
 *
 * Machine-wide directory of local agent sessions, persisted at
 * `<systemHome>/.metabot/sessions/local-sessions.json` (0600, atomic
 * write-then-rename; sessions are machine facts, not per-profile state).
 *
 * Discipline borrowed from reason-network:
 * - names stay with their conversation key (`<agent>:<session-id>`): a
 *   re-registered session keeps its name, a new session never takes a
 *   kept name (it gets `-2`/`-3`);
 * - sessions read as alive while seen within 10 minutes and lapse 24 hours
 *   after their last observation, together with their name (claim-sourced
 *   entries are permanent mailboxes and do not lapse);
 * - passive-discovery entries are presence-only (deliverable=false) until
 *   a registration path (MCP/hooks/claim, P2+) marks them deliverable.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  defaultSessionName,
  resolveSessionName,
  slugifySessionName,
} from './naming';
import { probeRepoIdentity } from './repoProbe';
import type {
  DiscoveredSession,
  LocalSessionRecord,
  LocalSessionView,
  LocalSessionsState,
  SessionDeliveryTier,
  SessionRegistrationSource,
  SessionActivityStatus,
} from './types';

/** A session reads as alive while observed within this window. */
export const SESSION_LIVE_WINDOW_MS = 10 * 60_000;
/** A session (and its name) lapses this long after its last observation. */
export const SESSION_LAPSE_TTL_MS = 24 * 60 * 60_000;

const STATE_FILE_MODE = 0o600;

/** Tier a platform can support today (spec's first-wave matrix). */
const DEFAULT_AGENT_TIERS: Record<string, SessionDeliveryTier> = {
  'claude-code': 'push',
  codex: 'push',
};

function defaultTier(agent: string): SessionDeliveryTier {
  return DEFAULT_AGENT_TIERS[agent] ?? 'pull';
}

function emptyState(): LocalSessionsState {
  return { version: 1, updatedAt: new Date(0).toISOString(), sessions: [] };
}

function normalizeRecord(raw: unknown): LocalSessionRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const sessionKey = typeof record.sessionKey === 'string' ? record.sessionKey : '';
  const agent = typeof record.agent === 'string' ? record.agent : '';
  if (!sessionKey || !agent || !sessionKey.startsWith(`${agent}:`)) {
    return null;
  }
  const tier = record.tier === 'push' || record.tier === 'turn' || record.tier === 'pull'
    ? record.tier
    : defaultTier(agent);
  const source: SessionRegistrationSource = record.source === 'mcp'
    || record.source === 'hook'
    || record.source === 'claim'
    || record.source === 'discovery'
    ? record.source
    : 'discovery';
  const status: SessionActivityStatus = record.status === 'busy' || record.status === 'idle'
    ? record.status
    : 'unknown';
  const lastSeenAt = typeof record.lastSeenAt === 'number' && Number.isFinite(record.lastSeenAt)
    ? record.lastSeenAt
    : 0;
  return {
    sessionKey,
    agent,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : '',
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : sessionKey,
    tier,
    source,
    deliverable: record.deliverable === true,
    cwd: typeof record.cwd === 'string' ? record.cwd : '',
    repo: typeof record.repo === 'string' ? record.repo : '',
    branch: typeof record.branch === 'string' ? record.branch : '',
    doing: typeof record.doing === 'string' ? record.doing : '',
    status,
    pid: typeof record.pid === 'number' && Number.isInteger(record.pid) ? record.pid : undefined,
    lastSeenAt,
    startedAt: typeof record.startedAt === 'number' && Number.isFinite(record.startedAt)
      ? record.startedAt
      : 0,
    inboxSocketPath: typeof record.inboxSocketPath === 'string' && record.inboxSocketPath.trim()
      ? record.inboxSocketPath.trim()
      : undefined,
  };
}

function normalizeState(raw: unknown): LocalSessionsState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyState();
  }
  const state = raw as Record<string, unknown>;
  if (state.version !== 1 || !Array.isArray(state.sessions)) {
    return emptyState();
  }
  const sessions = state.sessions
    .map(normalizeRecord)
    .filter((record): record is LocalSessionRecord => record !== null);
  return { version: 1, updatedAt: new Date().toISOString(), sessions };
}

export interface RegisterSessionInput {
  agent: string;
  sessionId?: string;
  pid?: number;
  /** Requested directory name (honored when free; suffixed when taken). */
  name?: string;
  cwd?: string;
  status?: SessionActivityStatus;
  doing?: string;
  startedAt?: number;
  inboxSocketPath?: string;
  source: SessionRegistrationSource;
  deliverable: boolean;
}

export interface LocalSessionRegistryInput {
  /** Absolute path of the registry JSON (resolveMetabotSessionPaths). */
  statePath: string;
  now?: () => number;
  probeRepo?: (cwd: string) => Promise<{ repo: string; branch: string }>;
}

export interface LocalSessionRegistry {
  /**
   * Registry rows. Default: alive sessions only. `all`: every non-lapsed
   * record, offline included. Lapsed records are pruned on read.
   */
  list(options?: { all?: boolean }): Promise<LocalSessionView[]>;
  /** Register or refresh a session (P2+ callers; P1 uses applyDiscovery). */
  registerSession(input: RegisterSessionInput): Promise<LocalSessionRecord>;
  /** Merge a discovery scan's presence into the registry (idempotent). */
  applyDiscovery(entries: DiscoveredSession[]): Promise<void>;
}

export function createLocalSessionRegistry(input: LocalSessionRegistryInput): LocalSessionRegistry {
  const statePath = input.statePath;
  const now = input.now ?? Date.now;
  const probeRepo = input.probeRepo ?? probeRepoIdentity;
  const repoProbeCache = new Map<string, { repo: string; branch: string }>();

  // Single-writer discipline: every read-modify-write runs inside one
  // serialized operation (the daemon is the only writer; the chain guards
  // re-entrant calls within the process).
  let writeChain: Promise<unknown> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = writeChain.then(operation, operation);
    writeChain = run.catch(() => undefined);
    return run;
  }

  async function readState(): Promise<LocalSessionsState> {
    let raw: string;
    try {
      raw = await fs.readFile(statePath, 'utf8');
    } catch {
      return emptyState();
    }
    try {
      return normalizeState(JSON.parse(raw));
    } catch {
      return emptyState();
    }
  }

  async function writeState(state: LocalSessionsState): Promise<void> {
    state.updatedAt = new Date(now()).toISOString();
    const parent = path.dirname(statePath);
    await fs.mkdir(parent, { recursive: true });
    const tmpPath = path.join(parent, `.local-sessions.${process.pid}.tmp`);
    await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { mode: STATE_FILE_MODE });
    await fs.rename(tmpPath, statePath);
  }

  function sessionKeyFor(agent: string, sessionId: string | undefined, pid: number | undefined): string {
    if (sessionId) {
      return `${agent}:${sessionId}`;
    }
    if (pid !== undefined) {
      return `${agent}:pid:${pid}`;
    }
    return `${agent}:unknown`;
  }

  function pruneLapsed(state: LocalSessionsState): boolean {
    const cutoff = now() - SESSION_LAPSE_TTL_MS;
    const kept = state.sessions.filter(
      (record) => record.source === 'claim' || record.lastSeenAt >= cutoff,
    );
    if (kept.length === state.sessions.length) {
      return false;
    }
    state.sessions = kept;
    return true;
  }

  async function repoFor(cwd: string): Promise<{ repo: string; branch: string }> {
    if (!cwd) {
      return { repo: '', branch: '' };
    }
    const cached = repoProbeCache.get(cwd);
    if (cached) {
      return cached;
    }
    const probed = await probeRepo(cwd).catch(() => ({ repo: path.basename(cwd), branch: '' }));
    repoProbeCache.set(cwd, probed);
    return probed;
  }

  /** Name for a (new) record: requested when free, else default, else `-2`/`-3`. */
  function nameFor(
    state: LocalSessionsState,
    key: string,
    requested: string | undefined,
    cwd: string | undefined,
    agent: string,
  ): string {
    const takenNames = state.sessions
      .filter((record) => record.sessionKey !== key)
      .map((record) => record.name);
    const requestedSlug = slugifySessionName(requested ?? '');
    return resolveSessionName({
      requested: requestedSlug || undefined,
      defaultName: defaultSessionName({ cwd, agent }),
      takenNames,
    });
  }

  const registry: LocalSessionRegistry = {
    async list(options) {
      return serialized(async () => {
        const state = await readState();
        if (pruneLapsed(state)) {
          await writeState(state);
        }
        const timestamp = now();
        const views: LocalSessionView[] = state.sessions.map((record) => ({
          ...record,
          alive: timestamp - record.lastSeenAt <= SESSION_LIVE_WINDOW_MS,
        }));
        views.sort((a, b) => {
          if (a.alive !== b.alive) {
            return a.alive ? -1 : 1;
          }
          return b.lastSeenAt - a.lastSeenAt;
        });
        return options?.all ? views : views.filter((view) => view.alive);
      });
    },

    async registerSession(sessionInput) {
      const agent = sessionInput.agent.trim();
      if (!agent) {
        throw new Error('agent is required');
      }
      const key = sessionKeyFor(agent, sessionInput.sessionId?.trim() || undefined, sessionInput.pid);
      const cwd = sessionInput.cwd?.trim() || '';
      return serialized(async () => {
        const state = await readState();
        const existing = state.sessions.find((record) => record.sessionKey === key);
        const record: LocalSessionRecord = {
          sessionKey: key,
          agent,
          sessionId: sessionInput.sessionId?.trim() || existing?.sessionId || '',
          // Name keeping: an existing record keeps its name across resume.
          name: existing?.name ?? nameFor(state, key, sessionInput.name, cwd, agent),
          tier: existing?.tier ?? defaultTier(agent),
          source: sessionInput.source,
          deliverable: sessionInput.deliverable || existing?.deliverable === true,
          cwd: cwd || existing?.cwd || '',
          repo: existing?.repo ?? '',
          branch: existing?.branch ?? '',
          doing: sessionInput.doing?.trim() || existing?.doing || '',
          status: sessionInput.status ?? existing?.status ?? 'unknown',
          pid: sessionInput.pid ?? existing?.pid,
          lastSeenAt: now(),
          startedAt: sessionInput.startedAt ?? existing?.startedAt ?? 0,
          inboxSocketPath: sessionInput.inboxSocketPath?.trim() || existing?.inboxSocketPath,
        };
        if (record.cwd && (!existing || existing.cwd !== record.cwd || !record.repo)) {
          const identity = await repoFor(record.cwd);
          record.repo = identity.repo;
          record.branch = identity.branch;
        }
        if (existing) {
          state.sessions[state.sessions.indexOf(existing)] = record;
        } else {
          state.sessions.push(record);
        }
        pruneLapsed(state);
        await writeState(state);
        return record;
      });
    },

    async applyDiscovery(entries) {
      if (!entries.length) {
        return;
      }
      await serialized(async () => {
        const state = await readState();
        const timestamp = now();
        for (const entry of entries) {
          const key = sessionKeyFor(entry.agent, entry.sessionId, entry.pid);
          const existing = state.sessions.find((record) => record.sessionKey === key);
          const observedAt = entry.observedAt && entry.observedAt > 0 ? entry.observedAt : timestamp;
          if (existing) {
            existing.lastSeenAt = Math.max(existing.lastSeenAt, observedAt);
            existing.status = entry.status ?? existing.status;
            existing.doing = entry.doing?.trim() || existing.doing;
            existing.pid = entry.pid ?? existing.pid;
            if (entry.cwd && !existing.cwd) {
              existing.cwd = entry.cwd;
              existing.repo = '';
              existing.branch = '';
            }
            existing.inboxSocketPath = entry.inboxSocketPath || existing.inboxSocketPath;
            continue;
          }
          const identity = entry.cwd ? await repoFor(entry.cwd) : { repo: '', branch: '' };
          state.sessions.push({
            sessionKey: key,
            agent: entry.agent,
            sessionId: entry.sessionId ?? '',
            name: nameFor(state, key, entry.name, entry.cwd, entry.agent),
            tier: defaultTier(entry.agent),
            source: 'discovery',
            deliverable: false,
            cwd: entry.cwd ?? '',
            repo: identity.repo,
            branch: identity.branch,
            doing: entry.doing?.trim() ?? '',
            status: entry.status ?? 'unknown',
            pid: entry.pid,
            lastSeenAt: observedAt,
            startedAt: entry.startedAt ?? 0,
            inboxSocketPath: entry.inboxSocketPath,
          });
        }
        pruneLapsed(state);
        await writeState(state);
      });
    },
  };

  return registry;
}
