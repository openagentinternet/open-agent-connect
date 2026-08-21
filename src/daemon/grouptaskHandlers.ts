/**
 * Group Task daemon handler group: builds the production
 * GroupTaskServiceContext (profiles from the manager registry, per-profile
 * mnemonic signers, owner identity signer) and exposes the HTTP handler verbs
 * the /api/grouptask/* routes dispatch to. All business rules live in
 * core/grouptask/service; this file is wiring + input normalization only.
 */

import path from 'node:path';
import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../core/contracts/commandResult';
import {
  archiveGroupTask,
  closeGroupTask,
  createGroupTask,
  getGroupTaskDetail,
  kickGroupTaskMember,
  listGroupTaskMessages,
  listGroupTaskSummaries,
  postGroupTaskMessage,
  renameGroupTask,
  reopenGroupTask,
  setGroupTaskMemberStatus,
  setGroupTaskPinned,
  unarchiveGroupTask,
  GroupTaskServiceError,
  type GroupTaskOwnerRef,
  type GroupTaskProfileRef,
  type GroupTaskServiceContext,
} from '../core/grouptask/service';
import { GroupTaskStoreError } from '../core/grouptask/store';
import type { GroupTaskTransportOptions } from '../core/grouptask/transport';
import type { GroupTaskListTab, GroupTaskMemberStatus } from '../core/grouptask/types';
import {
  getMetabotProfile,
  listMetabotProfiles,
  type MetabotProfileFull,
} from '../core/bot/metabotProfileManager';
import { readOwnerIdentity, type OwnerIdentityRecord } from '../core/owner/ownerIdentity';
import { createLocalMnemonicSigner } from '../core/signing/localMnemonicSigner';
import type { ChainAdapterRegistry } from '../core/chain/adapters/types';
import type { SecretStore } from '../core/secrets/secretStore';
import type { Signer } from '../core/signing/signer';
import { createRuntimeStateStore } from '../core/state/runtimeStateStore';
import { resolveMetabotPaths } from '../core/state/paths';

export interface GroupTaskDaemonHandlers {
  create: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  list: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  detail: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  messages: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  postMessage: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  close: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  reopen: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  kickMember: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  setMemberStatus: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  rename: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  setPinned: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  setArchived: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
}

// ---------------------------------------------------------------------------
// Input normalization helpers
// ---------------------------------------------------------------------------

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readInt(value: unknown): number | undefined {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return undefined;
  return Math.trunc(numeric);
}

function readBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeText(entry)).filter(Boolean);
}

interface TaskRef {
  chair: string;
  taskId: number;
}

function readTaskRef(input: Record<string, unknown>): TaskRef | MetabotCommandResult<never> {
  const chair = normalizeText(input.chair) || normalizeText(input.chairSlug);
  if (!chair) return commandFailed('chair_required', 'chair (chair profile slug) is required');
  const taskId = readInt(input.taskId);
  if (taskId == null || taskId <= 0) {
    return commandFailed('task_id_required', 'taskId must be a positive integer');
  }
  return { chair, taskId };
}

function isFailure(value: TaskRef | MetabotCommandResult<never>): value is MetabotCommandResult<never> {
  return 'ok' in value;
}

// ---------------------------------------------------------------------------
// Production service context
// ---------------------------------------------------------------------------

function toProfileRef(profile: MetabotProfileFull, metaId: string | null): GroupTaskProfileRef {
  return {
    slug: profile.slug,
    homeDir: profile.homeDir,
    name: profile.name,
    globalMetaId: normalizeText(profile.globalMetaId) || null,
    metaId,
    botType: profile.botType === 'twin' ? 'twin' : profile.botType === 'worker' ? 'worker' : null,
    avatar: normalizeText(profile.avatarDataUrl) || null,
  };
}

async function readProfileMetaId(homeDir: string): Promise<string | null> {
  try {
    const state = await createRuntimeStateStore(homeDir).readState();
    return normalizeText(state.identity?.metaId) || null;
  } catch {
    return null;
  }
}

