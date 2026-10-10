"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrokBotBindingError = exports.GROK_BOT_HOST_ID = void 0;
exports.normalizeGrokBotBinding = normalizeGrokBotBinding;
exports.isGrokBotBindingEmpty = isGrokBotBindingEmpty;
exports.isGrokBotBound = isGrokBotBound;
exports.redactGrokBotBinding = redactGrokBotBinding;
exports.grokBotBindingPathForProfile = grokBotBindingPathForProfile;
exports.readGrokBotBinding = readGrokBotBinding;
exports.writeGrokBotBinding = writeGrokBotBinding;
exports.recordGrokBotWebhookDelivery = recordGrokBotWebhookDelivery;
exports.getGrokBotBindingStatus = getGrokBotBindingStatus;
exports.bindGrokBotAssistant = bindGrokBotAssistant;
exports.configureGrokBotWebhook = configureGrokBotWebhook;
exports.unbindGrokBotAssistant = unbindGrokBotAssistant;
exports.doctorGrokBotBindings = doctorGrokBotBindings;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const identityProfiles_1 = require("../identity/identityProfiles");
const profileNameResolution_1 = require("../identity/profileNameResolution");
const paths_1 = require("../state/paths");
const twinRole_1 = require("../bot/twinRole");
exports.GROK_BOT_HOST_ID = 'grok-bot';
class GrokBotBindingError extends Error {
    code;
    data;
    constructor(code, message, data = {}) {
        super(message);
        this.name = 'GrokBotBindingError';
        this.code = code;
        this.data = data;
    }
}
exports.GrokBotBindingError = GrokBotBindingError;
function normalizeText(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || null;
}
function normalizeIsoTimestamp(value) {
    const normalized = normalizeText(value);
    if (!normalized || Number.isNaN(Date.parse(normalized))) {
        return null;
    }
    return new Date(normalized).toISOString();
}
function normalizeWebhook(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const url = normalizeText(record.url);
    if (!url) {
        return null;
    }
    return {
        url,
        secret: normalizeText(record.secret),
        configuredAt: normalizeIsoTimestamp(record.configuredAt) ?? new Date(0).toISOString(),
    };
}
function normalizeDelivery(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const at = normalizeIsoTimestamp(record.at);
    const status = record.status === 'ok' || record.status === 'failed' ? record.status : null;
    if (!at || !status) {
        return null;
    }
    return {
        at,
        status,
        kind: record.kind === 'llm-task' ? 'llm-task' : 'private-chat',
        error: normalizeText(record.error),
    };
}
function normalizeGrokBotBinding(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    return {
        host: exports.GROK_BOT_HOST_ID,
        assistantId: normalizeText(record.assistantId),
        assistantName: normalizeText(record.assistantName),
        boundAt: normalizeIsoTimestamp(record.boundAt),
        webhook: normalizeWebhook(record.webhook),
        lastWebhookDelivery: normalizeDelivery(record.lastWebhookDelivery),
    };
}
function isGrokBotBindingEmpty(binding) {
    return !binding.assistantId && !binding.assistantName && !binding.webhook && !binding.lastWebhookDelivery;
}
function isGrokBotBound(binding) {
    return Boolean(binding.assistantId);
}
/** Command-result view: the bearer token never leaves the local state file. */
function redactGrokBotBinding(binding) {
    return {
        ...binding,
        webhook: binding.webhook
            ? { url: binding.webhook.url, configuredAt: binding.webhook.configuredAt, secretConfigured: Boolean(binding.webhook.secret) }
            : null,
    };
}
function grokBotBindingPathForProfile(homeDir) {
    return (0, paths_1.resolveMetabotPaths)(homeDir).grokBotBindingPath;
}
async function readGrokBotBinding(filePath) {
    try {
        return normalizeGrokBotBinding(JSON.parse(await node_fs_1.promises.readFile(filePath, 'utf8')));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return normalizeGrokBotBinding(null);
        }
        throw error;
    }
}
async function writeGrokBotBinding(filePath, binding) {
    const next = normalizeGrokBotBinding(binding);
    if (isGrokBotBindingEmpty(next)) {
        try {
            await node_fs_1.promises.unlink(filePath);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
        return;
    }
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, `${JSON.stringify({
        ...next,
        updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
}
async function recordGrokBotWebhookDelivery(filePath, delivery) {
    const current = await readGrokBotBinding(filePath);
    const next = { ...current, lastWebhookDelivery: delivery };
    await writeGrokBotBinding(filePath, next);
    return next;
}
function normalizeWebhookUrl(value) {
    const normalized = value.trim();
    let parsed;
    try {
        parsed = new URL(normalized);
    }
    catch {
        throw new GrokBotBindingError('invalid_argument', `Webhook URL is not a valid URL: ${normalized}`);
    }
    if (parsed.protocol !== 'https:') {
        throw new GrokBotBindingError('invalid_argument', 'Webhook URL must use https://. The Grok Bot routine webhook is a cloud endpoint; plain http would expose the bearer token.');
    }
    return parsed.toString();
}
async function resolveBindingProfile(input) {
    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(input.systemHomeDir);
    if (input.from?.trim()) {
        const resolution = (0, profileNameResolution_1.resolveProfileNameMatch)(input.from, profiles);
        if (resolution.status === 'matched') {
            return resolution.match;
        }
        throw new GrokBotBindingError(resolution.status === 'ambiguous' ? 'identity_profile_ambiguous' : 'identity_profile_not_found', resolution.message, resolution.status === 'ambiguous'
            ? { from: input.from, candidates: resolution.candidates.map((profile) => profile.slug) }
            : { from: input.from });
    }
    const twinHomeDir = await (0, twinRole_1.resolveTwinHomeDir)(input.systemHomeDir);
    const twinProfile = twinHomeDir
        ? profiles.find((profile) => node_path_1.default.resolve(profile.homeDir) === node_path_1.default.resolve(twinHomeDir))
        : undefined;
    if (!twinProfile) {
        throw new GrokBotBindingError('active_identity_missing', 'No Twin Bot is available. Pass --from <bot-slug> or create a Bot first.');
    }
    return twinProfile;
}
function grokBotBindingHint(binding, slug) {
    if (!binding.assistantId) {
        return null;
    }
    if (!binding.webhook) {
        return `Webhook not configured: on-chain private chat cannot reach this assistant's dialog and surf runs partial. After the user approves, record the routine webhook with: metabot host binding webhook --from ${slug} --url <https-url> [--secret <bearer-token>].`;
    }
    if (binding.lastWebhookDelivery?.status === 'failed') {
        return `Last webhook delivery failed (${binding.lastWebhookDelivery.error ?? 'unknown error'}). Check the routine webhook URL/token and re-record it with metabot host binding webhook --from ${slug} --url <https-url>.`;
    }
    return null;
}
async function getGrokBotBindingStatus(input) {
    const profile = await resolveBindingProfile(input);
    const binding = await readGrokBotBinding(grokBotBindingPathForProfile(profile.homeDir));
    const redacted = redactGrokBotBinding(binding);
    return {
        host: exports.GROK_BOT_HOST_ID,
        profile: {
            name: profile.name,
            slug: profile.slug,
            homeDir: profile.homeDir,
            globalMetaId: profile.globalMetaId,
        },
        bound: isGrokBotBound(binding),
        binding: redacted,
        hint: grokBotBindingHint(redacted, profile.slug),
    };
}
async function bindGrokBotAssistant(input) {
    const assistantId = normalizeText(input.assistantId);
    if (!assistantId) {
        throw new GrokBotBindingError('invalid_argument', 'An assistant id is required to bind a Grok Bot assistant.');
    }
    const profile = await resolveBindingProfile(input);
    const filePath = grokBotBindingPathForProfile(profile.homeDir);
    const current = await readGrokBotBinding(filePath);
    // One Grok Bot assistant maps to exactly one OAC profile: refuse to point a
    // second profile at an assistant id another profile already owns.
    if (!input.force && current.assistantId !== assistantId) {
        const profiles = await (0, identityProfiles_1.listIdentityProfiles)(input.systemHomeDir);
        for (const candidate of profiles) {
            if (candidate.slug === profile.slug) {
                continue;
            }
            const other = await readGrokBotBinding(grokBotBindingPathForProfile(candidate.homeDir));
            if (other.assistantId === assistantId) {
                throw new GrokBotBindingError('grok_bot_binding_conflict', `Grok Bot assistant ${assistantId} is already bound to profile ${candidate.slug}. Stop and confirm with the user instead of sharing one assistant across two identities; pass --force only when the user explicitly asks to move the binding.`, { assistantId, ownerSlug: candidate.slug, requestedSlug: profile.slug });
            }
        }
    }
    const assistantName = normalizeText(input.assistantName) ?? current.assistantName;
    const unchanged = current.assistantId === assistantId && current.assistantName === assistantName;
    if (!unchanged) {
        await writeGrokBotBinding(filePath, {
            ...current,
            assistantId,
            assistantName,
            boundAt: current.boundAt ?? new Date().toISOString(),
        });
    }
    const status = await getGrokBotBindingStatus({ systemHomeDir: input.systemHomeDir, from: profile.slug });
    return {
        ...status,
        action: unchanged ? 'unchanged' : (current.assistantId ? 'updated' : 'created'),
    };
}
async function configureGrokBotWebhook(input) {
    const profile = await resolveBindingProfile(input);
    const filePath = grokBotBindingPathForProfile(profile.homeDir);
    const current = await readGrokBotBinding(filePath);
    if (input.clear) {
        await writeGrokBotBinding(filePath, { ...current, webhook: null, lastWebhookDelivery: null });
        return getGrokBotBindingStatus({ systemHomeDir: input.systemHomeDir, from: profile.slug });
    }
    const url = typeof input.url === 'string' ? normalizeWebhookUrl(input.url) : '';
    if (!url) {
        throw new GrokBotBindingError('invalid_argument', 'Pass --url <https-webhook-url> or --clear.');
    }
    await writeGrokBotBinding(filePath, {
        ...current,
        webhook: {
            url,
            secret: normalizeText(input.secret) ?? current.webhook?.secret ?? null,
            configuredAt: new Date().toISOString(),
        },
        lastWebhookDelivery: null,
    });
    return getGrokBotBindingStatus({ systemHomeDir: input.systemHomeDir, from: profile.slug });
}
async function unbindGrokBotAssistant(input) {
    const profile = await resolveBindingProfile(input);
    const filePath = grokBotBindingPathForProfile(profile.homeDir);
    const current = await readGrokBotBinding(filePath);
    const removed = !isGrokBotBindingEmpty(current);
    await writeGrokBotBinding(filePath, normalizeGrokBotBinding(null));
    const status = await getGrokBotBindingStatus({ systemHomeDir: input.systemHomeDir, from: profile.slug });
    return { ...status, removed };
}
async function doctorGrokBotBindings(input) {
    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(input.systemHomeDir);
    const entries = [];
    const ownerByAssistantId = new Map();
    for (const profile of profiles) {
        const binding = await readGrokBotBinding(grokBotBindingPathForProfile(profile.homeDir));
        const issues = [];
        if (binding.assistantId) {
            const owner = ownerByAssistantId.get(binding.assistantId);
            if (owner) {
                issues.push(`assistant id is also bound to profile ${owner}; one assistant must map to exactly one profile`);
            }
            else {
                ownerByAssistantId.set(binding.assistantId, profile.slug);
            }
            if (!binding.assistantName) {
                issues.push('assistant name is missing; re-run the bind step with --assistant-name');
            }
        }
        let webhookState = 'not_configured';
        if (binding.webhook) {
            webhookState = binding.lastWebhookDelivery?.status === 'ok'
                ? 'ok'
                : binding.lastWebhookDelivery?.status === 'failed'
                    ? 'failed'
                    : 'pending';
            if (binding.lastWebhookDelivery?.status === 'failed') {
                issues.push(`last webhook delivery failed: ${binding.lastWebhookDelivery.error ?? 'unknown error'}`);
            }
        }
        else if (binding.assistantId) {
            issues.push('webhook is not configured; on-chain private chat cannot reach this assistant');
        }
        entries.push({
            name: profile.name,
            slug: profile.slug,
            globalMetaId: profile.globalMetaId,
            bound: isGrokBotBound(binding),
            assistantId: binding.assistantId,
            assistantName: binding.assistantName,
            webhookConfigured: Boolean(binding.webhook),
            webhookState,
            lastWebhookDelivery: binding.lastWebhookDelivery,
            issues,
        });
    }
    return { host: exports.GROK_BOT_HOST_ID, entries };
}
