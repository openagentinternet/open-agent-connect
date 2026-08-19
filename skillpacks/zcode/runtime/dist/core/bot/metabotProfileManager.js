"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAvatarDataUrl = void 0;
exports.readTextFile = readTextFile;
exports.runtimeAvailabilityTier = runtimeAvailabilityTier;
exports.selectRuntimeForProvider = selectRuntimeForProvider;
exports.selectBestRuntimeForProvider = selectBestRuntimeForProvider;
exports.selectDefaultMetabotProviders = selectDefaultMetabotProviders;
exports.listMetabotProfiles = listMetabotProfiles;
exports.getMetabotProfile = getMetabotProfile;
exports.createMetabotProfile = createMetabotProfile;
exports.buildMetabotProfileDraftFromIdentity = buildMetabotProfileDraftFromIdentity;
exports.createMetabotProfileFromIdentity = createMetabotProfileFromIdentity;
exports.getMetabotWalletInfo = getMetabotWalletInfo;
exports.getMetabotMnemonicBackup = getMetabotMnemonicBackup;
exports.deleteMetabotProfile = deleteMetabotProfile;
exports.updateMetabotProfile = updateMetabotProfile;
exports.buildMetabotInfoPublishTargets = buildMetabotInfoPublishTargets;
exports.recordMetabotInfoPublishResults = recordMetabotInfoPublishResults;
exports.syncMetabotInfoToChain = syncMetabotInfoToChain;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const identityProfiles_1 = require("../identity/identityProfiles");
const profileNameResolution_1 = require("../identity/profileNameResolution");
const profileWorkspace_1 = require("../identity/profileWorkspace");
const paths_1 = require("../state/paths");
const llmBindingStore_1 = require("../llm/llmBindingStore");
const llmRuntimeStore_1 = require("../llm/llmRuntimeStore");
const fileSecretStore_1 = require("../secrets/fileSecretStore");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const metabotHomepage_1 = require("./metabotHomepage");
const llmTypes_1 = require("../llm/llmTypes");
const chatSkillPolicy_1 = require("../services/chatSkillPolicy");
const avatarChainWrite_1 = require("../identity/avatarChainWrite");
const profilePublishState_1 = require("./profilePublishState");
const metabotPersona_1 = require("./metabotPersona");
const dshLlm_1 = require("./dshLlm");
const CHAIN_SYNC_DELAY_MS = 3_000;
const PROFILE_INFO_FIELDS = new Set(['bio', 'role', 'soul', 'goal', 'primaryProvider', 'fallbackProvider', 'allowChatSkills', 'homepage']);
var avatarChainWrite_2 = require("../identity/avatarChainWrite");
Object.defineProperty(exports, "validateAvatarDataUrl", { enumerable: true, get: function () { return avatarChainWrite_2.validateAvatarDataUrl; } });
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveAvatarPath(homeDir) {
    return node_path_1.default.join(node_path_1.default.resolve(homeDir), 'avatar.txt');
}
function isSafeLocalFileStem(value) {
    if (!value || value === '.' || value === '..')
        return false;
    if (value.includes('/') || value.includes('\\'))
        return false;
    return node_path_1.default.basename(value) === value;
}
async function sleep(ms) {
    if (ms <= 0)
        return;
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
async function writeTextFile(filePath, content) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, `${content.trim()}\n`, 'utf8');
}
async function removeFileIfExists(filePath) {
    try {
        await node_fs_1.promises.unlink(filePath);
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}
async function readTextFile(filePath) {
    try {
        return (await node_fs_1.promises.readFile(filePath, 'utf8')).trim();
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return '';
        }
        throw error;
    }
}
async function readChatSkillPolicy(filePath) {
    try {
        const parsed = JSON.parse(await node_fs_1.promises.readFile(filePath, 'utf8'));
        return (0, chatSkillPolicy_1.normalizeAllowChatSkills)(parsed?.allowChatSkills);
    }
    catch {
        return [];
    }
}
async function writeChatSkillPolicy(filePath, allowChatSkills) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, `${JSON.stringify({
        allowChatSkills,
        updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
}
function dshLlmPatchFromInput(input) {
    const patch = {};
    if (input.dshLlmProvider !== undefined)
        patch.dshLlmProvider = input.dshLlmProvider;
    if (input.dshLlmModel !== undefined)
        patch.dshLlmModel = input.dshLlmModel;
    if (input.dshLlmFallbackProvider !== undefined)
        patch.dshLlmFallbackProvider = input.dshLlmFallbackProvider;
    if (input.dshLlmFallbackModel !== undefined)
        patch.dshLlmFallbackModel = input.dshLlmFallbackModel;
    return patch;
}
function hasDshLlmPatch(patch) {
    return Object.prototype.hasOwnProperty.call(patch, 'dshLlmProvider')
        || Object.prototype.hasOwnProperty.call(patch, 'dshLlmModel')
        || Object.prototype.hasOwnProperty.call(patch, 'dshLlmFallbackProvider')
        || Object.prototype.hasOwnProperty.call(patch, 'dshLlmFallbackModel');
}
function validateProvider(value) {
    if (value === null)
        return null;
    const normalized = normalizeText(value);
    if (!normalized)
        return null;
    if (!(0, llmTypes_1.isLlmProvider)(normalized) || normalized === 'custom') {
        throw new Error(`Unsupported LLM provider: ${normalized}`);
    }
    return normalized;
}
function runtimeHealthRank(runtime) {
    if (runtime.health === 'healthy')
        return 2;
    if (runtime.health === 'degraded')
        return 1;
    return 0;
}
function runtimeActivityMs(runtime) {
    return Math.max(Date.parse(runtime.lastSeenAt) || 0, Date.parse(runtime.updatedAt) || 0, Date.parse(runtime.createdAt) || 0);
}
function compareRuntimePreference(left, right) {
    const healthDelta = runtimeHealthRank(right) - runtimeHealthRank(left);
    if (healthDelta !== 0)
        return healthDelta;
    const activityDelta = runtimeActivityMs(right) - runtimeActivityMs(left);
    if (activityDelta !== 0)
        return activityDelta;
    return left.id.localeCompare(right.id);
}
function compareRuntimeActivityPreference(left, right) {
    const activityDelta = runtimeActivityMs(right) - runtimeActivityMs(left);
    if (activityDelta !== 0)
        return activityDelta;
    const healthDelta = runtimeHealthRank(right) - runtimeHealthRank(left);
    if (healthDelta !== 0)
        return healthDelta;
    return left.id.localeCompare(right.id);
}
// Availability tiers for SYSTEM default selection only (spec R1). Lower is
// more likely usable. Explicit provider requests and the message-path
// resolver keep their healthy-only gates; never reuse this there.
function runtimeAvailabilityTier(runtime) {
    if (runtime.health === 'healthy')
        return 0;
    if (runtime.health === 'detected' && runtime.authState === 'authenticated')
        return 1;
    if (runtime.health === 'detected')
        return 2;
    if (runtime.health === 'degraded')
        return 3;
    return 4; // unavailable
}
function compareRuntimeAvailabilityPreference(left, right) {
    const tierDelta = runtimeAvailabilityTier(left) - runtimeAvailabilityTier(right);
    if (tierDelta !== 0)
        return tierDelta;
    return compareRuntimeActivityPreference(left, right);
}
function selectRuntimeForProvider(runtimes, provider) {
    const candidates = runtimes.filter((runtime) => (runtime.provider === provider && runtime.health === 'healthy')).sort(compareRuntimePreference);
    const runtime = candidates[0];
    if (!runtime) {
        throw new Error(`No available runtime found for provider: ${provider}`);
    }
    return runtime;
}
// Best-tier runtime for a provider across ALL availability tiers (spec R1.6);
// used for system-selected binding rows, which are valid on non-healthy
// runtimes. Returns null when the provider has no candidate at all.
function selectBestRuntimeForProvider(runtimes, provider) {
    if (provider === 'custom')
        return null;
    const candidates = runtimes.filter((runtime) => (runtime.provider !== 'custom' && runtime.provider === provider)).sort(compareRuntimeAvailabilityPreference);
    return candidates[0] ?? null;
}
function selectDefaultMetabotProviders(input) {
    const availableRuntimes = input.runtimes
        .filter((runtime) => runtime.provider !== 'custom')
        .sort(compareRuntimeAvailabilityPreference);
    const availableProviderRows = availableRuntimes.filter((runtime, index, rows) => (rows.findIndex((candidate) => candidate.provider === runtime.provider) === index));
    const availableProviders = new Set(availableProviderRows.map((runtime) => runtime.provider));
    const preferredProvider = input.preferredProvider && input.preferredProvider !== 'custom'
        ? input.preferredProvider
        : null;
    let primaryProvider = input.primaryProvider;
    if (primaryProvider === undefined) {
        primaryProvider = preferredProvider && availableProviders.has(preferredProvider)
            ? preferredProvider
            : availableProviderRows[0]?.provider;
    }
    let fallbackProvider = input.fallbackProvider;
    if (fallbackProvider === undefined) {
        fallbackProvider = availableProviderRows.find((runtime) => runtime.provider !== primaryProvider)?.provider;
    }
    return {
        primaryProvider,
        fallbackProvider,
    };
}
async function resolveCreateProviderSelection(input) {
    const runtimeState = await (0, llmRuntimeStore_1.createLlmRuntimeStore)((0, paths_1.resolveMetabotPaths)(input.homeDir)).read();
    return selectDefaultMetabotProviders({
        runtimes: runtimeState.runtimes,
        preferredProvider: input.preferredProvider,
        primaryProvider: input.primaryProvider,
        fallbackProvider: input.fallbackProvider,
    });
}
function buildBindingId(slug, runtimeId, role) {
    const safeRuntime = runtimeId.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return `lb_${slug}_${safeRuntime}_${role}`;
}
function buildProviderBinding(input) {
    const createdAt = input.existing?.createdAt ?? input.now;
    return {
        id: input.existing?.id ?? buildBindingId(input.slug, input.runtime.id, input.role),
        metaBotSlug: input.slug,
        llmRuntimeId: input.runtime.id,
        role: input.role,
        priority: 0,
        enabled: true,
        lastUsedAt: input.existing?.lastUsedAt,
        createdAt,
        updatedAt: input.now,
    };
}
function sortRoleBindings(bindings) {
    return [...bindings].sort((left, right) => {
        if (left.priority !== right.priority) {
            return left.priority - right.priority;
        }
        if (left.updatedAt !== right.updatedAt) {
            return right.updatedAt.localeCompare(left.updatedAt);
        }
        return left.id.localeCompare(right.id);
    });
}
function selectVisibleRoleBinding(bindings) {
    return sortRoleBindings(bindings.filter((binding) => binding.enabled)).at(0)
        ?? sortRoleBindings(bindings).at(0);
}
async function readProfileProviderBindings(profile) {
    const paths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
    const runtimeState = await (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths).read();
    const bindingState = await (0, llmBindingStore_1.createLlmBindingStore)(paths).read();
    const runtimeById = new Map(runtimeState.runtimes.map((runtime) => [runtime.id, runtime]));
    const providerForRole = (role) => {
        const binding = selectVisibleRoleBinding(bindingState.bindings.filter((entry) => (entry.metaBotSlug === profile.slug && entry.role === role && entry.enabled)));
        if (!binding)
            return null;
        return runtimeById.get(binding.llmRuntimeId)?.provider ?? null;
    };
    return {
        primaryProvider: providerForRole('primary'),
        fallbackProvider: providerForRole('fallback'),
    };
}
async function buildMetabotProfileFull(profile) {
    const paths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
    const [bio, role, soul, goal, avatarDataUrl, providerBindings, allowChatSkills, homepage, dshLlm] = await Promise.all([
        readTextFile(paths.bioMdPath),
        readTextFile(paths.roleMdPath),
        readTextFile(paths.soulMdPath),
        readTextFile(paths.goalMdPath),
        readTextFile(resolveAvatarPath(profile.homeDir)),
        readProfileProviderBindings(profile),
        readChatSkillPolicy(paths.chatSkillPolicyPath),
        (0, metabotHomepage_1.readMetabotHomepage)(paths.homepageStatePath),
        (0, dshLlm_1.readDshLlmBinding)(paths.dshLlmPath),
    ]);
    const persona = (0, metabotPersona_1.normalizePublicMetabotPersona)({ role, soul, goal });
    return {
        ...profile,
        bio,
        role: persona.role,
        soul: persona.soul,
        goal: persona.goal,
        ...(avatarDataUrl ? { avatarDataUrl } : {}),
        primaryProvider: providerBindings.primaryProvider,
        fallbackProvider: providerBindings.fallbackProvider,
        allowChatSkills,
        ...(homepage ? { homepage } : {}),
        dshLlmProvider: dshLlm.dshLlmProvider ?? null,
        dshLlmModel: dshLlm.dshLlmModel ?? null,
        dshLlmFallbackProvider: dshLlm.dshLlmFallbackProvider ?? null,
        dshLlmFallbackModel: dshLlm.dshLlmFallbackModel ?? null,
    };
}
async function listMetabotProfiles(systemHomeDir) {
    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
    const fullProfiles = await Promise.all(profiles.map((profile) => buildMetabotProfileFull(profile)));
    return fullProfiles.sort((left, right) => {
        if (right.updatedAt !== left.updatedAt) {
            return right.updatedAt - left.updatedAt;
        }
        return left.name.localeCompare(right.name);
    });
}
async function getMetabotProfile(systemHomeDir, slug) {
    const normalizedSlug = normalizeText(slug);
    if (!normalizedSlug)
        return null;
    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
    const profile = profiles.find((entry) => entry.slug === normalizedSlug);
    return profile ? buildMetabotProfileFull(profile) : null;
}
async function createMetabotProfile(systemHomeDir, input) {
    const name = normalizeText(input.name);
    if (!name) {
        throw new Error('MetaBot name is required.');
    }
    const avatar = input.avatarDataUrl !== undefined ? normalizeText(input.avatarDataUrl) : undefined;
    if (avatar !== undefined) {
        const validation = (0, avatarChainWrite_1.validateAvatarDataUrl)(avatar);
        if (!validation.valid) {
            throw new Error(validation.error);
        }
    }
    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
    const resolvedHome = (0, profileWorkspace_1.resolveIdentityCreateProfileHome)({
        systemHomeDir,
        requestedName: name,
        profiles,
    });
    if (resolvedHome.status !== 'resolved') {
        throw new Error(resolvedHome.message);
    }
    const primaryProvider = input.primaryProvider === undefined ? undefined : validateProvider(input.primaryProvider);
    const fallbackProvider = input.fallbackProvider === undefined ? undefined : validateProvider(input.fallbackProvider);
    const providerSelection = await resolveCreateProviderSelection({
        homeDir: resolvedHome.homeDir,
        primaryProvider,
        fallbackProvider,
    });
    await (0, profileWorkspace_1.ensureProfileWorkspace)({
        homeDir: resolvedHome.homeDir,
        name,
    });
    const paths = (0, paths_1.resolveMetabotPaths)(resolvedHome.homeDir);
    const persona = (0, metabotPersona_1.normalizePublicMetabotPersona)({
        role: input.role,
        soul: input.soul,
        goal: input.goal,
    });
    await Promise.all([
        writeTextFile(paths.bioMdPath, normalizeText(input.bio)),
        writeTextFile(paths.roleMdPath, persona.role),
        writeTextFile(paths.soulMdPath, persona.soul),
        writeTextFile(paths.goalMdPath, persona.goal),
    ]);
    if (avatar) {
        await writeTextFile(resolveAvatarPath(resolvedHome.homeDir), avatar);
    }
    const dshLlmPatch = dshLlmPatchFromInput(input);
    if (hasDshLlmPatch(dshLlmPatch)) {
        await (0, dshLlm_1.writeDshLlmBinding)(paths.dshLlmPath, dshLlmPatch);
    }
    const profile = await (0, identityProfiles_1.upsertIdentityProfile)({
        systemHomeDir,
        name,
        homeDir: resolvedHome.homeDir,
    });
    const fullProfile = await buildMetabotProfileFull(profile);
    const systemDefaultRoles = new Set();
    if (input.primaryProvider === undefined && providerSelection.primaryProvider)
        systemDefaultRoles.add('primary');
    if (input.fallbackProvider === undefined && providerSelection.fallbackProvider)
        systemDefaultRoles.add('fallback');
    const writeProviderBindings = await buildProviderBindingWrite({
        profile: fullProfile,
        primaryProvider: providerSelection.primaryProvider,
        fallbackProvider: providerSelection.fallbackProvider,
        systemDefaultRoles,
    });
    if (writeProviderBindings) {
        await writeProviderBindings();
    }
    return buildMetabotProfileFull(profile);
}
function buildMetabotProfileDraftFromIdentity(input) {
    const name = normalizeText(input.name);
    const homeDir = node_path_1.default.resolve(normalizeText(input.homeDir));
    const globalMetaId = normalizeText(input.globalMetaId);
    const mvcAddress = normalizeText(input.mvcAddress);
    if (!name) {
        throw new Error('MetaBot name is required.');
    }
    if (!homeDir || !globalMetaId || !mvcAddress) {
        throw new Error('A chained MetaBot profile requires homeDir, globalMetaId, and mvcAddress.');
    }
    const avatar = input.avatarDataUrl !== undefined ? normalizeText(input.avatarDataUrl) : undefined;
    if (avatar !== undefined) {
        const validation = (0, avatarChainWrite_1.validateAvatarDataUrl)(avatar);
        if (!validation.valid) {
            throw new Error(validation.error);
        }
    }
    const slug = node_path_1.default.basename(homeDir);
    return {
        name,
        slug,
        aliases: [slug],
        homeDir,
        globalMetaId,
        mvcAddress,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        bio: normalizeText(input.bio),
        ...(0, metabotPersona_1.normalizePublicMetabotPersona)({
            role: input.role,
            soul: input.soul,
            goal: input.goal,
        }),
        ...(avatar ? { avatarDataUrl: avatar } : {}),
        primaryProvider: input.primaryProvider === undefined ? null : validateProvider(input.primaryProvider),
        fallbackProvider: input.fallbackProvider === undefined ? null : validateProvider(input.fallbackProvider),
        allowChatSkills: input.allowChatSkills === undefined ? [] : (0, chatSkillPolicy_1.normalizeAllowChatSkills)(input.allowChatSkills),
        dshLlmProvider: input.dshLlmProvider === undefined ? null : input.dshLlmProvider,
        dshLlmModel: input.dshLlmModel === undefined ? null : input.dshLlmModel,
        dshLlmFallbackProvider: input.dshLlmFallbackProvider === undefined ? null : input.dshLlmFallbackProvider,
        dshLlmFallbackModel: input.dshLlmFallbackModel === undefined ? null : input.dshLlmFallbackModel,
    };
}
async function createMetabotProfileFromIdentity(systemHomeDir, input) {
    const providerSelection = await resolveCreateProviderSelection({
        homeDir: input.homeDir,
        primaryProvider: input.primaryProvider === undefined ? undefined : validateProvider(input.primaryProvider),
        fallbackProvider: input.fallbackProvider === undefined ? undefined : validateProvider(input.fallbackProvider),
    });
    const draft = buildMetabotProfileDraftFromIdentity({
        ...input,
        primaryProvider: providerSelection.primaryProvider,
        fallbackProvider: providerSelection.fallbackProvider,
    });
    await (0, profileWorkspace_1.ensureProfileWorkspace)({
        homeDir: draft.homeDir,
        name: draft.name,
    });
    const paths = (0, paths_1.resolveMetabotPaths)(draft.homeDir);
    await Promise.all([
        writeTextFile(paths.bioMdPath, draft.bio),
        writeTextFile(paths.roleMdPath, draft.role),
        writeTextFile(paths.soulMdPath, draft.soul),
        writeTextFile(paths.goalMdPath, draft.goal),
    ]);
    if (draft.avatarDataUrl) {
        await writeTextFile(resolveAvatarPath(draft.homeDir), draft.avatarDataUrl);
    }
    const dshLlmPatch = dshLlmPatchFromInput(input);
    if (hasDshLlmPatch(dshLlmPatch)) {
        await (0, dshLlm_1.writeDshLlmBinding)(paths.dshLlmPath, dshLlmPatch);
    }
    const profile = await (0, identityProfiles_1.upsertIdentityProfile)({
        systemHomeDir,
        name: draft.name,
        homeDir: draft.homeDir,
        globalMetaId: draft.globalMetaId,
        mvcAddress: draft.mvcAddress,
    });
    const fullProfile = await buildMetabotProfileFull(profile);
    const systemDefaultRoles = new Set(input.systemDefaultProviderRoles ?? []);
    if (!input.systemDefaultProviderRoles) {
        if (input.primaryProvider === undefined && providerSelection.primaryProvider)
            systemDefaultRoles.add('primary');
        if (input.fallbackProvider === undefined && providerSelection.fallbackProvider)
            systemDefaultRoles.add('fallback');
    }
    const writeProviderBindings = await buildProviderBindingWrite({
        profile: fullProfile,
        primaryProvider: draft.primaryProvider,
        fallbackProvider: draft.fallbackProvider,
        systemDefaultRoles,
    });
    if (writeProviderBindings) {
        await writeProviderBindings();
    }
    return buildMetabotProfileFull(profile);
}
async function getMetabotWalletInfo(systemHomeDir, slug) {
    const profile = await getMetabotProfile(systemHomeDir, slug);
    if (!profile) {
        throw new Error(`MetaBot profile not found: ${normalizeText(slug) || '<missing>'}`);
    }
    const secretStore = (0, fileSecretStore_1.createFileSecretStore)(profile.homeDir);
    const [secrets, runtimeState] = await Promise.all([
        secretStore.readIdentitySecrets(),
        (0, runtimeStateStore_1.createRuntimeStateStore)(profile.homeDir).readState(),
    ]);
    const identity = runtimeState.identity;
    return {
        slug: profile.slug,
        name: profile.name,
        addresses: {
            btc: normalizeText(secrets?.addresses?.btc) || normalizeText(identity?.addresses?.btc),
            mvc: normalizeText(secrets?.addresses?.mvc) || normalizeText(identity?.addresses?.mvc) || normalizeText(secrets?.mvcAddress) || normalizeText(identity?.mvcAddress) || profile.mvcAddress,
            doge: normalizeText(secrets?.addresses?.doge) || normalizeText(identity?.addresses?.doge),
            opcat: normalizeText(secrets?.addresses?.opcat) || normalizeText(identity?.addresses?.opcat),
        },
    };
}
async function getMetabotMnemonicBackup(systemHomeDir, slug) {
    const profile = await getMetabotProfile(systemHomeDir, slug);
    if (!profile) {
        throw new Error(`MetaBot profile not found: ${normalizeText(slug) || '<missing>'}`);
    }
    const secrets = await (0, fileSecretStore_1.createFileSecretStore)(profile.homeDir).readIdentitySecrets();
    const mnemonic = normalizeText(secrets?.mnemonic);
    if (!mnemonic) {
        throw new Error('Mnemonic backup is unavailable for this MetaBot.');
    }
    return {
        slug: profile.slug,
        name: profile.name,
        words: mnemonic.split(/\s+/).filter(Boolean),
    };
}
async function deleteLlmExecutorSessionsForSlug(profile) {
    const paths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
    const removed = [];
    let entries;
    try {
        entries = await node_fs_1.promises.readdir(paths.llmExecutorSessionsRoot);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return removed;
        }
        throw error;
    }
    await Promise.all(entries.map(async (entry) => {
        if (!entry.endsWith('.json'))
            return;
        const filePath = node_path_1.default.join(paths.llmExecutorSessionsRoot, entry);
        let parsed = null;
        try {
            parsed = JSON.parse(await node_fs_1.promises.readFile(filePath, 'utf8'));
        }
        catch {
            return;
        }
        if (normalizeText(parsed.metaBotSlug) !== profile.slug)
            return;
        const entrySessionId = entry.replace(/\.json$/, '');
        const parsedSessionId = normalizeText(parsed.sessionId);
        const sessionId = isSafeLocalFileStem(parsedSessionId)
            ? parsedSessionId
            : entrySessionId;
        await node_fs_1.promises.rm(filePath, { force: true });
        if (isSafeLocalFileStem(sessionId)) {
            await node_fs_1.promises.rm(node_path_1.default.join(paths.llmExecutorTranscriptsRoot, `${sessionId}.log`), { force: true });
        }
        removed.push(sessionId);
    }));
    return removed.sort();
}
async function deleteMetabotProfile(systemHomeDir, slug) {
    const profile = await getMetabotProfile(systemHomeDir, slug);
    if (!profile) {
        throw new Error(`MetaBot profile not found: ${normalizeText(slug) || '<missing>'}`);
    }
    const removedExecutorSessions = await deleteLlmExecutorSessionsForSlug(profile);
    await node_fs_1.promises.rm(profile.homeDir, { recursive: true, force: true });
    const deleted = await (0, identityProfiles_1.deleteIdentityProfile)({
        systemHomeDir,
        slug: profile.slug,
    });
    if (!deleted) {
        throw new Error(`MetaBot profile not found: ${profile.slug}`);
    }
    return {
        profile: deleted,
        removedExecutorSessions,
    };
}
async function buildProviderBindingWrite(input) {
    const updates = [];
    if (input.primaryProvider !== undefined) {
        updates.push({ role: 'primary', provider: input.primaryProvider });
    }
    if (input.fallbackProvider !== undefined) {
        updates.push({ role: 'fallback', provider: input.fallbackProvider });
    }
    if (!updates.length)
        return null;
    const paths = (0, paths_1.resolveMetabotPaths)(input.profile.homeDir);
    const runtimeStore = (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths);
    const bindingStore = (0, llmBindingStore_1.createLlmBindingStore)(paths);
    const [runtimeState, bindingState] = await Promise.all([
        runtimeStore.read(),
        bindingStore.read(),
    ]);
    const now = new Date().toISOString();
    let nextBindings = [...bindingState.bindings];
    for (const update of updates) {
        const existing = selectVisibleRoleBinding(nextBindings.filter((binding) => (binding.metaBotSlug === input.profile.slug && binding.role === update.role)));
        if (update.provider === null) {
            if (existing) {
                nextBindings = nextBindings.filter((binding) => binding.id !== existing.id);
            }
            continue;
        }
        const runtime = input.systemDefaultRoles?.has(update.role)
            ? selectBestRuntimeForProvider(runtimeState.runtimes, update.provider)
            : selectRuntimeForProvider(runtimeState.runtimes, update.provider);
        if (!runtime)
            continue; // System-selected role whose candidate vanished: skip the row instead of failing creation.
        const binding = (0, llmTypes_1.normalizeLlmBinding)(buildProviderBinding({
            slug: input.profile.slug,
            runtime,
            role: update.role,
            existing,
            now,
        }));
        if (binding) {
            if (existing) {
                nextBindings = nextBindings.map((entry) => entry.id === existing.id ? binding : entry);
            }
            else {
                nextBindings.push(binding);
            }
        }
    }
    return async () => {
        await bindingStore.write({
            version: bindingState.version + 1,
            bindings: nextBindings,
        });
    };
}
async function updateMetabotProfile(systemHomeDir, slug, input) {
    const current = await getMetabotProfile(systemHomeDir, slug);
    if (!current) {
        throw new Error(`MetaBot profile not found: ${slug}`);
    }
    const paths = (0, paths_1.resolveMetabotPaths)(current.homeDir);
    const name = input.name !== undefined ? normalizeText(input.name) : undefined;
    if (input.name !== undefined && !name) {
        throw new Error('MetaBot name is required.');
    }
    if (name !== undefined && name !== current.name) {
        const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
        const duplicate = (0, profileNameResolution_1.resolveProfileNameConflict)(name, profiles.filter((profile) => profile.slug !== current.slug));
        if (duplicate.status === 'matched') {
            throw new Error(`MetaBot name already exists: ${name}`);
        }
        if (duplicate.status === 'ambiguous') {
            throw new Error(duplicate.message);
        }
    }
    const avatar = input.avatarDataUrl !== undefined ? normalizeText(input.avatarDataUrl) : undefined;
    if (avatar) {
        const validation = (0, avatarChainWrite_1.validateAvatarDataUrl)(avatar);
        if (!validation.valid) {
            throw new Error(validation.error);
        }
    }
    const allowChatSkills = input.allowChatSkills === undefined
        ? undefined
        : (0, chatSkillPolicy_1.normalizeAllowChatSkills)(input.allowChatSkills);
    const homepage = input.homepage === undefined
        ? undefined
        : (0, metabotHomepage_1.normalizeMetabotHomepage)(input.homepage);
    const writeProviderBindings = await buildProviderBindingWrite({
        profile: current,
        primaryProvider: input.primaryProvider === undefined
            ? undefined
            : (() => {
                const provider = validateProvider(input.primaryProvider);
                return provider === (current.primaryProvider ?? null) ? undefined : provider;
            })(),
        fallbackProvider: input.fallbackProvider === undefined
            ? undefined
            : (() => {
                const provider = validateProvider(input.fallbackProvider);
                return provider === (current.fallbackProvider ?? null) ? undefined : provider;
            })(),
    });
    if (name !== undefined && name !== current.name) {
        await (0, identityProfiles_1.upsertIdentityProfile)({
            systemHomeDir,
            name,
            homeDir: current.homeDir,
            globalMetaId: current.globalMetaId,
            mvcAddress: current.mvcAddress,
        });
    }
    if (input.role !== undefined) {
        await writeTextFile(paths.roleMdPath, input.role);
    }
    if (input.bio !== undefined) {
        await writeTextFile(paths.bioMdPath, input.bio);
    }
    if (input.soul !== undefined) {
        await writeTextFile(paths.soulMdPath, input.soul);
    }
    if (input.goal !== undefined) {
        await writeTextFile(paths.goalMdPath, input.goal);
    }
    if (avatar !== undefined) {
        if (!avatar) {
            await removeFileIfExists(resolveAvatarPath(current.homeDir));
        }
        else {
            await writeTextFile(resolveAvatarPath(current.homeDir), avatar);
        }
    }
    if (allowChatSkills !== undefined) {
        await writeChatSkillPolicy(paths.chatSkillPolicyPath, allowChatSkills);
    }
    if (homepage !== undefined) {
        if (homepage === null) {
            await removeFileIfExists(paths.homepageStatePath);
        }
        else {
            await (0, metabotHomepage_1.writeMetabotHomepage)(paths.homepageStatePath, homepage);
        }
    }
    const dshLlmPatch = dshLlmPatchFromInput(input);
    if (hasDshLlmPatch(dshLlmPatch)) {
        const currentDshLlm = await (0, dshLlm_1.readDshLlmBinding)(paths.dshLlmPath);
        await (0, dshLlm_1.writeDshLlmBinding)(paths.dshLlmPath, (0, dshLlm_1.mergeDshLlmBinding)(currentDshLlm, dshLlmPatch));
    }
    if (writeProviderBindings) {
        await writeProviderBindings();
    }
    const updated = await getMetabotProfile(systemHomeDir, current.slug);
    if (!updated) {
        throw new Error(`MetaBot profile not found after update: ${current.slug}`);
    }
    return updated;
}
function textInfoTarget(input) {
    return {
        path: input.path,
        contentType: input.contentType,
        payload: input.payload,
        encoding: 'utf-8',
        operation: 'create',
        skipIfUnpublished: input.skipIfUnpublished,
    };
}
function jsonInfoTarget(input) {
    return textInfoTarget({
        path: input.path,
        contentType: 'application/json',
        payload: typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload),
        skipIfUnpublished: input.skipIfUnpublished,
    });
}
function hasAnyProvider(profile) {
    return Boolean(profile.primaryProvider || profile.fallbackProvider);
}
function hasAnyPersonaValue(profile) {
    const persona = (0, metabotPersona_1.normalizePublicMetabotPersona)(profile);
    return Boolean(persona.role || persona.soul || persona.goal);
}
function normalizePublishTarget(input) {
    const pathValue = normalizeText(input.path);
    const contentType = normalizeText(input.contentType);
    if (!pathValue || !contentType) {
        throw new Error('Profile info publish targets require path and contentType.');
    }
    const encoding = input.encoding === 'binary' || input.encoding === 'base64' ? input.encoding : 'utf-8';
    const payload = Buffer.isBuffer(input.payload)
        ? Buffer.from(input.payload)
        : String(input.payload ?? '');
    return {
        path: pathValue,
        contentType,
        encoding,
        payload,
        operation: input.operation ?? 'create',
        skipIfUnpublished: input.skipIfUnpublished === true,
    };
}
function normalizePublishTargets(targets) {
    const normalizedTargets = targets.map((target) => normalizePublishTarget(target));
    const targetByPath = new Map();
    for (const target of normalizedTargets) {
        targetByPath.set(target.path, target);
    }
    return [...targetByPath.values()];
}
function buildMetabotInfoPublishTargets(profile, fields) {
    const changed = new Set([...fields].map((field) => normalizeText(field)).filter(Boolean));
    const targets = [];
    if (changed.has('name')) {
        targets.push(textInfoTarget({
            path: '/info/name',
            contentType: 'text/plain',
            payload: profile.name,
        }));
    }
    if (changed.has('avatar')) {
        const request = (0, avatarChainWrite_1.buildAvatarChainWriteRequest)({
            operation: 'create',
            avatarDataUrl: profile.avatarDataUrl ?? '',
            network: 'mvc',
        });
        targets.push(normalizePublishTarget({
            path: request.path ?? '/info/avatar',
            contentType: request.contentType ?? 'text/plain',
            payload: request.payload ?? '',
            encoding: request.encoding === 'binary' || request.encoding === 'base64' ? request.encoding : 'utf-8',
            operation: 'create',
        }));
    }
    if (changedFieldsHaveProfileInfo(changed)) {
        const personaChanged = changed.has('persona') || changed.has('role') || changed.has('soul') || changed.has('goal');
        if (changed.has('bio')) {
            targets.push(textInfoTarget({
                path: '/info/bio',
                contentType: 'text/plain',
                payload: profile.bio,
                skipIfUnpublished: !normalizeText(profile.bio),
            }));
        }
        if (personaChanged) {
            const persona = (0, metabotPersona_1.normalizePublicMetabotPersona)(profile);
            if (hasAnyPersonaValue(profile)) {
                targets.push(jsonInfoTarget({
                    path: '/info/persona',
                    payload: persona,
                }));
            }
            else {
                targets.push(jsonInfoTarget({
                    path: '/info/persona',
                    payload: '',
                    skipIfUnpublished: true,
                }));
            }
        }
        if (changed.has('allowChatSkills')) {
            const allowChatSkills = (0, chatSkillPolicy_1.normalizeAllowChatSkills)(profile.allowChatSkills);
            targets.push(jsonInfoTarget({
                path: '/info/chatSkills',
                payload: {
                    allowChatSkills,
                    // Deprecated mirror of allowChatSkills, kept for one release so
                    // older readers that only understand the legacy field keep working.
                    allowPrivateChatSkills: allowChatSkills,
                    allowGroupChatSkills: [],
                },
            }));
        }
        if (changed.has('llm') || changed.has('primaryProvider') || changed.has('fallbackProvider')) {
            targets.push(jsonInfoTarget({
                path: '/info/llm',
                payload: {
                    primaryProvider: profile.primaryProvider ?? null,
                    fallbackProvider: profile.fallbackProvider ?? null,
                },
                skipIfUnpublished: !hasAnyProvider(profile),
            }));
        }
        if (changed.has('homepage')) {
            if (profile.homepage) {
                targets.push(jsonInfoTarget({
                    path: '/info/homepage',
                    payload: (0, metabotHomepage_1.serializeMetabotHomepagePayload)(profile.homepage),
                }));
            }
            else {
                targets.push(jsonInfoTarget({
                    path: '/info/homepage',
                    payload: '',
                }));
            }
        }
    }
    return normalizePublishTargets(targets);
}
function changedFieldsHaveProfileInfo(changed) {
    return [...changed].some((field) => PROFILE_INFO_FIELDS.has(field) || field === 'persona' || field === 'llm');
}
function isPublishTargetList(fieldsOrTargets) {
    return fieldsOrTargets.length > 0 && typeof fieldsOrTargets[0] !== 'string';
}
function resolvePublishTargets(profile, fieldsOrTargets) {
    return isPublishTargetList(fieldsOrTargets)
        ? normalizePublishTargets(fieldsOrTargets)
        : buildMetabotInfoPublishTargets(profile, fieldsOrTargets);
}
async function recordMetabotInfoPublishResults(profile, targets, results) {
    if (targets.length === 0 || results.length === 0) {
        return;
    }
    const targetByPath = new Map(normalizePublishTargets(targets).map((target) => [target.path, target]));
    const publishResults = results
        .map((result) => {
        const target = targetByPath.get(result.path);
        return target ? { target, result } : null;
    })
        .filter((entry) => entry !== null);
    if (publishResults.length === 0) {
        return;
    }
    await (0, profilePublishState_1.createProfilePublishStateStore)(profile.homeDir).update((currentState) => {
        const nextRecords = { ...currentState.records };
        for (const entry of publishResults) {
            nextRecords[entry.target.path] = (0, profilePublishState_1.buildProfilePublishRecord)(entry);
        }
        return {
            version: 1,
            records: nextRecords,
        };
    });
}
async function syncMetabotInfoToChain(signer, profile, fieldsOrTargets, options = {}) {
    const targets = resolvePublishTargets(profile, fieldsOrTargets);
    if (!normalizeText(profile.globalMetaId) || targets.length === 0) {
        return [];
    }
    const delayMs = options.delayMs ?? CHAIN_SYNC_DELAY_MS;
    const infoOperation = 'create';
    const results = [];
    const writtenTargets = [];
    const publishStateStore = (0, profilePublishState_1.createProfilePublishStateStore)(profile.homeDir);
    const publishState = await publishStateStore.read();
    async function writeProfileInfo(target) {
        if (results.length > 0) {
            await sleep(delayMs);
        }
        const result = await signer.writePin({
            operation: target.operation ?? infoOperation,
            path: target.path,
            encryption: '0',
            version: '1.0',
            contentType: target.contentType,
            payload: target.payload,
            encoding: target.encoding,
            network: 'mvc',
        });
        results.push(result);
        writtenTargets.push(target);
    }
    for (const target of targets) {
        const previous = publishState.records[target.path];
        if (target.skipIfUnpublished && !previous) {
            continue;
        }
        const payloadHash = (0, profilePublishState_1.hashProfilePublishPayload)(target);
        if (previous?.payloadHash === payloadHash) {
            continue;
        }
        await writeProfileInfo(target);
    }
    if (!options.deferPublishStateWrite) {
        await recordMetabotInfoPublishResults(profile, writtenTargets, results);
    }
    return results;
}
