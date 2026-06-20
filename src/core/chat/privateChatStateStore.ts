import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import { resolveMetabotPaths } from '../state/paths';
import { ensureRuntimeLayout } from '../state/runtimeStateStore';
import type {
  PrivateChatState,
  PrivateChatConversation,
  PrivateChatMessage,
} from './privateChatTypes';

const PRIVATE_CHAT_STATE_SCHEMA_VERSION = 1;
const MAX_MESSAGES = 10_000;
const MAX_CONVERSATIONS = 500;
const LOCKFILE_BASE_DELAY_MS = 25;
const LOCKFILE_MAX_ATTEMPTS = 200;
const LOCKFILE_STALE_WITH_PID_MS = 5 * 60 * 1000;
const LOCKFILE_STALE_WITHOUT_PID_MS = 30_000;
const DEFAULT_PENDING_GUIDANCE_LEASE_MS = 5 * 60 * 1000;

export interface PrivateChatPendingGuidanceClaim {
  guidanceText: string;
  createdAt: number;
  leaseId: string;
  leaseExpiresAt: number;
}

export interface PrivateChatStateStore {
  paths: MetabotPaths;
  privateChatStatePath: string;
  readState(): Promise<PrivateChatState>;
  updateState(
    updater: (state: PrivateChatState) => PrivateChatState | Promise<PrivateChatState>,
  ): Promise<PrivateChatState>;
  upsertConversation(conv: PrivateChatConversation): Promise<PrivateChatConversation>;
  setPendingGuidance(
    conversationId: string,
    guidanceText: string,
    createdAt: number,
  ): Promise<PrivateChatConversation | null>;
  claimPendingGuidance(
    conversationId: string,
    options?: {
      now?: number;
      leaseMs?: number;
    },
  ): Promise<PrivateChatPendingGuidanceClaim | null>;
  releasePendingGuidanceClaimIfMatches(
    conversationId: string,
    claim: PrivateChatPendingGuidanceClaim,
  ): Promise<PrivateChatConversation | null>;
  clearPendingGuidanceIfMatches(
    conversationId: string,
    guidanceText: string,
    createdAt: number,
    leaseId?: string | null,
  ): Promise<PrivateChatConversation | null>;
  appendMessages(messages: PrivateChatMessage[]): Promise<PrivateChatMessage[]>;
  getConversationByPeer(peerGlobalMetaId: string): Promise<PrivateChatConversation | null>;
  getRecentMessages(conversationId: string, limit?: number): Promise<PrivateChatMessage[]>;
}

function cloneEmptyState(): PrivateChatState {
  return {
    version: PRIVATE_CHAT_STATE_SCHEMA_VERSION,
    conversations: [],
    messages: [],
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeConversation(
  conversation: PrivateChatConversation | Record<string, unknown>,
): PrivateChatConversation {
  const source = conversation as Record<string, unknown>;
  const pendingGuidanceText = normalizeText(source.pendingGuidanceText);
  return {
    ...(conversation as PrivateChatConversation),
    pendingGuidanceText: pendingGuidanceText || null,
    pendingGuidanceCreatedAt:
      pendingGuidanceText && typeof source.pendingGuidanceCreatedAt === 'number'
        ? source.pendingGuidanceCreatedAt
        : null,
    pendingGuidanceLeaseId:
      typeof source.pendingGuidanceLeaseId === 'string' ? source.pendingGuidanceLeaseId : null,
    pendingGuidanceLeaseExpiresAt:
      typeof source.pendingGuidanceLeaseExpiresAt === 'number' ? source.pendingGuidanceLeaseExpiresAt : null,
  };
}

function buildPendingGuidanceLeaseId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `guidance-lease-${Date.now()}-${random}`;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    if (error instanceof SyntaxError) {
      const corruptPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        await fs.rename(filePath, corruptPath);
      } catch {
        // Best effort quarantine.
      }
      return null;
    }
    throw error;
  }
}

async function readLockInfo(filePath: string): Promise<{ pid?: number; acquiredAt?: number } | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown; acquiredAt?: unknown };
    return {
      pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
      acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : undefined,
    };
  } catch {
    return null;
  }
}

