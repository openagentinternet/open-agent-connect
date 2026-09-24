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
                return (0, commandResult_1.commandSuccess)({ deleted: true });
            }
            catch (error) {
                return ownerFailure(error);
            }
        },
    };
}