/**
 * Read-only SecretStore view over the owner identity record; the signer only
 * ever calls readIdentitySecrets.
 */
function createOwnerSecretStore(systemHomeDir: string, owner: OwnerIdentityRecord): SecretStore {
  const paths = resolveMetabotPaths(path.join(systemHomeDir, '.metabot', 'owner'));
  return {
    paths,
    ensureLayout: async () => paths,
    readIdentitySecrets: async <T,>() => ({ mnemonic: owner.mnemonic, path: owner.path } as unknown as T),
    writeIdentitySecrets: async () => {
      throw new Error('Owner identity secrets are read-only in the group task context.');
    },
    deleteIdentitySecrets: async () => {
      throw new Error('Owner identity secrets are read-only in the group task context.');
    },
  };
}

export interface CreateGroupTaskDaemonHandlersInput {
  systemHomeDir: string;
  createSignerForProfileHome: (homeDir: string) => Signer;
  adapters: ChainAdapterRegistry;
  transport?: GroupTaskTransportOptions;
  log?: (message: string) => void;
}

/** Build the production GroupTaskServiceContext (exported for engine reuse). */
export function createGroupTaskServiceContext(
  input: CreateGroupTaskDaemonHandlersInput,
): GroupTaskServiceContext {
  let ownerSigner: Signer | null = null;

  return {
    listProfiles: async () => {
      const profiles = await listMetabotProfiles(input.systemHomeDir).catch(() => [] as MetabotProfileFull[]);
      return Promise.all(
        profiles.map(async (profile) => toProfileRef(profile, await readProfileMetaId(profile.homeDir))),
      );
    },
    getProfile: async (slug) => {
      const profile = await getMetabotProfile(input.systemHomeDir, slug).catch(() => null);
      if (!profile) return null;
      return toProfileRef(profile, await readProfileMetaId(profile.homeDir));
    },
    signerForSlug: async (slug) => {
      const profile = await getMetabotProfile(input.systemHomeDir, slug);
      if (!profile) {
        throw new GroupTaskServiceError('profile_not_found', `MetaBot profile not found: ${slug}`);
      }
      return input.createSignerForProfileHome(profile.homeDir);
    },
    ownerIdentity: async (): Promise<GroupTaskOwnerRef | null> => {
      const owner = await readOwnerIdentity(input.systemHomeDir);
      if (!owner) return null;
      ownerSigner ??= createLocalMnemonicSigner({
        secretStore: createOwnerSecretStore(input.systemHomeDir, owner),
        adapters: input.adapters,
      });
      return {
        globalMetaId: owner.globalMetaId,
        metaId: owner.metaId || null,
        name: owner.name,
        signer: ownerSigner,
      };
    },
    ...(input.transport ? { transport: input.transport } : {}),
    ...(input.log ? { log: input.log } : {}),
  };
}

// ---------------------------------------------------------------------------
// Handler group
// ---------------------------------------------------------------------------

