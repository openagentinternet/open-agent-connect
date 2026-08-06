/**
 * Resident App/Game Runtime (docs/06, docs/09). The daemon owns session
 * state, task-level grants, leases/fencing, message catch-up, the adapter
 * action loop, LLM calls and chain writes. MetaApps only control sessions via
 * `browser.app.session.*`; closing the page does not stop the runtime.
 */

import { randomUUID } from 'node:crypto';
import {
  AGENT_GAME_PROTOCOL,
  APP_SESSION_TYPE,
  createAppSessionError,
  DEFAULT_AGENT_GAME_PROTOCOL_PATHS,
  type AgentGameEnvelope,
  type AppSessionBudget,
  type AppSessionError,
  type AppSessionErrorCode,
  type AppSessionGrant,
  type AppSessionLease,
  type AppSessionPersistedState,
  type AppSessionPublic,
  type AppSessionRecord,
  type AppSessionRuntimeStartReport,
  type AppSessionStartParams,
  type AppSessionStatus,
  type GroupChatMessage,
  type LoadedGamePackage,
} from './types';
import { buildGroupChatWritePayload, decryptGroupContent, parseAgentGameEnvelope } from './groupChat';
import { sha256Hex } from './gamePackage';

export interface SandboxedAdapterHandle {
  call<T = unknown>(method: string, args?: unknown[]): Promise<T>;
  hasExport(name: string): Promise<boolean>;
  dispose(): void;
}

export type AdapterSandboxFactory = (input: {
  adapterCode: string;
  adapterHash: string;
}) => SandboxedAdapterHandle;

export interface AgentGameRuntimeInput {
  store: {
    load(): Promise<AppSessionPersistedState | null>;
    save(state: AppSessionPersistedState): Promise<void>;
  };
  fetchGroupMessages(input: {
    groupId: string;
    startIndex: number;
    size?: number;
  }): Promise<GroupChatMessage[]>;
  loadGamePackage(input: { manifestUri: string }): Promise<LoadedGamePackage>;
  createAdapterSandbox?: AdapterSandboxFactory;
  llmComplete(input: {
    actorId: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  }): Promise<{ text: string; model?: string }>;
  writeGroupChat(input: {
    actorId: string;
    groupId: string;
    payload: Record<string, unknown>;
  }): Promise<{ ok: true; pinId?: string } | { ok: false; code?: string; message?: string }>;
  audit?(event: Record<string, unknown>): Promise<void> | void;
  now?(): number;
  logger?(...args: unknown[]): void;
  leaseTtlMs?: number;
  heartbeatIntervalMs?: number;
  llmRetryBaseMs?: number;
  llmRetryMaxMs?: number;
  maxLlmAttempts?: number;
  writeRetryBaseMs?: number;
  writeRetryMaxMs?: number;
  maxWriteAttempts?: number;
}

export interface AppSessionActorBinding {
  actorId: string;
  actorGlobalMetaId: string;
  resourceUri: string;
}

export interface AppSessionListFilter {
  appId?: string;
  status?: AppSessionStatus;
  groupId?: string;
}

const DEFAULT_LEASE_TTL_MS = 3_600_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_LLM_RETRY_BASE_MS = 2_000;
const DEFAULT_LLM_RETRY_MAX_MS = 60_000;
const DEFAULT_MAX_LLM_ATTEMPTS = 3;
const DEFAULT_WRITE_RETRY_BASE_MS = 5_000;
const DEFAULT_WRITE_RETRY_MAX_MS = 120_000;
const DEFAULT_MAX_WRITE_ATTEMPTS = 12;
const DEFAULT_PAGE_SIZE = 50;

const REQUIRED_ADAPTER_EXPORTS = [
  'createMatch',
  'initialState',
  'reduce',
  'getTurn',
  'getObservation',
  'getActionSchema',
  'parseAction',
  'validateAction',
  'serializeState',
  'getResult',
] as const;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asAppSessionError(error: unknown, fallback: AppSessionErrorCode): AppSessionError {
  if (isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string') {
    return error as unknown as AppSessionError;
  }
  return createAppSessionError(
    fallback,
    error instanceof Error ? error.message : String(error),
  );
}

function throwAppSessionError(error: unknown, fallback: AppSessionErrorCode): never {
  throw asAppSessionError(error, fallback);
}

function emptyBudget(): AppSessionBudget {
  return { llmCalls: 0, llmCallsUsed: 0, writes: 0, writesUsed: 0 };
}

function leaseKey(groupId: string, seat: string): string {
  return `${groupId}|${seat}`;
}

function normalizeHash(value: unknown): string {
  const text = normalizeText(value).toLowerCase();
  return text.startsWith('sha256:') ? text.slice('sha256:'.length) : text;
}

function protocolHash(hex: string): string {
  return `sha256:${hex}`;
}

