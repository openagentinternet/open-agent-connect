"use strict";
/**
 * Daemon-side owner-identity handler group: the /api/user/* verbs. Thin ports
 * of the `metabot user *` CLI command handlers (src/cli/commands/user.ts)
 * onto core/owner/ownerIdentity — the owner identity is machine-wide (no
 * `from` actor selection), and the mnemonic only ever leaves the daemon
 * through the guarded reveal verb, exactly like the CLI reveal.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUserDaemonHandlers = createUserDaemonHandlers;
const commandResult_1 = require("../core/contracts/commandResult");
const ownerIdentity_1 = require("../core/owner/ownerIdentity");
const ownerSigner_1 = require("../core/owner/ownerSigner");
const ownerOnboarding_1 = require("../core/owner/ownerOnboarding");
const ownerProfilePublish_1 = require("../core/owner/ownerProfilePublish");
const avatarChainWrite_1 = require("../core/identity/avatarChainWrite");
function ownerFailure(error) {
    if (error instanceof ownerIdentity_1.OwnerIdentityError) {
        return (0, commandResult_1.commandFailed)(error.code, error.message);
    }
    return (0, commandResult_1.commandFailed)('owner_identity_failed', error instanceof Error ? error.message : String(error));
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function createUserDaemonHandlers(input) {
    const systemHomeDir = input.systemHomeDir;
    return {
        who: async () => {
            const record = await (0, ownerIdentity_1.readOwnerIdentity)(systemHomeDir);
            return (0, commandResult_1.commandSuccess)({ identity: record ? (0, ownerIdentity_1.toOwnerIdentityPublic)(record) : null });
        },
        create: async (rawInput) => {
            try {
                const record = await (0, ownerIdentity_1.createOwnerIdentity)(systemHomeDir, { name: normalizeText(rawInput?.name) });
                // An explicit create re-arms onboarding (clears any opt-out tombstone)
                // so the account/grant steps still converge on the next daemon start.
                await (0, ownerOnboarding_1.resetOwnerOnboardingAfterManualIdentity)(systemHomeDir).catch(() => undefined);
                // The mnemonic is shown exactly once, same as the CLI create/import.
                return (0, commandResult_1.commandSuccess)({ identity: (0, ownerIdentity_1.toOwnerIdentityPublic)(record), mnemonic: record.mnemonic });
            }
            catch (error) {
                return ownerFailure(error);
            }
        },
        import: async (rawInput) => {
            const mnemonic = normalizeText(rawInput?.mnemonic);
            if (!mnemonic) {
                return (0, commandResult_1.commandFailed)('missing_mnemonic', 'mnemonic is required.');
            }
            const derivationPath = normalizeText(rawInput?.path) || undefined;
            try {
                const record = await (0, ownerIdentity_1.importOwnerIdentity)(systemHomeDir, {
                    name: normalizeText(rawInput?.name),
                    mnemonic,
                    ...(derivationPath ? { path: derivationPath } : {}),
                });
                await (0, ownerOnboarding_1.resetOwnerOnboardingAfterManualIdentity)(systemHomeDir).catch(() => undefined);
                return (0, commandResult_1.commandSuccess)({ identity: (0, ownerIdentity_1.toOwnerIdentityPublic)(record), mnemonic: record.mnemonic });
            }
            catch (error) {
                return ownerFailure(error);
            }
        },
        rename: async (rawInput) => {
            const name = normalizeText(rawInput?.name);
            if (!name) {
                return (0, commandResult_1.commandFailed)('missing_name', 'name is required.');
            }
            try {
                const record = await (0, ownerIdentity_1.renameOwnerIdentity)(systemHomeDir, name);
                return (0, commandResult_1.commandSuccess)({ identity: (0, ownerIdentity_1.toOwnerIdentityPublic)(record) });
            }
            catch (error) {
                return ownerFailure(error);
            }
        },
        /**
         * Name/avatar profile save with on-chain publish, chain-first like the
         * Bot profile update: the changed /info/name + /info/avatar pins are
         * written by the owner signer first, and only then does the local record
         * update — so a saved profile always matches the chain.
         */
        update: async (rawInput) => {
            const current = await (0, ownerIdentity_1.readOwnerIdentity)(systemHomeDir);
            if (!current) {
                return (0, commandResult_1.commandFailed)('owner_missing', 'No owner identity exists on this machine.');
            }
            const hasName = typeof rawInput?.name === 'string';
            const hasAvatar = typeof rawInput?.avatarDataUrl === 'string';
            const name = hasName ? normalizeText(rawInput.name) : undefined;
            if (hasName && !name) {
                return (0, commandResult_1.commandFailed)('missing_name', 'name is required.');
            }
            const avatarDataUrl = hasAvatar ? rawInput.avatarDataUrl.trim() : undefined;
            if (avatarDataUrl !== undefined) {
                const validation = (0, avatarChainWrite_1.validateAvatarDataUrl)(avatarDataUrl);
                if (!validation.valid) {
                    return (0, commandResult_1.commandFailed)('invalid_avatar', validation.error ?? 'Invalid avatar.');
                }
            }
            if (name === undefined && avatarDataUrl === undefined) {
                return (0, commandResult_1.commandFailed)('missing_update', 'name or avatarDataUrl is required.');
            }
            const nameChanged = name !== undefined && name !== current.name;
            const avatarChanged = avatarDataUrl !== undefined && avatarDataUrl !== (current.avatarDataUrl ?? '');
            if (!nameChanged && !avatarChanged) {
                return (0, commandResult_1.commandSuccess)({
                    identity: (0, ownerIdentity_1.toOwnerIdentityPublic)(current),
                    chainWrites: [],
                    chainSync: { ok: true },
                });
            }
            const signer = input.createSigner
                ? input.createSigner(current)
                : input.adapters
                    ? (0, ownerSigner_1.createOwnerSigner)({
                        systemHomeDir,
                        owner: current,
                        adapters: input.adapters,
                        ...(input.resolveSponsorWritePin ? { resolveSponsorWritePin: input.resolveSponsorWritePin } : {}),
                    })
                    : null;
            if (!signer) {
                return (0, commandResult_1.commandFailed)('chain_unavailable', 'Chain publish is not configured in this daemon.');
            }
            const chainRequests = (0, ownerProfilePublish_1.buildOwnerProfileChainWrites)({
                ...(nameChanged && name !== undefined ? { name } : {}),
                ...(avatarChanged && avatarDataUrl !== undefined ? { avatarDataUrl } : {}),
            });
            let chainWrites = [];
            try {
                const writeOptions = input.chainWriteDelayMs !== undefined ? { delayMs: input.chainWriteDelayMs } : {};
                chainWrites = await (0, ownerProfilePublish_1.writeOwnerProfileChainRequests)(signer, chainRequests, writeOptions);
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('chain_sync_failed', `Chain sync failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            try {
                const record = await (0, ownerIdentity_1.updateOwnerIdentityProfile)(systemHomeDir, {
                    ...(nameChanged && name !== undefined ? { name } : {}),
                    ...(avatarChanged && avatarDataUrl !== undefined ? { avatarDataUrl } : {}),
                });
                return (0, commandResult_1.commandSuccess)({
                    identity: (0, ownerIdentity_1.toOwnerIdentityPublic)(record),
                    chainWrites,
                    chainSync: { ok: true },
                });
            }
            catch (error) {
                return ownerFailure(error);
            }
        },
        reveal: async () => {
            try {
                const mnemonic = await (0, ownerIdentity_1.revealOwnerMnemonic)(systemHomeDir);
                return (0, commandResult_1.commandSuccess)({ mnemonic });
            }
            catch (error) {
                return ownerFailure(error);
            }
        },
        delete: async () => {
            try {
                await (0, ownerIdentity_1.deleteOwnerIdentity)(systemHomeDir);
                // Tombstone the onboarding state: auto-provisioning must never
                // resurrect an identity the user deliberately removed.
                await (0, ownerOnboarding_1.markOwnerOnboardingOptedOut)(systemHomeDir);
                return (0, commandResult_1.commandSuccess)({ deleted: true });
            }
            catch (error) {
                return ownerFailure(error);
            }
        },
        getOnboarding: async () => {
            try {
                return (0, commandResult_1.commandSuccess)(await (0, ownerOnboarding_1.readOwnerOnboardingStatus)(systemHomeDir));
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('owner_onboarding_read_failed', error instanceof Error ? error.message : String(error));
            }
        },
        runOnboarding: async () => {
            const runner = input.ownerOnboardingRunner
                ?? (input.trafficAccountService
                    ? (0, ownerOnboarding_1.createOwnerOnboardingRunner)({ systemHomeDir, trafficAccountService: input.trafficAccountService })
                    : null);
            if (!runner) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Owner onboarding runner is not configured.');
            }
            try {
                const onboarding = await runner.run();
                return (0, commandResult_1.commandSuccess)({ onboarding });
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('owner_onboarding_failed', error instanceof Error ? error.message : String(error));
            }
        },
    };
}
