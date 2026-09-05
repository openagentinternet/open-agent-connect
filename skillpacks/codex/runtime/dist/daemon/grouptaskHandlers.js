"use strict";
/**
 * Group Task daemon handler group: builds the production
 * GroupTaskServiceContext (profiles from the manager registry, per-profile
 * mnemonic signers, owner identity signer) and exposes the HTTP handler verbs
 * the /api/grouptask/* routes dispatch to. All business rules live in
 * core/grouptask/service; this file is wiring + input normalization only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGroupTaskServiceContext = createGroupTaskServiceContext;
exports.createGroupTaskDaemonHandlers = createGroupTaskDaemonHandlers;
const commandResult_1 = require("../core/contracts/commandResult");
const service_1 = require("../core/grouptask/service");
const openteamService_1 = require("../core/grouptask/openteamService");
const health_1 = require("../core/grouptask/health");
const engineLog_1 = require("../core/grouptask/engineLog");
const staffingService_1 = require("../core/grouptask/staffingService");
const candidateSearch_1 = require("../core/grouptask/candidateSearch");
const staffing_1 = require("../core/grouptask/staffing");
const impressionStore_1 = require("../core/memory/impressionStore");
const configStore_1 = require("../core/config/configStore");
const store_1 = require("../core/grouptask/store");
const privateChat_1 = require("../core/chat/privateChat");
const metabotProfileManager_1 = require("../core/bot/metabotProfileManager");
const ownerIdentity_1 = require("../core/owner/ownerIdentity");
const localMnemonicSigner_1 = require("../core/signing/localMnemonicSigner");
const runtimeStateStore_1 = require("../core/state/runtimeStateStore");
const paths_1 = require("../core/state/paths");
// ---------------------------------------------------------------------------
// Input normalization helpers
// ---------------------------------------------------------------------------
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readInt(value) {
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (typeof numeric !== 'number' || !Number.isFinite(numeric))
        return undefined;
    return Math.trunc(numeric);
}
function readBool(value) {
    if (typeof value === 'boolean')
        return value;
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    return undefined;
}
function readStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
}
function readTaskRef(input) {
    const chair = normalizeText(input.chair) || normalizeText(input.chairSlug);
    if (!chair)
        return (0, commandResult_1.commandFailed)('chair_required', 'chair (chair profile slug) is required');
    const taskId = readInt(input.taskId);
    if (taskId == null || taskId <= 0) {
        return (0, commandResult_1.commandFailed)('task_id_required', 'taskId must be a positive integer');
    }
    return { chair, taskId };
}
function isFailure(value) {
    return 'ok' in value;
}
// ---------------------------------------------------------------------------
// Production service context
// ---------------------------------------------------------------------------
function toProfileRef(profile, metaId) {
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
async function readProfileMetaId(homeDir) {
    try {
        const state = await (0, runtimeStateStore_1.createRuntimeStateStore)(homeDir).readState();
        return normalizeText(state.identity?.metaId) || null;
    }
    catch {
        return null;
    }
}
/**
 * Read-only SecretStore view over the owner identity record; the signer only
 * ever calls readIdentitySecrets. The owner home (~/.metabot/owner) is NOT a
 * profile home, so resolveMetabotPaths rejects it — the paths stub below
 * exists solely to satisfy the SecretStore interface.
 */
