/**
 * Group Task daemon handler group: builds the production
 * GroupTaskServiceContext (profiles from the manager registry, per-profile
 * mnemonic signers, owner identity signer) and exposes the HTTP handler verbs
 * the /api/grouptask/* routes dispatch to. All business rules live in
 * core/grouptask/service; this file is wiring + input normalization only.
 */

import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../core/contracts/commandResult';
import {
  archiveGroupTask,
  closeGroupTask,
  createGroupTask,
  deleteGroupTaskDeliverableEntry,
  drainGroupTaskRelay,
  getGroupTaskDetail,
  getGroupTaskRecord,
  kickGroupTaskMember,
  listGroupTaskMessages,
  listGroupTaskSummaries,
  postGroupTaskMessage,
  renameGroupTask,
  reopenGroupTask,
  setGroupTaskMemberStatus,
  setGroupTaskPinned,
  superviseGroupTask,
  unarchiveGroupTask,
  GroupTaskServiceError,
  type GroupTaskOwnerRef,
  type GroupTaskProfileRef,
  type GroupTaskServiceContext,
} from '../core/grouptask/service';
import {
  inviteRemoteMember,
  listOpenTeamCollabMessages,
  listOpenTeamCollabs,
  listOpenTeamInvites,
} from '../core/grouptask/openteamService';
import { getGroupTaskHealth } from '../core/grouptask/health';
import { resolveGroupTaskEngineLogPath } from '../core/grouptask/engineLog';
import {
  createGroupTaskFromProposal,
  evaluateStaffingOwnerGate,
  listStaffingProposals,
  proposeGroupTaskStaffing,
  recordStaffingOwnerDecision,
} from '../core/grouptask/staffingService';
import { searchGroupTaskSeatCandidates, type SeatImpressionSnapshot } from '../core/grouptask/candidateSearch';
import { GroupTaskStaffingError } from '../core/grouptask/staffing';
import { createImpressionStore } from '../core/memory/impressionStore';
import { createConfigStore } from '../core/config/configStore';
import { GroupTaskStoreError } from '../core/grouptask/store';
import type { GroupTaskTransportOptions } from '../core/grouptask/transport';
import { sendPrivateChat } from '../core/chat/privateChat';
import type { GroupTaskListTab, GroupTaskMemberStatus } from '../core/grouptask/types';
import {
  getMetabotProfile,
  listMetabotProfiles,
  type MetabotProfileFull,
} from '../core/bot/metabotProfileManager';
import { readOwnerIdentity, resolveOwnerIdfilePath, type OwnerIdentityRecord } from '../core/owner/ownerIdentity';
import { createLocalMnemonicSigner } from '../core/signing/localMnemonicSigner';
import type { ChainAdapterRegistry } from '../core/chain/adapters/types';
import type { SecretStore } from '../core/secrets/secretStore';
import type { Signer } from '../core/signing/signer';
import { createRuntimeStateStore } from '../core/state/runtimeStateStore';
import { resolveMetabotDaemonPaths, resolveMetabotPaths, type MetabotPaths } from '../core/state/paths';

