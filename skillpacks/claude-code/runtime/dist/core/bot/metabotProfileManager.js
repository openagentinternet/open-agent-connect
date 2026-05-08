"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTextFile = readTextFile;
exports.validateAvatarDataUrl = validateAvatarDataUrl;
exports.listMetabotProfiles = listMetabotProfiles;
exports.getMetabotProfile = getMetabotProfile;
exports.createMetabotProfile = createMetabotProfile;
exports.buildMetabotProfileDraftFromIdentity = buildMetabotProfileDraftFromIdentity;
exports.createMetabotProfileFromIdentity = createMetabotProfileFromIdentity;
exports.getMetabotWalletInfo = getMetabotWalletInfo;
exports.getMetabotMnemonicBackup = getMetabotMnemonicBackup;
exports.deleteMetabotProfile = deleteMetabotProfile;
exports.updateMetabotProfile = updateMetabotProfile;
exports.syncMetabotInfoToChain = syncMetabotInfoToChain;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const identityProfiles_1 = require("../identity/identityProfiles");
const profileWorkspace_1 = require("../identity/profileWorkspace");
const paths_1 = require("../state/paths");
const llmBindingStore_1 = require("../llm/llmBindingStore");
const llmRuntimeStore_1 = require("../llm/llmRuntimeStore");
const fileSecretStore_1 = require("../secrets/fileSecretStore");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const llmTypes_1 = require("../llm/llmTypes");
const DEFAULT_ROLE = 'I am a helpful AI assistant.';
const DEFAULT_SOUL = 'Friendly and professional.';
const DEFAULT_GOAL = 'Help users accomplish their tasks effectively.';
const MAX_AVATAR_BYTES = 200 * 1024;
const CHAIN_SYNC_DELAY_MS = 3_000;
const BIO_FIELDS = new Set(['role', 'soul', 'goal', 'primaryProvider', 'fallbackProvider']);
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveAvatarPath(homeDir) {
    return node_path_1.default.join(node_path_1.default.resolve(homeDir), 'avatar.txt');
}
function avatarMimeType(dataUrl) {
    const match = dataUrl.match(/^data:([^;,]+);base64,/i);
    return match?.[1]?.toLowerCase() ?? 'image/png';
}
function isSafeLocalFileStem(value) {
    if (!value || value === '.' || value === '..')
        return false;
    if (value.includes('/') || value.includes('\\'))
        return false;
    return node_path_1.default.basename(value) === value;
}
function estimateDataUrlBytes(dataUrl) {
    const commaIndex = dataUrl.indexOf(',');
    const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
    return Math.ceil(base64.length * 0.75);
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
function validateAvatarDataUrl(dataUrl, maxBytes = MAX_AVATAR_BYTES) {
    const normalized = normalizeText(dataUrl);
    if (!normalized) {
        return { valid: true };
    }
    if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(normalized)) {
        return {
            valid: false,
            error: 'Avatar must be a PNG, JPEG, WebP, or GIF data URL.',
        };
    }
    if (estimateDataUrlBytes(normalized) > maxBytes) {
        return {
            valid: false,
            error: `Avatar must be ${maxBytes} bytes or smaller.`,
        };
    }
    return { valid: true };
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
function selectRuntimeForProvider(runtimes, provider) {
    const candidates = runtimes.filter((runtime) => (runtime.provider === provider && runtime.health !== 'unavailable'));
    const runtime = candidates.find((entry) => entry.health === 'healthy') ?? candidates[0];
    if (!runtime) {
        throw new Error(`No available runtime found for provider: ${provider}`);
    }
    return runtime;
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
    const [role, soul, goal, avatarDataUrl, providerBindings] = await Promise.all([
        readTextFile(paths.roleMdPath),
        readTextFile(paths.soulMdPath),
        readTextFile(paths.goalMdPath),
        readTextFile(resolveAvatarPath(profile.homeDir)),
        readProfileProviderBindings(profile),
    ]);
    return {
        ...profile,
        role,
        soul,
        goal,
        ...(avatarDataUrl ? { avatarDataUrl } : {}),
        primaryProvider: providerBindings.primaryProvider,
        fallbackProvider: providerBindings.fallbackProvider,
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
        const validation = validateAvatarDataUrl(avatar);
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
    await (0, profileWorkspace_1.ensureProfileWorkspace)({
        homeDir: resolvedHome.homeDir,
        name,
    });
    const paths = (0, paths_1.resolveMetabotPaths)(resolvedHome.homeDir);
    await Promise.all([
        writeTextFile(paths.roleMdPath, normalizeText(input.role) || DEFAULT_ROLE),
        writeTextFile(paths.soulMdPath, normalizeText(input.soul) || DEFAULT_SOUL),
        writeTextFile(paths.goalMdPath, normalizeText(input.goal) || DEFAULT_GOAL),
    ]);
    if (avatar) {
        await writeTextFile(resolveAvatarPath(resolvedHome.homeDir), avatar);
    }
    const profile = await (0, identityProfiles_1.upsertIdentityProfile)({
        systemHomeDir,
        name,
        homeDir: resolvedHome.homeDir,
    });
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
        const validation = validateAvatarDataUrl(avatar);
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
        role: normalizeText(input.role) || DEFAULT_ROLE,
        soul: normalizeText(input.soul) || DEFAULT_SOUL,
        goal: normalizeText(input.goal) || DEFAULT_GOAL,
        ...(avatar ? { avatarDataUrl: avatar } : {}),
        primaryProvider: input.primaryProvider === undefined ? null : validateProvider(input.primaryProvider),
        fallbackProvider: input.fallbackProvider === undefined ? null : validateProvider(input.fallbackProvider),
    };
}
async function createMetabotProfileFromIdentity(systemHomeDir, input) {
    const draft = buildMetabotProfileDraftFromIdentity(input);
    await (0, profileWorkspace_1.ensureProfileWorkspace)({
        homeDir: draft.homeDir,
        name: draft.name,
    });
    const paths = (0, paths_1.resolveMetabotPaths)(draft.homeDir);
    await Promise.all([
        writeTextFile(paths.roleMdPath, draft.role),
        writeTextFile(paths.soulMdPath, draft.soul),
        writeTextFile(paths.goalMdPath, draft.goal),
    ]);
    if (draft.avatarDataUrl) {
        await writeTextFile(resolveAvatarPath(draft.homeDir), draft.avatarDataUrl);
    }
    const profile = await (0, identityProfiles_1.upsertIdentityProfile)({
        systemHomeDir,
        name: draft.name,
        homeDir: draft.homeDir,
        globalMetaId: draft.globalMetaId,
        mvcAddress: draft.mvcAddress,
    });
    const fullProfile = await buildMetabotProfileFull(profile);
    const writeProviderBindings = await buildProviderBindingWrite({
        profile: fullProfile,
        primaryProvider: input.primaryProvider === undefined ? undefined : draft.primaryProvider ?? null,
        fallbackProvider: input.fallbackProvider === undefined ? undefined : draft.fallbackProvider ?? null,
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
            mvc: normalizeText(secrets?.addresses?.mvc ?? secrets?.mvcAddress) || normalizeText(identity?.addresses?.mvc ?? identity?.mvcAddress) || profile.mvcAddress,
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
        const runtime = selectRuntimeForProvider(runtimeState.runtimes, update.provider);
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
    const avatar = input.avatarDataUrl !== undefined ? normalizeText(input.avatarDataUrl) : undefined;
    if (avatar) {
        const validation = validateAvatarDataUrl(avatar);
        if (!validation.valid) {
            throw new Error(validation.error);
        }
    }
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
    if (writeProviderBindings) {
        await writeProviderBindings();
    }
    const updated = await getMetabotProfile(systemHomeDir, current.slug);
    if (!updated) {
        throw new Error(`MetaBot profile not found after update: ${current.slug}`);
    }
    return updated;
}
async function syncMetabotInfoToChain(signer, profile, changedFields, options = {}) {
    if (!normalizeText(profile.globalMetaId) || changedFields.length === 0) {
        return [];
    }
    const delayMs = options.delayMs ?? CHAIN_SYNC_DELAY_MS;
    const operation = options.operation ?? 'modify';
    const changed = new Set(changedFields);
    const results = [];
    if (changed.has('name')) {
        results.push(await signer.writePin({
            operation,
            path: '/info/name',
            encryption: '0',
            version: '1.0',
            contentType: 'application/json',
            payload: JSON.stringify({ name: profile.name }),
            encoding: 'utf-8',
            network: 'mvc',
        }));
    }
    if (changed.has('avatar')) {
        if (results.length > 0) {
            await sleep(delayMs);
        }
        const avatarPayload = normalizeText(profile.avatarDataUrl);
        results.push(await signer.writePin({
            operation,
            path: '/info/avatar',
            encryption: '0',
            version: '1.0',
            contentType: avatarPayload ? avatarMimeType(avatarPayload) : 'text/plain',
            payload: avatarPayload,
            encoding: 'utf-8',
            network: 'mvc',
        }));
    }
    if (changedFields.some((field) => BIO_FIELDS.has(field))) {
        if (results.length > 0) {
            await sleep(delayMs);
        }
        results.push(await signer.writePin({
            operation,
            path: '/info/bio',
            encryption: '0',
            version: '1.0',
            contentType: 'application/json',
            payload: JSON.stringify({
                role: profile.role,
                soul: profile.soul,
                goal: profile.goal,
                primaryProvider: profile.primaryProvider ?? null,
                fallbackProvider: profile.fallbackProvider ?? null,
            }),
            encoding: 'utf-8',
            network: 'mvc',
        }));
    }
    return results;
}