function backoffMs(baseMs: number, maxMs: number, attempt: number, factor = 2): number {
  const exponent = Math.min(attempt, 10);
  const raw = baseMs * Math.pow(factor, exponent);
  const capped = Math.min(raw, maxMs);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.trunc(capped * jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeStartParams(params: AppSessionStartParams): AppSessionStartParams {
  const budget = params.budget ?? {};
  const ttlMs = Number.isInteger(params.ttlMs) && Number(params.ttlMs) > 0
    ? Math.trunc(Number(params.ttlMs))
    : 86_400_000;
  const llmCalls = Number.isInteger(budget.llmCalls) && Number(budget.llmCalls) > 0
    ? Math.trunc(Number(budget.llmCalls))
    : 500;
  const writes = Number.isInteger(budget.writes) && Number(budget.writes) > 0
    ? Math.trunc(Number(budget.writes))
    : 500;
  return {
    appId: normalizeText(params.appId),
    sessionType: normalizeText(params.sessionType),
    groupId: normalizeText(params.groupId),
    gameId: normalizeText(params.gameId),
    manifestUri: normalizeText(params.manifestUri),
    rulesHash: normalizeText(params.rulesHash),
    seat: normalizeText(params.seat),
    agentId: normalizeText(params.agentId),
    ttlMs,
    budget: { llmCalls, writes },
  };
}

export interface AgentGameRuntime {
  validateStart(input: AppSessionStartParams & AppSessionActorBinding): Promise<
    { ok: true; adapterHash: string }
    | { ok: false; error: AppSessionError }
  >;
  start(input: AppSessionStartParams & AppSessionActorBinding): Promise<AppSessionPublic>;
  list(input: AppSessionActorBinding & AppSessionListFilter): Promise<AppSessionPublic[]>;
  status(sessionId: string, actor: AppSessionActorBinding): Promise<AppSessionPublic>;
  pause(sessionId: string, actor: AppSessionActorBinding): Promise<AppSessionPublic>;
  resume(sessionId: string, actor: AppSessionActorBinding): Promise<AppSessionPublic>;
  stop(sessionId: string, actor: AppSessionActorBinding, options?: { releaseSeat?: boolean }): Promise<AppSessionPublic>;
  notifyGroupActivity(groupId: string): void;
  startRuntime(): Promise<AppSessionRuntimeStartReport>;
  dispose(): Promise<void>;
}

export function createAgentGameRuntime(input: AgentGameRuntimeInput): AgentGameRuntime {
  const nowMs = input.now ?? (() => Date.now());
  const log = input.logger ?? (() => undefined);
  const leaseTtlMs = Number.isFinite(input.leaseTtlMs) && Number(input.leaseTtlMs) > 0
    ? Math.trunc(Number(input.leaseTtlMs))
    : DEFAULT_LEASE_TTL_MS;
  const heartbeatIntervalMs = Number.isFinite(input.heartbeatIntervalMs) && Number(input.heartbeatIntervalMs) > 0
    ? Math.trunc(Number(input.heartbeatIntervalMs))
    : DEFAULT_HEARTBEAT_INTERVAL_MS;
  const llmRetryBaseMs = Number.isFinite(input.llmRetryBaseMs) && Number(input.llmRetryBaseMs) > 0
    ? Math.trunc(Number(input.llmRetryBaseMs))
    : DEFAULT_LLM_RETRY_BASE_MS;
  const llmRetryMaxMs = Number.isFinite(input.llmRetryMaxMs) && Number(input.llmRetryMaxMs) > 0
    ? Math.trunc(Number(input.llmRetryMaxMs))
    : DEFAULT_LLM_RETRY_MAX_MS;
  const maxLlmAttempts = Number.isInteger(input.maxLlmAttempts) && Number(input.maxLlmAttempts) > 0
    ? Math.trunc(Number(input.maxLlmAttempts))
    : DEFAULT_MAX_LLM_ATTEMPTS;
  const writeRetryBaseMs = Number.isFinite(input.writeRetryBaseMs) && Number(input.writeRetryBaseMs) > 0
    ? Math.trunc(Number(input.writeRetryBaseMs))
    : DEFAULT_WRITE_RETRY_BASE_MS;
  const writeRetryMaxMs = Number.isFinite(input.writeRetryMaxMs) && Number(input.writeRetryMaxMs) > 0
    ? Math.trunc(Number(input.writeRetryMaxMs))
    : DEFAULT_WRITE_RETRY_MAX_MS;
  const maxWriteAttempts = Number.isInteger(input.maxWriteAttempts) && Number(input.maxWriteAttempts) > 0
    ? Math.trunc(Number(input.maxWriteAttempts))
    : DEFAULT_MAX_WRITE_ATTEMPTS;
  const adapterSandboxFactory = input.createAdapterSandbox ?? ((sandboxInput) => {
    // Lazy require keeps the sandbox module out of the import graph when the
    // runtime is tested with an injected factory.
    const { createAdapterSandbox } = require('./adapterSandbox') as typeof import('./adapterSandbox');
    return createAdapterSandbox(sandboxInput);
  });

  let state: AppSessionPersistedState = { version: 1, sessions: [], grants: [], leases: [] };
  const adapters = new Map<string, SandboxedAdapterHandle>();
  const busy = new Set<string>();
  const dirty = new Set<string>();
  const ownerId = `oac-daemon-${process.pid}-${randomUUID()}`;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let restored = false;
  let disposed = false;

  function persist(): Promise<void> {
    return input.store.save(state);
  }

  function sessionById(sessionId: string): AppSessionRecord | null {
    return state.sessions.find((session) => session.sessionId === sessionId) ?? null;
  }

  function grantById(grantId: string): AppSessionGrant | null {
    return state.grants.find((grant) => grant.grantId === grantId) ?? null;
  }

  function adapterFor(session: AppSessionRecord): SandboxedAdapterHandle | null {
    return adapters.get(session.sessionId) ?? null;
  }

  function leaseFor(key: string): AppSessionLease | null {
    return state.leases.find((lease) => lease.key === key) ?? null;
  }

  function publicSession(session: AppSessionRecord): AppSessionPublic {
    return {
      sessionId: session.sessionId,
      appId: session.appId,
      sessionType: session.sessionType,
      groupId: session.groupId,
      gameId: session.gameId,
      manifestUri: session.manifestUri,
      adapterHash: session.adapterHash,
      rulesHash: session.rulesHash,
      seat: session.seat,
      agentId: session.agentId,
      status: session.status,
      lastIndex: Math.max(0, session.cursor - 1),
      lastActionSeq: session.lastActionSeq,
      lastError: session.lastError,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      budget: {
        llmCalls: session.budget.llmCalls,
        llmCallsUsed: session.budget.llmCallsUsed,
        writes: session.budget.writes,
        writesUsed: session.budget.writesUsed,
      },
    };
  }

  function actorMayAccess(session: AppSessionRecord, actor: AppSessionActorBinding): boolean {
    return session.agentId === actor.actorGlobalMetaId || session.actorId === actor.actorId;
  }

  function requireAccess(session: AppSessionRecord, actor: AppSessionActorBinding): void {
    if (!actorMayAccess(session, actor)) {
      throwAppSessionError(
        createAppSessionError('session_not_found', `session ${session.sessionId} not found`),
        'session_not_found',
      );
    }
  }

  function acquireLease(key: string, sessionId: string): boolean {
    const now = nowMs();
    const existing = leaseFor(key);
    if (existing && existing.sessionId !== sessionId && existing.expiresAt > now) {
      return false;
    }
    if (existing && existing.sessionId === sessionId) {
      existing.expiresAt = now + leaseTtlMs;
      existing.updatedAt = now;
      return true;
    }
    state.leases.push({
      key,
      sessionId,
      leaseId: `lease-${randomUUID()}`,
      ownerId,
      expiresAt: now + leaseTtlMs,
      updatedAt: now,
    });
    return true;
  }

  function releaseLease(session: AppSessionRecord): void {
    const key = leaseKey(session.groupId, session.seat);
    state.leases = state.leases.filter((lease) => !(lease.key === key && lease.sessionId === session.sessionId));
  }

  async function ensureLoaded(): Promise<void> {
    if (restored) {
      return;
    }
    restored = true;
    state = (await input.store.load()) ?? { version: 1, sessions: [], grants: [], leases: [] };
  }

  function markDirty(session: AppSessionRecord): void {
    session.updatedAt = nowMs();
    dirty.add(session.sessionId);
  }

  // ---- Adapter helpers ----

  async function loadSessionAdapter(session: AppSessionRecord): Promise<SandboxedAdapterHandle> {
    const existing = adapters.get(session.sessionId);
    if (existing) {
      return existing;
    }
    const pkg = await input.loadGamePackage({ manifestUri: session.manifestUri });
    if (pkg.adapterHash !== session.adapterHash) {
      throwAppSessionError(
        createAppSessionError('adapter_invalid', 'adapterHash changed after session start; package is frozen.'),
        'adapter_invalid',
      );
    }
    const adapter = adapterSandboxFactory({
      adapterCode: pkg.adapterCode,
      adapterHash: pkg.adapterHash,
    });
    await smokeLoadAdapter(adapter, session.gameId);
    adapters.set(session.sessionId, adapter);
    return adapter;
  }

  async function smokeLoadAdapter(adapter: SandboxedAdapterHandle, gameId: string): Promise<void> {
    try {
      const missing: string[] = [];
      for (const exportName of REQUIRED_ADAPTER_EXPORTS) {
        const hasExport = await adapter.hasExport(exportName);
        if (!hasExport) {
          missing.push(exportName);
        }
      }
      if (missing.length) {
        throwAppSessionError(
          createAppSessionError('adapter_invalid', `Adapter is missing required ABI exports: ${missing.join(', ')}`),
          'adapter_invalid',
        );
      }
      await adapter.call('initialState', [{ gameId, rulesHash: '' }]);
    } catch (error) {
      throwAppSessionError(error, 'adapter_invalid');
    }
  }

  async function adapterCall<T>(adapter: SandboxedAdapterHandle | null, method: string, args: unknown[]): Promise<T> {
    if (!adapter) {
      throwAppSessionError(
        createAppSessionError('adapter_error', 'Adapter is not loaded for this session.'),
        'adapter_error',
      );
    }
    try {
      return await adapter.call<T>(method, args);
    } catch (error) {
      throwAppSessionError(error, 'adapter_error');
    }
  }

  // ---- Grant / budget ----

  function assertGrantActive(session: AppSessionRecord): AppSessionGrant {
    const grant = grantById(session.grantId);
    if (!grant || grant.revoked) {
      throwAppSessionError(
        createAppSessionError('consent_denied', 'The task authorization was revoked or no longer exists.'),
        'consent_denied',
      );
    }
    if (nowMs() >= grant.expiresAt) {
      throwAppSessionError(
        createAppSessionError('authorization_expired', 'The task authorization expired.'),
        'authorization_expired',
      );
    }
    return grant;
  }

  function assertGrantBinding(session: AppSessionRecord, grant: AppSessionGrant): void {
    const bound = grant.resourceUri === session.resourceUri
      && grant.actorId === session.actorId
      && grant.actorGlobalMetaId === session.agentId
      && grant.appId === session.appId
      && grant.groupId === session.groupId
      && grant.gameId === session.gameId
      && grant.rulesHash === session.rulesHash
      && grant.adapterHash === session.adapterHash
      && grant.seat === session.seat;
    if (!bound) {
      throwAppSessionError(
        createAppSessionError('consent_denied', 'The task authorization does not match this session.'),
        'consent_denied',
      );
    }
  }

  async function autoPauseIfNeeded(session: AppSessionRecord): Promise<boolean> {
    const grant = grantById(session.grantId);
    if (!grant || grant.revoked) {
      session.status = 'stopped';
      session.lastError = createAppSessionError('consent_denied', 'The task authorization was revoked.');
      session.pending = null;
      releaseLease(session);
      markDirty(session);
      await persist();
      return true;
    }
    if (nowMs() >= grant.expiresAt) {
      session.status = 'paused';
      session.lastError = createAppSessionError('authorization_expired', 'The task authorization expired; the session is paused.');
      markDirty(session);
      await persist();
      return true;
    }
    if (session.budget.llmCallsUsed >= session.budget.llmCalls
      || session.budget.writesUsed >= session.budget.writes) {
      session.status = 'paused';
      session.lastError = createAppSessionError('budget_exhausted', 'The session budget is exhausted; the session is paused.');
      markDirty(session);
      await persist();
      return true;
    }
    return false;
  }

  // ---- Message intake ----

  async function catchUp(session: AppSessionRecord): Promise<boolean> {
    let startIndex = session.cursor;
    let processed = false;
    for (;;) {
      let batch: GroupChatMessage[];
      try {
        batch = await input.fetchGroupMessages({
          groupId: session.groupId,
          startIndex,
          size: DEFAULT_PAGE_SIZE,
        });
      } catch (error) {
        const status = (error as { status?: unknown }).status;
        if (status === 404 || status === 403) {
          throwAppSessionError(
            createAppSessionError('group_not_found', `Group is not accessible: ${session.groupId}`),
            'group_not_found',
          );
        }
        throw error;
      }
      if (!batch.length) {
        break;
      }
      const adapter = adapterFor(session);
      for (const message of batch) {
        if (message.index < session.cursor) {
          continue; // dedupe by index
        }
        const plaintext = message.encryption === 'aes'
          ? decryptGroupContent(message.content, session.groupId)
          : message.content;
        const envelope = parseAgentGameEnvelope(plaintext);
        if (!envelope || envelope.gameId !== session.gameId || envelope.rulesHash !== session.rulesHash) {
          session.cursor = message.index + 1;
          continue; // non-game or foreign-game traffic: advance, ignore
        }
        if (envelope.type === 'action' && envelope.prevStateHash) {
          const currentHash = await adapterCall<unknown>(
            adapter,
            'serializeState',
            [session.state],
          ).then((serialized) => sha256Hex(JSON.stringify(serialized)));
          if (normalizeHash(envelope.prevStateHash) !== normalizeHash(currentHash)) {
            log(`[app-session] ${session.sessionId} skip action seq=${envelope.actionSeq} (prevStateHash mismatch: expected ${envelope.prevStateHash}, current ${currentHash})`);
            session.cursor = message.index + 1;
            continue;
          }
        }
        if (session.pending
          && envelope.eventId
          && envelope.eventId === session.pending.eventId
          && envelope.actionSeq === session.pending.actionSeq) {
          session.pending = null; // our own write landed
        } else if (session.pending
          && envelope.type === 'action'
          && envelope.actionSeq === session.pending.actionSeq
          && envelope.eventId !== session.pending.eventId) {
          log(`[app-session] ${session.sessionId} foreign action seq=${envelope.actionSeq} superseded pending write`);
          session.pending = null;
        }
        session.state = await adapterCall(adapter, 'reduce', [session.state, {
          ...envelope,
          meta: {
            index: message.index,
            senderMetaId: message.senderMetaId,
            timestamp: message.timestamp,
          },
        }]);
        session.cursor = message.index + 1;
        if (envelope.type === 'action' && Number.isInteger(envelope.actionSeq)) {
          session.lastActionSeq = Math.max(session.lastActionSeq, Number(envelope.actionSeq));
        }
        processed = true;
      }
      if (batch.length < DEFAULT_PAGE_SIZE) {
        break;
      }
      startIndex = batch[batch.length - 1].index + 1;
    }
    if (processed) {
      markDirty(session);
      await persist();
    }
    return processed;
  }

  // ---- Envelope + write ----

  function envelopeFor(session: AppSessionRecord, type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}): AgentGameEnvelope {
    return {
      protocol: AGENT_GAME_PROTOCOL,
      gameId: session.gameId,
      matchId: session.groupId,
      rulesHash: session.rulesHash,
      type,
      payload,
      ...extra,
    };
  }

  async function writeEvent(session: AppSessionRecord, event: AgentGameEnvelope): Promise<boolean> {
    const grant = assertGrantActive(session);
    assertGrantBinding(session, grant);
    const path = '/protocols/simplegroupchat';
    if (!grant.protocolPaths.includes(path)) {
      throwAppSessionError(
        createAppSessionError('consent_denied', `Protocol path is not covered by the task authorization: ${path}`),
        'consent_denied',
      );
    }
    if (session.budget.writesUsed >= session.budget.writes) {
      throwAppSessionError(
        createAppSessionError('rate_limited', 'The session write budget is exhausted.'),
        'rate_limited',
      );
    }
    const payload = buildGroupChatWritePayload({
      groupId: session.groupId,
      plaintext: JSON.stringify(event),
      nickName: session.agentId,
      now: nowMs(),
    });
    const result = await input.writeGroupChat({
      actorId: session.actorId,
      groupId: session.groupId,
      payload,
    });
    if (!result.ok) {
      const code = result.code === 'rate_limited' ? 'rate_limited' : 'write_failed';
      throwAppSessionError(
        createAppSessionError(code, result.message || 'Group chat write failed.'),
        code,
      );
    }
    session.budget.writesUsed += 1;
    markDirty(session);
    await persist();
    void Promise.resolve(input.audit?.({
      type: 'app_session_write',
      sessionId: session.sessionId,
      actorId: session.actorId,
      groupId: session.groupId,
      gameId: session.gameId,
      actionSeq: Number.isInteger(event.actionSeq) ? event.actionSeq : null,
      eventId: event.eventId ?? null,
      path,
      pinId: result.pinId ?? null,
    })).catch(() => undefined);
    return true;
  }

  // ---- Action loop ----

  async function callLlmWithRetry(
    session: AppSessionRecord,
    observation: unknown,
    schema: unknown,
    context: Record<string, unknown>,
    feedback: { error?: string; previous?: string } | null,
  ): Promise<string> {
    if (session.budget.llmCallsUsed >= session.budget.llmCalls) {
      throwAppSessionError(
        createAppSessionError('rate_limited', 'The session LLM budget is exhausted.'),
        'rate_limited',
      );
    }
    const messages = [
      {
        role: 'system' as const,
        content: 'You are the move generator for an agent-game session. '
          + 'The game rules are enforced deterministically by the host adapter; you only propose a candidate action. '
          + 'Reply with exactly one action matching the action schema, with no explanation.',
      },
      {
        role: 'user' as const,
        content: JSON.stringify({
          observation,
          schema,
          context,
          ...(feedback ? { feedback } : {}),
        }),
      },
    ];
    let lastError: AppSessionError | null = null;
    for (let attempt = 1; attempt <= maxLlmAttempts; attempt += 1) {
      session.budget.llmCallsUsed += 1;
      markDirty(session);
      await persist();
      try {
        const result = await input.llmComplete({
          actorId: session.actorId,
          messages,
        });
        const text = normalizeText(result.text);
        if (!text) {
          throw Object.assign(new Error('LLM returned an empty reply.'), { code: 'llm_unavailable' });
        }
        return text;
      } catch (error) {
        const code = isRecord(error) && typeof error.code === 'string'
          ? String(error.code)
          : 'llm_unavailable';
        lastError = createAppSessionError(
          code === 'llm_timeout' ? 'llm_timeout' : 'llm_unavailable',
          error instanceof Error ? error.message : String(error),
        );
        log(`[app-session] ${session.sessionId} LLM attempt ${attempt}/${maxLlmAttempts} failed: ${lastError.message}`);
        if (attempt < maxLlmAttempts) {
          const delay = code === 'rate_limited'
            ? Math.max(llmRetryBaseMs * 4, backoffMs(llmRetryBaseMs, llmRetryMaxMs, attempt))
            : backoffMs(llmRetryBaseMs, llmRetryMaxMs, attempt);
          await sleep(delay);
        }
      }
    }
    session.status = 'paused';
    session.lastError = lastError ?? createAppSessionError('llm_unavailable', 'LLM is unavailable.');
    markDirty(session);
    await persist();
    throw lastError ?? createAppSessionError('llm_unavailable', 'LLM is unavailable.');
  }

  async function retryPending(session: AppSessionRecord): Promise<void> {
    if (!session.pending) {
      return;
    }
    await catchUp(session);
    if (!session.pending) {
      return; // the pending write landed while catching up
    }
    if (session.pending.nextRetryAt > nowMs()) {
      return;
    }
    if (session.lastActionSeq >= session.pending.actionSeq) {
      session.pending = null;
      markDirty(session);
      await persist();
      return;
    }
    if (session.pending.writeCount >= maxWriteAttempts) {
      session.status = 'paused';
      session.lastError = createAppSessionError('write_failed', 'The action could not be written after repeated retries.');
      markDirty(session);
      await persist();
      return;
    }
    session.pending.writeCount += 1;
    try {
      await writeEvent(session, session.pending.event);
      session.pending.sentAt = nowMs();
      session.pending.nextRetryAt = 0;
      markDirty(session);
      await persist();
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string'
        ? String(error.code)
        : 'write_failed';
      session.pending.nextRetryAt = nowMs() + backoffMs(writeRetryBaseMs, writeRetryMaxMs, session.pending.writeCount);
      markDirty(session);
      await persist();
      if (code === 'authorization_expired' || code === 'consent_denied' || code === 'rate_limited') {
        await autoPauseIfNeeded(session);
      } else {
        log(`[app-session] ${session.sessionId} write retry ${session.pending.writeCount}/${maxWriteAttempts} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async function processTurn(session: AppSessionRecord): Promise<void> {
    if (busy.has(session.sessionId) || session.status !== 'running' || disposed) {
      return;
    }
    busy.add(session.sessionId);
    try {
      await catchUp(session); // socket is only a notification; history is truth
      await retryPending(session);
      if (session.status !== 'running') {
        return;
      }
      if (await autoPauseIfNeeded(session)) {
        return;
      }
      const adapter = adapterFor(session);
      const turn = await adapterCall<{ phase?: string; seat?: unknown; actionSeq?: unknown }>(
        adapter,
        'getTurn',
        [session.state],
      );
      if (!turn || turn.phase === 'finished') {
        await finishSession(session);
        return;
      }
      if (turn.phase !== 'playing' || normalizeText(turn.seat) !== session.seat) {
        return; // not this seat's turn
      }
      if (session.pending) {
        return; // a write is still in flight
      }
      if (session.budget.llmCallsUsed >= session.budget.llmCalls
        || session.budget.writesUsed >= session.budget.writes) {
        await autoPauseIfNeeded(session);
        return;
      }

      const observation = await adapterCall(adapter, 'getObservation', [session.state, session.seat]);
      const schema = await adapterCall(adapter, 'getActionSchema', [session.state, session.seat]);
      const context = {
        seat: session.seat,
        groupId: session.groupId,
        gameId: session.gameId,
      };

      let action: unknown;
      let text = await callLlmWithRetry(session, observation, schema, context, null);
      if (session.status !== 'running') {
        return;
      }
      let parsed: { action?: unknown; error?: string } | null = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        parsed = await adapterCall<{ action?: unknown; error?: string } | null>(
          adapter,
          'parseAction',
          [text, { schema, observation }],
        );
        if (parsed && !parsed.error && parsed.action !== undefined) {
          action = parsed.action;
          break;
        }
        if (attempt === 3) {
          session.status = 'error';
          session.lastError = createAppSessionError(
            'adapter_error',
            parsed?.error || 'Adapter could not parse the LLM action after retries.',
          );
          markDirty(session);
          await persist();
          return;
        }
        text = await callLlmWithRetry(session, observation, schema, context, {
          error: parsed?.error || 'unparseable action',
          previous: text,
        });
        if (session.status !== 'running') {
          return;
        }
      }

      const validated = await adapterCall<{
        ok?: boolean;
        code?: string;
        message?: string;
        normalizedAction?: unknown;
      }>(adapter, 'validateAction', [session.state, action, { schema, observation }]);
      if (!validated || validated.ok !== true) {
        session.status = 'error';
        session.lastError = createAppSessionError(
          validated?.code && validated.code !== 'adapter_error' ? validated.code as AppSessionErrorCode : 'adapter_error',
          validated?.message || 'Adapter rejected the proposed action.',
        );
        markDirty(session);
        await persist();
        return;
      }

      const actionSeq = Number(turn.actionSeq);
      if (!Number.isInteger(actionSeq) || actionSeq <= 0) {
        session.status = 'error';
        session.lastError = createAppSessionError('adapter_error', 'Adapter getTurn returned an invalid actionSeq.');
        markDirty(session);
        await persist();
        return;
      }
      const prevStateHash = await adapterCall<unknown>(adapter, 'serializeState', [session.state])
        .then((serialized) => sha256Hex(JSON.stringify(serialized)));
      let draft = structuredClone(session.state);
      const actionPayload = isRecord(validated.normalizedAction)
        ? validated.normalizedAction
        : isRecord(action)
          ? action
          : {};
      const draftEvent = envelopeFor(session, 'action', actionPayload, {
        actionSeq,
        prevStateHash: protocolHash(prevStateHash),
        stateHash: '',
        eventId: `draft:${randomUUID()}`,
      });
      draft = await adapterCall(adapter, 'reduce', [draft, {
        ...draftEvent,
        meta: {
          index: Number.MAX_SAFE_INTEGER,
          senderMetaId: session.agentId,
          timestamp: nowMs(),
        },
      }]);
      const stateHash = await adapterCall<unknown>(adapter, 'serializeState', [draft])
        .then((serialized) => sha256Hex(JSON.stringify(serialized)));
      const event = envelopeFor(session, 'action', actionPayload, {
        actionSeq,
        prevStateHash: protocolHash(prevStateHash),
        stateHash: protocolHash(stateHash),
        eventId: `${session.agentId}:${randomUUID()}`,
      });
      session.pending = {
        event,
        actionSeq,
        eventId: String(event.eventId),
        sentAt: nowMs(),
        writeCount: 0,
        nextRetryAt: 0,
      };
      markDirty(session);
      await persist(); // record (groupId, actionSeq, eventId) before the write
      try {
        await writeEvent(session, event);
        session.pending.sentAt = nowMs();
        markDirty(session);
        await persist();
        await catchUp(session); // apply our own event and clear pending
      } catch (error) {
        log(`[app-session] ${session.sessionId} action write failed (will retry): ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      const mapped = asAppSessionError(error, 'internal_error');
      log(`[app-session] ${session.sessionId} turn error: ${mapped.message}`);
      session.lastError = mapped;
      markDirty(session);
      await persist();
    } finally {
      busy.delete(session.sessionId);
      if (!disposed && session.status === 'running' && dirty.has(session.sessionId)) {
        dirty.delete(session.sessionId);
        queueMicrotask(() => {
          void processTurn(session).catch((error) => {
            log(`[app-session] ${session.sessionId} follow-up turn error: ${error instanceof Error ? error.message : String(error)}`);
          });
        });
      }
    }
  }

  async function finishSession(session: AppSessionRecord): Promise<void> {
    if (session.status === 'finished') {
      return;
    }
    session.status = 'finished';
    session.pending = null;
    releaseLease(session);
    markDirty(session);
    await persist();
    void Promise.resolve(input.audit?.({
      type: 'app_session_finished',
      sessionId: session.sessionId,
      actorId: session.actorId,
      groupId: session.groupId,
      gameId: session.gameId,
    })).catch(() => undefined);
  }

  function scheduleProcess(session: AppSessionRecord): void {
    if (disposed || session.status !== 'running') {
      return;
    }
    queueMicrotask(() => {
      void processTurn(session).catch((error) => {
        log(`[app-session] ${session.sessionId} scheduled turn error: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }

  // ---- Session control ----

  async function validateStart(startInput: AppSessionStartParams & AppSessionActorBinding): Promise<
    { ok: true; adapterHash: string }
    | { ok: false; error: AppSessionError }
  > {
    try {
      const pkg = await validateStartOrThrow(startInput);
      return { ok: true, adapterHash: pkg.adapterHash };
    } catch (error) {
      return { ok: false, error: asAppSessionError(error, 'internal_error') };
    }
  }

  async function validateStartOrThrow(startInput: AppSessionStartParams & AppSessionActorBinding): Promise<LoadedGamePackage> {
    await ensureLoaded();
    const params = sanitizeStartParams(startInput);
    if (!params.appId || !params.groupId || !params.gameId || !params.manifestUri
      || !params.rulesHash || !params.seat || !params.agentId) {
      throwAppSessionError(
        createAppSessionError('invalid_params', 'appId, sessionType, groupId, gameId, manifestUri, rulesHash, seat and agentId are required.'),
        'invalid_params',
      );
    }
    if (params.sessionType !== APP_SESSION_TYPE) {
      throwAppSessionError(
        createAppSessionError('invalid_params', `sessionType must be "${APP_SESSION_TYPE}".`),
        'invalid_params',
      );
    }
    if (params.agentId !== startInput.actorGlobalMetaId) {
      throwAppSessionError(
        createAppSessionError('invalid_params', 'agentId must match the current actor globalMetaId.'),
        'invalid_params',
      );
    }
    const pkg = await input.loadGamePackage({ manifestUri: params.manifestUri });
    if (pkg.manifest.gameId !== params.gameId) {
      throwAppSessionError(
        createAppSessionError('adapter_invalid', `gameId does not match the game manifest: ${pkg.manifest.gameId}`),
        'adapter_invalid',
      );
    }
    const maxPlayers = pkg.manifest.maxPlayers;
    if (Number.isInteger(maxPlayers) && Number(maxPlayers) > 0 && Number(maxPlayers) < 2) {
      throwAppSessionError(
        createAppSessionError('adapter_invalid', 'game manifest maxPlayers must be at least 2.'),
        'adapter_invalid',
      );
    }
    const adapter = adapterSandboxFactory({
      adapterCode: pkg.adapterCode,
      adapterHash: pkg.adapterHash,
    });
    try {
      await smokeLoadAdapter(adapter, params.gameId);
    } finally {
      adapter.dispose();
    }

    const matchCreated = await readMatchCreated(params.groupId);
    if (!matchCreated) {
      throwAppSessionError(
        createAppSessionError('group_not_found', `Group has no agent-game match.created event: ${params.groupId}`),
        'group_not_found',
      );
    }
    if (matchCreated.rulesHash && matchCreated.rulesHash !== params.rulesHash) {
      throwAppSessionError(
        createAppSessionError('rules_hash_mismatch', 'rulesHash does not match the match.created event.'),
        'rules_hash_mismatch',
      );
    }
    if (matchCreated.gameId && matchCreated.gameId !== params.gameId) {
      throwAppSessionError(
        createAppSessionError('adapter_invalid', 'gameId does not match the match.created event.'),
        'adapter_invalid',
      );
    }

    const seatCheck = await checkSeatClaimable(params, pkg);
    if (!seatCheck.ok) {
      throwAppSessionError(seatCheck.error, 'seat_unavailable');
    }
    const key = leaseKey(params.groupId, params.seat);
    const existingLease = leaseFor(key);
    if (existingLease && existingLease.expiresAt > nowMs()) {
      throwAppSessionError(
        createAppSessionError('session_conflict', `Seat ${params.seat} of group ${params.groupId} is already leased.`),
        'session_conflict',
      );
    }
    return pkg;
  }

  async function readMatchCreated(groupId: string): Promise<{ gameId: string; rulesHash: string } | null> {
    let startIndex = 0;
    for (;;) {
      let batch: GroupChatMessage[];
      try {
        batch = await input.fetchGroupMessages({ groupId, startIndex, size: DEFAULT_PAGE_SIZE });
      } catch (error) {
        const status = (error as { status?: unknown }).status;
        if (status === 404 || status === 403) {
          throwAppSessionError(
            createAppSessionError('group_not_found', `Group is not accessible: ${groupId}`),
            'group_not_found',
          );
        }
        throw error;
      }
      if (!batch.length) {
        return null;
      }
      for (const message of batch) {
        const plaintext = message.encryption === 'aes'
          ? decryptGroupContent(message.content, groupId)
          : message.content;
        const envelope = parseAgentGameEnvelope(plaintext);
        if (envelope && envelope.type === 'match.created') {
          return { gameId: envelope.gameId, rulesHash: envelope.rulesHash };
        }
      }
      if (batch.length < DEFAULT_PAGE_SIZE) {
        return null;
      }
      startIndex = batch[batch.length - 1].index + 1;
    }
  }

  async function checkSeatClaimable(
    params: AppSessionStartParams,
    pkg: LoadedGamePackage,
  ): Promise<{ ok: true } | { ok: false; error: AppSessionError }> {
    const adapter = adapterSandboxFactory({
      adapterCode: pkg.adapterCode,
      adapterHash: pkg.adapterHash,
    });
    try {
      let state: unknown;
      try {
        state = await adapter.call('initialState', [{ gameId: params.gameId, rulesHash: params.rulesHash }]);
      } catch (error) {
        return { ok: false, error: createAppSessionError('adapter_invalid', `Adapter initialState failed: ${error instanceof Error ? error.message : String(error)}`) };
      }
      let startIndex = 0;
      for (;;) {
        const batch = await input.fetchGroupMessages({ groupId: params.groupId, startIndex, size: DEFAULT_PAGE_SIZE });
        if (!batch.length) {
          break;
        }
        for (const message of batch) {
          const plaintext = message.encryption === 'aes'
            ? decryptGroupContent(message.content, params.groupId)
            : message.content;
          const envelope = parseAgentGameEnvelope(plaintext);
          if (!envelope || envelope.gameId !== params.gameId || envelope.rulesHash !== params.rulesHash) {
            continue;
          }
          try {
            state = await adapter.call('reduce', [state, {
              ...envelope,
              meta: { index: message.index, senderMetaId: message.senderMetaId, timestamp: message.timestamp },
            }]);
          } catch {
            // Invalid event for this game: keep replaying; final seat check rules.
          }
        }
        if (batch.length < DEFAULT_PAGE_SIZE) {
          break;
        }
        startIndex = batch[batch.length - 1].index + 1;
      }
      let existingSeat: unknown = null;
      try {
        existingSeat = await adapter.call('getSeat', [state, params.agentId]);
      } catch {
        existingSeat = null; // getSeat is optional
      }
      try {
        const turn = await adapter.call('getTurn', [state]) as { phase?: string; seat?: unknown };
        if (turn && turn.phase === 'finished') {
          return { ok: false, error: createAppSessionError('seat_unavailable', 'The match is already finished; seats are not claimable.') };
        }
      } catch {
        // Optional turn check; the adapter decides at claim time.
      }
      if (existingSeat && normalizeText(existingSeat) && normalizeText(existingSeat) !== params.seat) {
        return { ok: false, error: createAppSessionError('seat_unavailable', `Agent is already seated as ${normalizeText(existingSeat)}.`) };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: createAppSessionError(
          'adapter_error',
          `Seat check failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      };
    } finally {
      adapter.dispose();
    }
  }

  async function claimSeat(session: AppSessionRecord, adapter: SandboxedAdapterHandle): Promise<void> {
    let existingSeat: unknown = null;
    try {
      existingSeat = await adapterCall(adapter, 'getSeat', [session.state, session.agentId]);
    } catch {
      existingSeat = null;
    }
    if (existingSeat && normalizeText(existingSeat) && normalizeText(existingSeat) !== session.seat) {
      throwAppSessionError(
        createAppSessionError('seat_unavailable', `Agent is already seated as ${normalizeText(existingSeat)}.`),
        'seat_unavailable',
      );
    }
    if (!existingSeat) {
      const event = envelopeFor(session, 'seat.claimed', {
        requestedRole: session.seat,
        name: session.agentId,
        model: 'host-llm',
        avatar: '',
      });
      let claimed = false;
      for (let attempt = 1; attempt <= maxWriteAttempts; attempt += 1) {
        try {
          await writeEvent(session, event);
          await catchUp(session);
          claimed = true;
          break;
        } catch (error) {
          const errorCode = isRecord(error) && typeof error.code === 'string' ? String(error.code) : '';
          if (errorCode === 'authorization_expired' || errorCode === 'consent_denied' || errorCode === 'rate_limited') {
            throwAppSessionError(error, errorCode as 'authorization_expired' | 'consent_denied' | 'rate_limited');
          }
          if (attempt >= maxWriteAttempts) {
            throwAppSessionError(error, 'write_failed');
          }
          await sleep(backoffMs(writeRetryBaseMs, writeRetryMaxMs, attempt));
        }
      }
      if (!claimed) {
        throwAppSessionError(
          createAppSessionError('write_failed', 'Seat claim could not be written.'),
          'write_failed',
        );
      }
      try {
        let nowSeat: unknown = null;
        let hasGetSeat = true;
        try {
          nowSeat = await adapterCall(adapter, 'getSeat', [session.state, session.agentId]);
        } catch {
          hasGetSeat = false; // getSeat is optional; the adapter rejects claims itself
        }
        if (hasGetSeat && !nowSeat) {
          throwAppSessionError(
            createAppSessionError('seat_unavailable', `Seat ${session.seat} of ${session.groupId} is not claimable.`),
            'seat_unavailable',
          );
        }
      } catch (error) {
        throwAppSessionError(error, 'seat_unavailable');
      }
    }
  }

  async function start(startInput: AppSessionStartParams & AppSessionActorBinding): Promise<AppSessionPublic> {
    if (disposed) {
      throwAppSessionError(createAppSessionError('internal_error', 'Runtime is disposed.'), 'internal_error');
    }
    await ensureLoaded();
    const params = sanitizeStartParams(startInput);
    const existing = state.sessions.find((session) =>
      session.groupId === params.groupId
      && session.seat === params.seat
      && session.agentId === params.agentId
      && session.rulesHash === params.rulesHash
      && (session.status === 'running' || session.status === 'paused'));
    if (existing) {
      requireAccess(existing, startInput);
      return publicSession(existing);
    }

    await validateStartOrThrow(startInput);
    const key = leaseKey(params.groupId, params.seat);
    const sessionId = `sess-${randomUUID()}`;
    if (!acquireLease(key, sessionId)) {
      throwAppSessionError(
        createAppSessionError('session_conflict', `Seat ${params.seat} of group ${params.groupId} is already leased.`),
        'session_conflict',
      );
    }

    const pkg = await input.loadGamePackage({ manifestUri: params.manifestUri });
    const adapter = adapterSandboxFactory({
      adapterCode: pkg.adapterCode,
      adapterHash: pkg.adapterHash,
    });
    let session: AppSessionRecord | null = null;
    try {
      await smokeLoadAdapter(adapter, params.gameId);
      const now = nowMs();
      const grant: AppSessionGrant = {
        grantId: `grant-${randomUUID()}`,
        resourceUri: startInput.resourceUri,
        actorId: startInput.actorId,
        actorGlobalMetaId: startInput.actorGlobalMetaId,
        appId: params.appId,
        groupId: params.groupId,
        gameId: params.gameId,
        rulesHash: params.rulesHash,
        adapterHash: pkg.adapterHash,
        seat: params.seat,
        protocolPaths: [...DEFAULT_AGENT_GAME_PROTOCOL_PATHS],
        ttlMs: params.ttlMs ?? 86_400_000,
        llmBudget: params.budget?.llmCalls ?? 500,
        writeBudget: params.budget?.writes ?? 500,
        createdAt: now,
        expiresAt: now + (params.ttlMs ?? 86_400_000),
        revoked: false,
      };
      session = {
        sessionId,
        appId: params.appId,
        sessionType: APP_SESSION_TYPE,
        resourceUri: startInput.resourceUri,
        groupId: params.groupId,
        gameId: params.gameId,
        manifestUri: params.manifestUri,
        adapterHash: pkg.adapterHash,
        rulesHash: params.rulesHash,
        seat: params.seat,
        agentId: params.agentId,
        actorId: startInput.actorId,
        grantId: grant.grantId,
        status: 'running',
        cursor: 0,
        lastActionSeq: 0,
        lastError: null,
        state: await adapter.call('initialState', [{ gameId: params.gameId, rulesHash: params.rulesHash }]),
        pending: null,
        protocolPaths: [...DEFAULT_AGENT_GAME_PROTOCOL_PATHS],
        createdAt: now,
        updatedAt: now,
        expiresAt: grant.expiresAt,
        budget: {
          llmCalls: grant.llmBudget,
          llmCallsUsed: 0,
          writes: grant.writeBudget,
          writesUsed: 0,
        },
      };
      state.grants.push(grant);
      state.sessions.push(session);
      adapters.set(sessionId, adapter);
      await persist();
      await catchUp(session);
      await claimSeat(session, adapter);
      await persist();
      void Promise.resolve(input.audit?.({
        type: 'app_session_started',
        sessionId,
        grantId: grant.grantId,
        actorId: startInput.actorId,
        resourceUri: startInput.resourceUri,
        groupId: params.groupId,
        gameId: params.gameId,
        seat: params.seat,
        rulesHash: params.rulesHash,
        adapterHash: pkg.adapterHash,
      })).catch(() => undefined);
      scheduleProcess(session);
      return publicSession(session);
    } catch (error) {
      if (session) {
        const failedSessionId = session.sessionId;
        const failedGrantId = session.grantId;
        state.sessions = state.sessions.filter((candidate) => candidate.sessionId !== failedSessionId);
        state.grants = state.grants.filter((candidate) => candidate.grantId !== failedGrantId);
        adapters.delete(sessionId);
      }
      releaseLeaseByKey(key, sessionId);
      adapter.dispose();
      await persist();
      throwAppSessionError(error, 'internal_error');
    }
  }

  function releaseLeaseByKey(key: string, sessionId: string): void {
    state.leases = state.leases.filter((lease) => !(lease.key === key && lease.sessionId === sessionId));
  }

  function list(input: AppSessionActorBinding & AppSessionListFilter): Promise<AppSessionPublic[]> {
    if (!restored) {
      return Promise.resolve([]);
    }
    const filtered = state.sessions.filter((session) => {
      if (!actorMayAccess(session, input)) {
        return false;
      }
      if (normalizeText(input.appId) && session.appId !== normalizeText(input.appId)) {
        return false;
      }
      if (normalizeText(input.status) && session.status !== input.status) {
        return false;
      }
      if (normalizeText(input.groupId) && session.groupId !== normalizeText(input.groupId)) {
        return false;
      }
      return true;
    });
    return Promise.resolve(filtered.map(publicSession));
  }

  async function status(sessionId: string, actor: AppSessionActorBinding): Promise<AppSessionPublic> {
    if (!restored) {
      throwAppSessionError(createAppSessionError('session_not_found', `session ${sessionId} not found`), 'session_not_found');
    }
    const session = sessionById(sessionId);
    if (!session) {
      throwAppSessionError(createAppSessionError('session_not_found', `session ${sessionId} not found`), 'session_not_found');
    }
    requireAccess(session, actor);
    return publicSession(session);
  }

  async function pause(sessionId: string, actor: AppSessionActorBinding): Promise<AppSessionPublic> {
    await ensureLoaded();
    const session = sessionById(sessionId);
    if (!session) {
      throwAppSessionError(createAppSessionError('session_not_found', `session ${sessionId} not found`), 'session_not_found');
    }
    requireAccess(session, actor);
    if (session.status === 'running') {
      session.status = 'paused';
      markDirty(session);
      await persist();
      void Promise.resolve(input.audit?.({
        type: 'app_session_paused',
        sessionId,
        actorId: session.actorId,
        groupId: session.groupId,
      })).catch(() => undefined);
    }
    return publicSession(session);
  }

  async function resume(sessionId: string, actor: AppSessionActorBinding): Promise<AppSessionPublic> {
    await ensureLoaded();
    const session = sessionById(sessionId);
    if (!session) {
      throwAppSessionError(createAppSessionError('session_not_found', `session ${sessionId} not found`), 'session_not_found');
    }
    requireAccess(session, actor);
    if (session.status === 'finished' || session.status === 'stopped') {
      return publicSession(session); // terminal sessions never restart automatically
    }
    if (session.status !== 'paused') {
      return publicSession(session);
    }
    if (await autoPauseIfNeeded(session)) {
      return publicSession(session);
    }
    const key = leaseKey(session.groupId, session.seat);
    if (!acquireLease(key, session.sessionId)) {
      session.lastError = createAppSessionError('session_conflict', 'Seat is leased by another runner.');
      markDirty(session);
      await persist();
      throwAppSessionError(
        createAppSessionError('session_conflict', 'Seat is leased by another runner.'),
        'session_conflict',
      );
    }
    try {
      await loadSessionAdapter(session);
    } catch (error) {
      session.lastError = asAppSessionError(error, 'adapter_invalid');
      markDirty(session);
      await persist();
      throwAppSessionError(error, 'adapter_invalid');
    }
    session.status = 'running';
    session.lastError = null;
    markDirty(session);
    await persist();
    await catchUp(session);
    void Promise.resolve(input.audit?.({
      type: 'app_session_resumed',
      sessionId,
      actorId: session.actorId,
      groupId: session.groupId,
    })).catch(() => undefined);
    scheduleProcess(session);
    return publicSession(session);
  }

  async function stop(
    sessionId: string,
    actor: AppSessionActorBinding,
    options: { releaseSeat?: boolean } = {},
  ): Promise<AppSessionPublic> {
    await ensureLoaded();
    const session = sessionById(sessionId);
    if (!session) {
      throwAppSessionError(createAppSessionError('session_not_found', `session ${sessionId} not found`), 'session_not_found');
    }
    requireAccess(session, actor);
    if (session.status !== 'stopped') {
      if (options.releaseSeat === true) {
        const adapter = adapterFor(session);
        if (adapter) {
          try {
            const releaseEvent = await adapterCall<{ type?: string; payload?: Record<string, unknown> } | null>(
              adapter,
              'releaseSeat',
              [session.state, { seat: session.seat, groupId: session.groupId }],
            );
            if (releaseEvent && releaseEvent.type && isRecord(releaseEvent.payload)) {
              await writeEvent(session, envelopeFor(session, releaseEvent.type, releaseEvent.payload));
            }
          } catch {
            // releaseSeat is optional; the host never bypasses protocol rules.
          }
        }
      }
      session.status = 'stopped';
      session.pending = null;
      releaseLease(session);
      markDirty(session);
      await persist();
      void Promise.resolve(input.audit?.({
        type: 'app_session_stopped',
        sessionId,
        actorId: session.actorId,
        groupId: session.groupId,
        releaseSeat: options.releaseSeat === true,
      })).catch(() => undefined);
    }
    return publicSession(session);
  }

  // ---- Listener + heartbeat + restore ----

  function notifyGroupActivity(groupId: string): void {
    const normalized = normalizeText(groupId);
    if (!normalized) {
      return;
    }
    for (const session of state.sessions) {
      if (session.groupId === normalized && session.status === 'running') {
        scheduleProcess(session);
      }
    }
  }

  async function startRuntime(): Promise<AppSessionRuntimeStartReport> {
    if (restored) {
      return { restored: 0, running: 0, paused: 0, stopped: 0, conflicts: 0 };
    }
    restored = true;
    state = (await input.store.load()) ?? { version: 1, sessions: [], grants: [], leases: [] };
    const report: AppSessionRuntimeStartReport = { restored: 0, running: 0, paused: 0, stopped: 0, conflicts: 0 };
    for (const session of state.sessions) {
      if (session.status !== 'running' && session.status !== 'paused') {
        continue;
      }
      report.restored += 1;
      const grant = grantById(session.grantId);
      if (!grant || grant.revoked) {
        session.status = 'stopped';
        session.lastError = createAppSessionError('consent_denied', 'The task authorization was revoked.');
        session.pending = null;
        releaseLease(session);
        report.stopped += 1;
        continue;
      }
      if (nowMs() >= grant.expiresAt) {
        session.status = 'paused';
        session.lastError = createAppSessionError('authorization_expired', 'The task authorization expired.');
        report.paused += 1;
        continue;
      }
      if (session.budget.llmCallsUsed >= session.budget.llmCalls
        || session.budget.writesUsed >= session.budget.writes) {
        session.status = 'paused';
        session.lastError = createAppSessionError('budget_exhausted', 'The session budget is exhausted.');
        report.paused += 1;
        continue;
      }
      try {
        await loadSessionAdapter(session);
      } catch (error) {
        session.status = 'paused';
        session.lastError = asAppSessionError(error, 'adapter_invalid');
        report.paused += 1;
        continue;
      }
      if (session.status === 'running') {
        if (!acquireLease(leaseKey(session.groupId, session.seat), session.sessionId)) {
          session.status = 'paused';
          session.lastError = createAppSessionError('session_conflict', 'Seat is leased by another runner.');
          report.conflicts += 1;
          report.paused += 1;
          continue;
        }
        report.running += 1;
      } else {
        report.paused += 1;
      }
    }
    await persist();
    for (const session of state.sessions) {
      if (session.status !== 'running' && session.status !== 'paused') {
        continue;
      }
      try {
        await catchUp(session);
      } catch (error) {
        log(`[app-session] ${session.sessionId} restore catch-up failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (session.status === 'running') {
        scheduleProcess(session);
      }
    }
    if (heartbeatIntervalMs > 0) {
      heartbeat = setInterval(() => {
        void heartbeatTick().catch((error) => {
          log(`[app-session] heartbeat error: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, heartbeatIntervalMs);
    }
    void Promise.resolve(input.audit?.({
      type: 'app_session_runtime_started',
      ownerId,
      restored: report.restored,
      running: report.running,
      paused: report.paused,
      conflicts: report.conflicts,
    })).catch(() => undefined);
    return report;
  }

  async function heartbeatTick(): Promise<void> {
    if (disposed) {
      return;
    }
    const now = nowMs();
    let leaseChanged = false;
    let stateChanged = false;
    for (const session of state.sessions) {
      const grant = grantById(session.grantId);
      const key = leaseKey(session.groupId, session.seat);
      const lease = leaseFor(key);
      if (session.status === 'running' && lease && lease.sessionId === session.sessionId) {
        lease.expiresAt = now + leaseTtlMs;
        lease.updatedAt = now;
        leaseChanged = true;
      }
      if (session.status === 'running' && grant && now >= grant.expiresAt) {
        if (await autoPauseIfNeeded(session)) {
          stateChanged = true;
          continue;
        }
      }
      if (session.status === 'running' && session.pending && session.pending.nextRetryAt <= now) {
        scheduleProcess(session);
      }
    }
    if (leaseChanged || stateChanged) {
      await persist();
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) {
      return;
    }
    disposed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    for (const session of state.sessions) {
      if (session.status === 'running') {
        releaseLease(session);
      }
    }
    await persist();
    for (const adapter of adapters.values()) {
      try {
        adapter.dispose();
      } catch {
        // Best effort shutdown.
      }
    }
    adapters.clear();
  }

  return {
    validateStart,
    start,
    list,
    status,
    pause,
    resume,
    stop,
    notifyGroupActivity,
    startRuntime,
    dispose,
  };
}