export interface GroupTaskDaemonHandlers {
  create: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  list: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  detail: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  messages: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  postMessage: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  supervise: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  deleteDeliverable: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  relayDrain: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  close: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  reopen: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  kickMember: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  setMemberStatus: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  rename: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  setPinned: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  setArchived: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  invite: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  invites: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  collabs: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  collabMessages: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  health: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  staffingPropose: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  staffingList: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  staffingDecide: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  staffingCreate: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  staffingSearch: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
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
 * ever calls readIdentitySecrets. The owner home (~/.metabot/owner) is NOT a
 * profile home, so resolveMetabotPaths rejects it — the paths stub below
 * exists solely to satisfy the SecretStore interface.
 */
function createOwnerSecretStore(systemHomeDir: string, owner: OwnerIdentityRecord): SecretStore {
  const paths = {
    identitySecretsPath: resolveOwnerIdfilePath(systemHomeDir),
  } as unknown as MetabotPaths;
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
  /** The daemon's own profile home; its config holds the a2a listener switch. */
  daemonHomeDir?: string;
  createSignerForProfileHome: (homeDir: string) => Signer;
  adapters: ChainAdapterRegistry;
  /** Peer chat pubkey resolver; enables OpenTeam private-message envelopes. */
  resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
  transport?: GroupTaskTransportOptions;
  log?: (message: string) => void;
}

/** Build the production GroupTaskServiceContext (exported for engine reuse). */
export function createGroupTaskServiceContext(
  input: CreateGroupTaskDaemonHandlersInput,
): GroupTaskServiceContext {
  let ownerSigner: Signer | null = null;

  const signerForSlug = async (slug: string): Promise<Signer> => {
    const profile = await getMetabotProfile(input.systemHomeDir, slug);
    if (!profile) {
      throw new GroupTaskServiceError('profile_not_found', `MetaBot profile not found: ${slug}`);
    }
    return input.createSignerForProfileHome(profile.homeDir);
  };

  const resolvePeerKey = input.resolvePeerChatPublicKey;
  const sendPrivateMessage = resolvePeerKey
    ? async (message: { fromSlug: string; toGlobalMetaId: string; content: string }) => {
      const signer = await signerForSlug(message.fromSlug);
      const identity = await signer.getPrivateChatIdentity();
      const peerChatPublicKey = await resolvePeerKey(message.toGlobalMetaId);
      if (!peerChatPublicKey) {
        throw new GroupTaskServiceError(
          'peer_chat_key_unavailable',
          `No chat public key found for ${message.toGlobalMetaId}`,
        );
      }
      const sent = sendPrivateChat({
        fromIdentity: {
          globalMetaId: identity.globalMetaId,
          privateKeyHex: identity.privateKeyHex,
        },
        toGlobalMetaId: message.toGlobalMetaId,
        peerChatPublicKey,
        content: message.content,
      });
      const write = await signer.writePin({
        operation: 'create',
        path: sent.path,
        encryption: sent.encryption,
        version: sent.version,
        contentType: sent.contentType,
        payload: sent.payload,
        encoding: 'utf-8',
        network: 'mvc',
      });
      return { pinId: normalizeText(write.pinId) || null };
    }
    : undefined;

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
    signerForSlug,
    ...(sendPrivateMessage ? { sendPrivateMessage } : {}),
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
      if (
        error instanceof GroupTaskServiceError
        || error instanceof GroupTaskStoreError
        || error instanceof GroupTaskStaffingError
      ) {
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
      // Chair-identity gate (IDBots CHAIR_IDENTITY_CONFIRM_REQUIRED parity):
      // while the engine drives a non-terminal task, the chair's voice belongs
      // to the engine. A manual post AS the chair must opt in explicitly.
      const asSlug = normalizeText(body.asSlug) || undefined;
      if (asSlug && readBool(body.confirmChair) !== true) {
        try {
          const task = await getGroupTaskRecord(ctx, ref.chair, ref.taskId);
          if (asSlug === task.chairSlug && task.dispatchPausedAt == null
            && task.status !== 'done' && task.status !== 'cancelled') {
            return commandFailed(
              'CHAIR_IDENTITY_CONFIRM_REQUIRED',
              `Manual chair sends conflict with the engine while task ${ref.taskId} is ${task.status}. `
              + 'Post as the owner or a worker, or pass confirm_chair to override.',
            );
          }
        } catch {
          // Task lookup failed: fall through to the normal send path error.
        }
      }
      return run(() => postGroupTaskMessage(ctx, ref.chair, ref.taskId, {
        asSlug,
        asOwner: readBool(body.asOwner) ?? false,
        content: normalizeText(body.content),
        replyPin: normalizeText(body.replyPin) || undefined,
        mention: readStringArray(body.mention),
      }));
    },

    supervise: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      const action = normalizeText(body.action);
      return run(() => superviseGroupTask(ctx, ref.chair, ref.taskId, {
        action: action as 'nudge' | 'flag' | 'pause' | 'resume',
        memberSlug: normalizeText(body.memberSlug) || normalizeText(body.slug) || undefined,
        globalMetaId: normalizeText(body.globalMetaId) || undefined,
        note: normalizeText(body.note) || undefined,
      }));
    },