export function createGroupTaskDaemonHandlers(
  input: CreateGroupTaskDaemonHandlersInput & { context?: GroupTaskServiceContext },
): GroupTaskDaemonHandlers {
  const ctx = input.context ?? createGroupTaskServiceContext(input);

  async function run<T>(work: () => Promise<T>): Promise<MetabotCommandResult<T>> {
    try {
      return commandSuccess(await work());
    } catch (error) {
      if (error instanceof GroupTaskServiceError || error instanceof GroupTaskStoreError) {
        return commandFailed(error.code, error.message);
      }
      return commandFailed('grouptask_failed', error instanceof Error ? error.message : String(error));
    }
  }

  return {
    create: async (body) => run(async () => {
      const workerSlugs = readStringArray(body.workerSlugs);
      const created = await createGroupTask(ctx, {
        title: normalizeText(body.title),
        goal: normalizeText(body.goal),
        acceptanceCriteria: normalizeText(body.acceptanceCriteria) || null,
        workerSlugs,
        chairSlug: normalizeText(body.chairSlug) || undefined,
        createdBy: body.createdBy === 'twinbot' ? 'twinbot' : 'user',
      });
      return { chairSlug: created.chairSlug, task: created.task };
    }),

    list: async (body) => run(async () => {
      const tabRaw = normalizeText(body.tab);
      const tab: GroupTaskListTab = tabRaw === 'active' || tabRaw === 'done' || tabRaw === 'cancelled' || tabRaw === 'all'
        ? tabRaw
        : 'all';
      const tasks = await listGroupTaskSummaries(ctx, {
        tab,
        includeArchived: readBool(body.includeArchived) ?? false,
      });
      return { tasks };
    }),

    detail: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      return run(async () => {
        const view = normalizeText(body.view) === 'summary' ? 'summary' as const : 'full' as const;
        return getGroupTaskDetail(ctx, ref.chair, ref.taskId, {
          view,
          sync: readBool(body.sync) ?? true,
        });
      });
    },

    messages: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      return run(() => listGroupTaskMessages(ctx, ref.chair, ref.taskId, {
        limit: readInt(body.limit),
        beforeIndex: readInt(body.beforeIndex),
        sync: readBool(body.sync) ?? true,
      }));
    },

    postMessage: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      return run(() => postGroupTaskMessage(ctx, ref.chair, ref.taskId, {
        asSlug: normalizeText(body.asSlug) || undefined,
        asOwner: readBool(body.asOwner) ?? false,
        content: normalizeText(body.content),
        replyPin: normalizeText(body.replyPin) || undefined,
        mention: readStringArray(body.mention),
      }));
    },

    close: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      const outcome = normalizeText(body.outcome) || normalizeText(body.status);
      if (outcome !== 'done' && outcome !== 'cancelled') {
        return commandFailed('invalid_outcome', "outcome must be 'done' or 'cancelled'");
      }
      return run(() => closeGroupTask(ctx, ref.chair, ref.taskId, {
        status: outcome,
        reason: normalizeText(body.reason) || undefined,
        rating: readInt(body.rating),
        ratingComment: normalizeText(body.ratingComment) || undefined,
        actor: { kind: 'owner' },
      }));
    },

    reopen: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      return run(() => reopenGroupTask(ctx, ref.chair, ref.taskId, {
        actor: { kind: 'owner' },
        reason: normalizeText(body.reason) || undefined,
      }));
    },

    kickMember: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      return run(() => kickGroupTaskMember(ctx, ref.chair, ref.taskId, {
        slug: normalizeText(body.slug) || undefined,
        globalMetaId: normalizeText(body.globalMetaId) || undefined,
        reason: normalizeText(body.reason) || undefined,
      }));
    },

    setMemberStatus: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      const status = normalizeText(body.status) as GroupTaskMemberStatus;
      return run(() => setGroupTaskMemberStatus(ctx, ref.chair, ref.taskId, {
        slug: normalizeText(body.slug) || null,
        globalMetaId: normalizeText(body.globalMetaId) || null,
        status,
      }));
    },

    rename: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      const displayName = typeof body.displayName === 'string' ? body.displayName : '';
      return run(() => renameGroupTask(ctx, ref.chair, ref.taskId, displayName));
    },

    setPinned: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      const pinned = readBool(body.pinned);
      if (pinned == null) return commandFailed('pinned_required', 'pinned must be true or false');
      return run(() => setGroupTaskPinned(ctx, ref.chair, ref.taskId, pinned));
    },

    setArchived: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      const archived = readBool(body.archived);
      if (archived == null) return commandFailed('archived_required', 'archived must be true or false');
      return run(() => (archived
        ? archiveGroupTask(ctx, ref.chair, ref.taskId)
        : unarchiveGroupTask(ctx, ref.chair, ref.taskId)));
    },
  };
}