async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(tempPath, 'w');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
    try {
      const directoryHandle = await fs.open(path.dirname(filePath), 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EINVAL' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EBADF') {
        throw error;
      }
    }
  } catch (error) {
    if (handle) {
      await handle.close();
    }
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

async function withLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < LOCKFILE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`, 'utf8');
        return await operation();
      } finally {
        await handle.close();
        try {
          await fs.rm(lockPath, { force: true });
        } catch {
          // Best effort cleanup.
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
      try {
        const lockInfo = await readLockInfo(lockPath);
        const stat = await fs.stat(lockPath);
        const lockPid = typeof lockInfo?.pid === 'number' ? lockInfo.pid : null;
        const acquiredAt =
          typeof lockInfo?.acquiredAt === 'number' ? lockInfo.acquiredAt : stat.mtimeMs;
        const ownerAlive = lockPid ? isProcessAlive(lockPid) : false;
        if (lockPid && !ownerAlive) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
        const staleThreshold = lockPid ? LOCKFILE_STALE_WITH_PID_MS : LOCKFILE_STALE_WITHOUT_PID_MS;
        const stale = Date.now() - acquiredAt > staleThreshold;
        if (!lockPid && stale) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch {
        // Another writer may have released the lock between stat/remove attempts.
      }
      await sleep(Math.min(LOCKFILE_BASE_DELAY_MS * (attempt + 1), 250));
    }
  }
  throw new Error(`Timed out acquiring private-chat-state lock: ${lockPath}`);
}

function normalizeState(value: PrivateChatState | null): PrivateChatState {
  if (!value || typeof value !== 'object') {
    return cloneEmptyState();
  }
  const source = value as unknown as Record<string, unknown>;
  return {
    version: typeof source.version === 'number' ? source.version : PRIVATE_CHAT_STATE_SCHEMA_VERSION,
    conversations: Array.isArray(source.conversations)
      ? (source.conversations as Array<PrivateChatConversation | Record<string, unknown>>)
          .slice(-MAX_CONVERSATIONS)
          .map(normalizeConversation)
      : [],
    messages: Array.isArray(source.messages)
      ? (source.messages as PrivateChatMessage[]).slice(-MAX_MESSAGES)
      : [],
  };
}

function replaceConversation(
  conversations: PrivateChatConversation[],
  conversationId: string,
  updater: (conversation: PrivateChatConversation) => PrivateChatConversation,
): PrivateChatConversation[] {
  return conversations.map(conversation =>
    conversation.conversationId === conversationId ? updater(conversation) : conversation,
  );
}

export function createPrivateChatStateStore(
  homeDirOrPaths: string | MetabotPaths,
): PrivateChatStateStore {
  const paths =
    typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const privateChatStatePath = paths.privateChatStatePath;
  const lockPath = `${privateChatStatePath}.lock`;
  let pendingWrite = Promise.resolve();

  const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = pendingWrite.then(
      async () => {
        await ensureRuntimeLayout(paths);
        return withLock(lockPath, operation);
      },
      async () => {
        await ensureRuntimeLayout(paths);
        return withLock(lockPath, operation);
      },
    );
    pendingWrite = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    paths,
    privateChatStatePath,

    async readState() {
      await ensureRuntimeLayout(paths);
      return normalizeState(await readJsonFile<PrivateChatState>(privateChatStatePath));
    },

    async updateState(updater) {
      return runExclusive(async () => {
        await ensureRuntimeLayout(paths);
        const current = normalizeState(await readJsonFile<PrivateChatState>(privateChatStatePath));
        const nextState = await updater(current);
        const normalized = normalizeState(nextState);
        await writeJsonFileAtomically(privateChatStatePath, normalized);
        return normalized;
      });
    },

    async upsertConversation(conv) {
      await this.updateState(state => ({
        ...state,
        conversations: [
          ...state.conversations.filter(c => c.conversationId !== conv.conversationId),
          normalizeConversation(conv),
        ],
      }));
      return normalizeConversation(conv);
    },

    async setPendingGuidance(conversationId, guidanceText, createdAt) {
      let updatedConversation: PrivateChatConversation | null = null;
      const normalizedGuidanceText = normalizeText(guidanceText);
      await this.updateState(state => {
        const conversations = replaceConversation(state.conversations, conversationId, conversation => {
          updatedConversation = {
            ...conversation,
            pendingGuidanceText: normalizedGuidanceText || null,
            pendingGuidanceCreatedAt: normalizedGuidanceText ? createdAt : null,
            pendingGuidanceLeaseId: null,
            pendingGuidanceLeaseExpiresAt: null,
          };
          return updatedConversation;
        });
        return { ...state, conversations };
      });
      return updatedConversation;
    },

    async claimPendingGuidance(conversationId, options = {}) {
      let claim: PrivateChatPendingGuidanceClaim | null = null;
      const now = typeof options.now === 'number' ? options.now : Date.now();
      const leaseMs = typeof options.leaseMs === 'number'
        ? Math.max(1, Math.trunc(options.leaseMs))
        : DEFAULT_PENDING_GUIDANCE_LEASE_MS;
      await this.updateState(state => {
        const conversations = replaceConversation(state.conversations, conversationId, conversation => {
          const guidanceText = normalizeText(conversation.pendingGuidanceText);
          const createdAt = conversation.pendingGuidanceCreatedAt;
          if (!guidanceText || typeof createdAt !== 'number') {
            return conversation;
          }
          const activeLeaseId = normalizeText(conversation.pendingGuidanceLeaseId);
          const activeLeaseExpiresAt = conversation.pendingGuidanceLeaseExpiresAt;
          if (
            activeLeaseId
            && typeof activeLeaseExpiresAt === 'number'
            && activeLeaseExpiresAt > now
          ) {
            return conversation;
          }
          const leaseId = buildPendingGuidanceLeaseId();
          const leaseExpiresAt = now + leaseMs;
          claim = {
            guidanceText,
            createdAt,
            leaseId,
            leaseExpiresAt,
          };
          return {
            ...conversation,
            pendingGuidanceLeaseId: leaseId,
            pendingGuidanceLeaseExpiresAt: leaseExpiresAt,
          };
        });
        return { ...state, conversations };
      });
      return claim;
    },

    async releasePendingGuidanceClaimIfMatches(conversationId, claim) {
      let updatedConversation: PrivateChatConversation | null = null;
      await this.updateState(state => {
        const conversations = replaceConversation(state.conversations, conversationId, conversation => {
          if (
            conversation.pendingGuidanceText !== claim.guidanceText ||
            conversation.pendingGuidanceCreatedAt !== claim.createdAt ||
            conversation.pendingGuidanceLeaseId !== claim.leaseId
          ) {
            updatedConversation = conversation;
            return conversation;
          }
          updatedConversation = {
            ...conversation,
            pendingGuidanceLeaseId: null,
            pendingGuidanceLeaseExpiresAt: null,
          };
          return updatedConversation;
        });
        return { ...state, conversations };
      });
      return updatedConversation;
    },

    async clearPendingGuidanceIfMatches(conversationId, guidanceText, createdAt, leaseId = null) {
      let updatedConversation: PrivateChatConversation | null = null;
      await this.updateState(state => {
        const conversations = replaceConversation(state.conversations, conversationId, conversation => {
          if (
            conversation.pendingGuidanceText !== guidanceText ||
            conversation.pendingGuidanceCreatedAt !== createdAt ||
            (leaseId && conversation.pendingGuidanceLeaseId !== leaseId)
          ) {
            updatedConversation = conversation;
            return conversation;
          }
          updatedConversation = {
            ...conversation,
            pendingGuidanceText: null,
            pendingGuidanceCreatedAt: null,
            pendingGuidanceLeaseId: null,
            pendingGuidanceLeaseExpiresAt: null,
          };
          return updatedConversation;
        });
        return { ...state, conversations };
      });
      return updatedConversation;
    },

    async appendMessages(messages) {
      if (messages.length === 0) return messages;
      await this.updateState(state => {
        const existingIds = new Set(state.messages.map(m => m.messageId));
        const newMessages = messages.filter(m => !existingIds.has(m.messageId));
        if (newMessages.length === 0) return state;
        return {
          ...state,
          messages: [...state.messages, ...newMessages].slice(-MAX_MESSAGES),
        };
      });
      return messages;
    },

    async getConversationByPeer(peerGlobalMetaId) {
      const state = await this.readState();
      const normalizedPeer = normalizeText(peerGlobalMetaId).toLowerCase();
      const matching = state.conversations
        .filter(c => normalizeText(c.peerGlobalMetaId).toLowerCase() === normalizedPeer)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const active = matching.find(c => c.state === 'active');
      return active ?? matching[0] ?? null;
    },

    async getRecentMessages(conversationId, limit = 20) {
      const state = await this.readState();
      const filtered = state.messages
        .filter(m => m.conversationId === conversationId)
        .sort((a, b) => a.timestamp - b.timestamp);
      return filtered.slice(-limit);
    },
  };
}