    deleteDeliverable: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      const deliverableId = readInt(body.deliverableId);
      if (deliverableId == null || deliverableId <= 0) {
        return commandFailed('missing_deliverable', 'deliverableId must be a positive integer');
      }
      return run(() => deleteGroupTaskDeliverableEntry(ctx, ref.chair, ref.taskId, deliverableId));
    },

    relayDrain: async (body) => {
      const chair = normalizeText(body.chair) || normalizeText(body.chairSlug) || undefined;
      return run(async () => ({ relayed: await drainGroupTaskRelay(ctx, chair) }));
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

    invite: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      const globalMetaId = normalizeText(body.globalMetaId);
      if (!globalMetaId) return commandFailed('invitee_required', 'globalMetaId is required');
      return run(async () => {
        const invite = await inviteRemoteMember(ctx, ref.chair, ref.taskId, {
          globalMetaId,
          name: normalizeText(body.name) || null,
          requiredSkills: readStringArray(body.requiredSkills),
          allowReinvite: readBool(body.allowReinvite) ?? false,
        });
        return { invite };
      });
    },

    invites: async (body) => {
      const ref = readTaskRef(body);
      if (isFailure(ref)) return ref;
      return run(async () => ({ invites: await listOpenTeamInvites(ctx, ref.chair, ref.taskId) }));
    },

    collabs: async () => run(async () => listOpenTeamCollabs(ctx)),

    collabMessages: async (body) => {
      const slug = normalizeText(body.slug);
      const groupId = normalizeText(body.groupId);
      if (!slug || !groupId) {
        return commandFailed('collab_ref_required', 'slug and groupId are required');
      }
      return run(() => listOpenTeamCollabMessages(ctx, slug, groupId, {
        limit: readInt(body.limit) ?? undefined,
      }));
    },

    health: async () => run(async () => {
      const daemonPaths = resolveMetabotDaemonPaths(input.systemHomeDir);
      return getGroupTaskHealth(ctx, {
        readSimplemsgListenerEnabled: async () => {
          // The listener switch is per-profile config; the daemon serves its
          // own home, so read that home's config (mirrors the daemon boot
          // read in cli/runtime). Unknown/unreadable defaults to enabled.
          if (!input.daemonHomeDir) return true;
          try {
            const config = await createConfigStore(input.daemonHomeDir).read();
            return config.a2a.simplemsgListenerEnabled;
          } catch {
            return true;
          }
        },
        engineLogFile: resolveGroupTaskEngineLogPath(daemonPaths.logsRoot),
      });
    }),

    staffingPropose: async (body) => run(async () => {
      const title = normalizeText(body.title);
      const goal = normalizeText(body.goal);
      if (!title || !goal) {
        throw new GroupTaskServiceError('missing_input', 'title and goal are required');
      }
      let plan: unknown = body.plan;
      const planRaw = normalizeText(body.planJson);
      if (!plan && planRaw) {
        plan = JSON.parse(planRaw) as unknown;
      }
      return proposeGroupTaskStaffing(ctx, {
        chairSlug: normalizeText(body.chairSlug) || undefined,
        title,
        goal,
        acceptanceCriteria: normalizeText(body.acceptanceCriteria) || null,
        plan,
        triggeringWish: normalizeText(body.triggeringWish) || undefined,
        sourceSessionId: normalizeText(body.sourceSessionId) || null,
        language: normalizeText(body.language) === 'en' ? 'en' : 'zh',
      });
    }),

    staffingList: async (body) => run(async () => {
      const proposals = await listStaffingProposals(ctx, normalizeText(body.chairSlug) || undefined);
      return { proposals };
    }),

    staffingDecide: async (body) => run(async () => {
      const chair = normalizeText(body.chairSlug);
      if (!chair) throw new GroupTaskServiceError('missing_chair', 'chairSlug is required');
      const proposalId = readInt(body.proposalId);
      if (!proposalId || proposalId <= 0) {
        throw new GroupTaskServiceError('missing_proposal', 'proposalId must be a positive integer');
      }
      const decision = normalizeText(body.decision);
      if (decision !== 'confirm' && decision !== 'revise' && decision !== 'skip') {
        throw new GroupTaskServiceError('invalid_decision', "decision must be 'confirm', 'revise', or 'skip'");
      }
      return {
        proposal: await recordStaffingOwnerDecision(ctx, chair, proposalId, decision),
      };
    }),

    staffingCreate: async (body) => run(async () => {
      const proposalId = readInt(body.proposalId);
      if (!proposalId || proposalId <= 0) {
        throw new GroupTaskServiceError('missing_proposal', 'proposalId must be a positive integer');
      }
      const sessionMessages = Array.isArray(body.sessionMessages)
        ? body.sessionMessages
        : undefined;
      const created = await createGroupTaskFromProposal(ctx, {
        chairSlug: normalizeText(body.chairSlug) || undefined,
        proposalId,
        sessionMessages,
      });
      return {
        chairSlug: created.chairSlug,
        task: created.task.task,
        taskId: created.task.task.id,
        pendingRemoteSeats: created.pendingRemoteSeats,
        decision: created.decision,
      };
    }),

    staffingSearch: async (body) => run(async () => {
      const profiles = await listMetabotProfiles(input.systemHomeDir).catch(() => [] as MetabotProfileFull[]);
      const twin = profiles.find((profile) => profile.botType === 'twin') ?? null;
      const impressionStore = twin
        ? createImpressionStore(resolveMetabotPaths(twin.homeDir))
        : null;
      const twinGmid = twin?.globalMetaId?.trim() || null;
      return searchGroupTaskSeatCandidates({
        listLocalWorkers: async () => profiles
          .filter((profile) => profile.botType !== 'twin')
          .map((profile) => ({
            slug: profile.slug,
            name: profile.name,
            enabled: true,
            botType: profile.botType ?? null,
            globalMetaId: profile.globalMetaId || null,
            bio: profile.bio || null,
            role: profile.role || null,
            goal: profile.goal || null,
            chatSkills: Array.isArray(profile.allowChatSkills) ? profile.allowChatSkills : [],
          })),
        getObserverGlobalMetaId: async () => twinGmid,
        ...(impressionStore && twinGmid
          ? {
            // Structural view: capabilityTags/collaborationFacts land with the
            // Round L sedimentation; absent fields read as verdict 'unknown'.
            getImpressionSnapshot: async (observer: string, subject: string) =>
              (await impressionStore.getSnapshot(observer, subject)) as SeatImpressionSnapshot | null,
          }
          : {}),
      }, {
        query: normalizeText(body.query) || undefined,
        roleHint: normalizeText(body.seat) || normalizeText(body.roleHint) || undefined,
        domainLabel: normalizeText(body.domainLabel) || undefined,
        skills: readStringArray(body.skills),
        limit: readInt(body.limit) ?? undefined,
      });
    }),
  };
}