function createOwnerSecretStore(systemHomeDir, owner) {
    const paths = {
        identitySecretsPath: (0, ownerIdentity_1.resolveOwnerIdfilePath)(systemHomeDir),
    };
    return {
        paths,
        ensureLayout: async () => paths,
        readIdentitySecrets: async () => ({ mnemonic: owner.mnemonic, path: owner.path }),
        writeIdentitySecrets: async () => {
            throw new Error('Owner identity secrets are read-only in the group task context.');
        },
        deleteIdentitySecrets: async () => {
            throw new Error('Owner identity secrets are read-only in the group task context.');
        },
    };
}
/** Build the production GroupTaskServiceContext (exported for engine reuse). */
function createGroupTaskServiceContext(input) {
    let ownerSigner = null;
    const signerForSlug = async (slug) => {
        const profile = await (0, metabotProfileManager_1.getMetabotProfile)(input.systemHomeDir, slug);
        if (!profile) {
            throw new service_1.GroupTaskServiceError('profile_not_found', `MetaBot profile not found: ${slug}`);
        }
        return input.createSignerForProfileHome(profile.homeDir);
    };
    const resolvePeerKey = input.resolvePeerChatPublicKey;
    const sendPrivateMessage = resolvePeerKey
        ? async (message) => {
            const signer = await signerForSlug(message.fromSlug);
            const identity = await signer.getPrivateChatIdentity();
            const peerChatPublicKey = await resolvePeerKey(message.toGlobalMetaId);
            if (!peerChatPublicKey) {
                throw new service_1.GroupTaskServiceError('peer_chat_key_unavailable', `No chat public key found for ${message.toGlobalMetaId}`);
            }
            const sent = (0, privateChat_1.sendPrivateChat)({
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
            const profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir).catch(() => []);
            return Promise.all(profiles.map(async (profile) => toProfileRef(profile, await readProfileMetaId(profile.homeDir))));
        },
        getProfile: async (slug) => {
            const profile = await (0, metabotProfileManager_1.getMetabotProfile)(input.systemHomeDir, slug).catch(() => null);
            if (!profile)
                return null;
            return toProfileRef(profile, await readProfileMetaId(profile.homeDir));
        },
        signerForSlug,
        ...(sendPrivateMessage ? { sendPrivateMessage } : {}),
        ownerIdentity: async () => {
            const owner = await (0, ownerIdentity_1.readOwnerIdentity)(input.systemHomeDir);
            if (!owner)
                return null;
            ownerSigner ??= (0, localMnemonicSigner_1.createLocalMnemonicSigner)({
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
function createGroupTaskDaemonHandlers(input) {
    const ctx = input.context ?? createGroupTaskServiceContext(input);
    async function run(work) {
        try {
            return (0, commandResult_1.commandSuccess)(await work());
        }
        catch (error) {
            if (error instanceof service_1.GroupTaskServiceError
                || error instanceof store_1.GroupTaskStoreError
                || error instanceof staffing_1.GroupTaskStaffingError) {
                return (0, commandResult_1.commandFailed)(error.code, error.message);
            }
            return (0, commandResult_1.commandFailed)('grouptask_failed', error instanceof Error ? error.message : String(error));
        }
    }
    return {
        create: async (body) => run(async () => {
            const workerSlugs = readStringArray(body.workerSlugs);
            const created = await (0, service_1.createGroupTask)(ctx, {
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
            const tab = tabRaw === 'active' || tabRaw === 'done' || tabRaw === 'cancelled' || tabRaw === 'all'
                ? tabRaw
                : 'all';
            const tasks = await (0, service_1.listGroupTaskSummaries)(ctx, {
                tab,
                includeArchived: readBool(body.includeArchived) ?? false,
            });
            return { tasks };
        }),
        detail: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            return run(async () => {
                const view = normalizeText(body.view) === 'summary' ? 'summary' : 'full';
                return (0, service_1.getGroupTaskDetail)(ctx, ref.chair, ref.taskId, {
                    view,
                    sync: readBool(body.sync) ?? true,
                });
            });
        },
        messages: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            return run(() => (0, service_1.listGroupTaskMessages)(ctx, ref.chair, ref.taskId, {
                limit: readInt(body.limit),
                beforeIndex: readInt(body.beforeIndex),
                sync: readBool(body.sync) ?? true,
            }));
        },
        postMessage: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            // Chair-identity gate (IDBots CHAIR_IDENTITY_CONFIRM_REQUIRED parity):
            // while the engine drives a non-terminal task, the chair's voice belongs
            // to the engine. A manual post AS the chair must opt in explicitly.
            const asSlug = normalizeText(body.asSlug) || undefined;
            if (asSlug && readBool(body.confirmChair) !== true) {
                try {
                    const task = await (0, service_1.getGroupTaskRecord)(ctx, ref.chair, ref.taskId);
                    if (asSlug === task.chairSlug && task.dispatchPausedAt == null
                        && task.status !== 'done' && task.status !== 'cancelled') {
                        return (0, commandResult_1.commandFailed)('CHAIR_IDENTITY_CONFIRM_REQUIRED', `Manual chair sends conflict with the engine while task ${ref.taskId} is ${task.status}. `
                            + 'Post as the owner or a worker, or pass confirm_chair to override.');
                    }
                }
                catch {
                    // Task lookup failed: fall through to the normal send path error.
                }
            }
            return run(() => (0, service_1.postGroupTaskMessage)(ctx, ref.chair, ref.taskId, {
                asSlug,
                asOwner: readBool(body.asOwner) ?? false,
                content: normalizeText(body.content),
                replyPin: normalizeText(body.replyPin) || undefined,
                mention: readStringArray(body.mention),
            }));
        },
        supervise: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            const action = normalizeText(body.action);
            return run(() => (0, service_1.superviseGroupTask)(ctx, ref.chair, ref.taskId, {
                action: action,
                memberSlug: normalizeText(body.memberSlug) || normalizeText(body.slug) || undefined,
                globalMetaId: normalizeText(body.globalMetaId) || undefined,
                note: normalizeText(body.note) || undefined,
            }));
        },
        deleteDeliverable: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            const deliverableId = readInt(body.deliverableId);
            if (deliverableId == null || deliverableId <= 0) {
                return (0, commandResult_1.commandFailed)('missing_deliverable', 'deliverableId must be a positive integer');
            }
            return run(() => (0, service_1.deleteGroupTaskDeliverableEntry)(ctx, ref.chair, ref.taskId, deliverableId));
        },
        relayDrain: async (body) => {
            const chair = normalizeText(body.chair) || normalizeText(body.chairSlug) || undefined;
            return run(async () => ({ relayed: await (0, service_1.drainGroupTaskRelay)(ctx, chair) }));
        },
        workClaim: async (body) => {
            const workerSlug = normalizeText(body.workerSlug) || normalizeText(body.worker) || undefined;
            return run(async () => ({ request: await (0, service_1.claimGroupTaskWork)(ctx, workerSlug) }));
        },
        workSubmit: async (body) => {
            const requestId = readInt(body.requestId);
            if (requestId == null || requestId <= 0) {
                return (0, commandResult_1.commandFailed)('missing_request', 'requestId must be a positive integer');
            }
            return run(() => (0, service_1.submitGroupTaskWork)(ctx, {
                requestId,
                handoff: normalizeText(body.handoff) || undefined,
                error: normalizeText(body.error) || undefined,
                dshSessionId: normalizeText(body.dshSessionId) || undefined,
            }));
        },
        close: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            const outcome = normalizeText(body.outcome) || normalizeText(body.status);
            if (outcome !== 'done' && outcome !== 'cancelled') {
                return (0, commandResult_1.commandFailed)('invalid_outcome', "outcome must be 'done' or 'cancelled'");
            }
            return run(() => (0, service_1.closeGroupTask)(ctx, ref.chair, ref.taskId, {
                status: outcome,
                reason: normalizeText(body.reason) || undefined,
                rating: readInt(body.rating),
                ratingComment: normalizeText(body.ratingComment) || undefined,
                actor: { kind: 'owner' },
            }));
        },
        reopen: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            return run(() => (0, service_1.reopenGroupTask)(ctx, ref.chair, ref.taskId, {
                actor: { kind: 'owner' },
                reason: normalizeText(body.reason) || undefined,
            }));
        },
        kickMember: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            return run(() => (0, service_1.kickGroupTaskMember)(ctx, ref.chair, ref.taskId, {
                slug: normalizeText(body.slug) || undefined,
                globalMetaId: normalizeText(body.globalMetaId) || undefined,
                reason: normalizeText(body.reason) || undefined,
            }));
        },
        setMemberStatus: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            const status = normalizeText(body.status);
            return run(() => (0, service_1.setGroupTaskMemberStatus)(ctx, ref.chair, ref.taskId, {
                slug: normalizeText(body.slug) || null,
                globalMetaId: normalizeText(body.globalMetaId) || null,
                status,
            }));
        },
        rename: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            const displayName = typeof body.displayName === 'string' ? body.displayName : '';
            return run(() => (0, service_1.renameGroupTask)(ctx, ref.chair, ref.taskId, displayName));
        },
        setPinned: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            const pinned = readBool(body.pinned);
            if (pinned == null)
                return (0, commandResult_1.commandFailed)('pinned_required', 'pinned must be true or false');
            return run(() => (0, service_1.setGroupTaskPinned)(ctx, ref.chair, ref.taskId, pinned));
        },
        setArchived: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            const archived = readBool(body.archived);
            if (archived == null)
                return (0, commandResult_1.commandFailed)('archived_required', 'archived must be true or false');
            return run(() => (archived
                ? (0, service_1.archiveGroupTask)(ctx, ref.chair, ref.taskId)
                : (0, service_1.unarchiveGroupTask)(ctx, ref.chair, ref.taskId)));
        },
        invite: async (body) => {
            const ref = readTaskRef(body);
            if (isFailure(ref))
                return ref;
            const globalMetaId = normalizeText(body.globalMetaId);
            if (!globalMetaId)
                return (0, commandResult_1.commandFailed)('invitee_required', 'globalMetaId is required');
            return run(async () => {
                const invite = await (0, openteamService_1.inviteRemoteMember)(ctx, ref.chair, ref.taskId, {
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
            if (isFailure(ref))
                return ref;
            return run(async () => ({ invites: await (0, openteamService_1.listOpenTeamInvites)(ctx, ref.chair, ref.taskId) }));
        },
        collabs: async () => run(async () => (0, openteamService_1.listOpenTeamCollabs)(ctx)),
        collabMessages: async (body) => {
            const slug = normalizeText(body.slug);
            const groupId = normalizeText(body.groupId);
            if (!slug || !groupId) {
                return (0, commandResult_1.commandFailed)('collab_ref_required', 'slug and groupId are required');
            }
            return run(() => (0, openteamService_1.listOpenTeamCollabMessages)(ctx, slug, groupId, {
                limit: readInt(body.limit) ?? undefined,
            }));
        },
        health: async () => run(async () => {
            const daemonPaths = (0, paths_1.resolveMetabotDaemonPaths)(input.systemHomeDir);
            return (0, health_1.getGroupTaskHealth)(ctx, {
                readSimplemsgListenerEnabled: async () => {
                    // The listener switch is per-profile config; the daemon serves its
                    // own home, so read that home's config (mirrors the daemon boot
                    // read in cli/runtime). Unknown/unreadable defaults to enabled.
                    if (!input.daemonHomeDir)
                        return true;
                    try {
                        const config = await (0, configStore_1.createConfigStore)(input.daemonHomeDir).read();
                        return config.a2a.simplemsgListenerEnabled;
                    }
                    catch {
                        return true;
                    }
                },
                engineLogFile: (0, engineLog_1.resolveGroupTaskEngineLogPath)(daemonPaths.logsRoot),
            });
        }),
        staffingPropose: async (body) => run(async () => {
            const title = normalizeText(body.title);
            const goal = normalizeText(body.goal);
            if (!title || !goal) {
                throw new service_1.GroupTaskServiceError('missing_input', 'title and goal are required');
            }
            let plan = body.plan;
            const planRaw = normalizeText(body.planJson);
            if (!plan && planRaw) {
                plan = JSON.parse(planRaw);
            }
            return (0, staffingService_1.proposeGroupTaskStaffing)(ctx, {
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
            const proposals = await (0, staffingService_1.listStaffingProposals)(ctx, normalizeText(body.chairSlug) || undefined);
            return { proposals };
        }),
        staffingDecide: async (body) => run(async () => {
            const chair = normalizeText(body.chairSlug);
            if (!chair)
                throw new service_1.GroupTaskServiceError('missing_chair', 'chairSlug is required');
            const proposalId = readInt(body.proposalId);
            if (!proposalId || proposalId <= 0) {
                throw new service_1.GroupTaskServiceError('missing_proposal', 'proposalId must be a positive integer');
            }
            const decision = normalizeText(body.decision);
            if (decision !== 'confirm' && decision !== 'revise' && decision !== 'skip') {
                throw new service_1.GroupTaskServiceError('invalid_decision', "decision must be 'confirm', 'revise', or 'skip'");
            }
            return {
                proposal: await (0, staffingService_1.recordStaffingOwnerDecision)(ctx, chair, proposalId, decision),
            };
        }),
        staffingCreate: async (body) => run(async () => {
            const proposalId = readInt(body.proposalId);
            if (!proposalId || proposalId <= 0) {
                throw new service_1.GroupTaskServiceError('missing_proposal', 'proposalId must be a positive integer');
            }
            const sessionMessages = Array.isArray(body.sessionMessages)
                ? body.sessionMessages
                : undefined;
            const created = await (0, staffingService_1.createGroupTaskFromProposal)(ctx, {
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
            const profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir).catch(() => []);
            const twin = profiles.find((profile) => profile.botType === 'twin') ?? null;
            const impressionStore = twin
                ? (0, impressionStore_1.createImpressionStore)((0, paths_1.resolveMetabotPaths)(twin.homeDir))
                : null;
            const twinGmid = twin?.globalMetaId?.trim() || null;
            return (0, candidateSearch_1.searchGroupTaskSeatCandidates)({
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
                        getImpressionSnapshot: async (observer, subject) => (await impressionStore.getSnapshot(observer, subject)),
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
