"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runUserCommand = runUserCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const ownerIdentity_1 = require("../../core/owner/ownerIdentity");
const homeSelection_1 = require("../../core/state/homeSelection");
const helpers_1 = require("./helpers");
function ownerFailure(error) {
    if (error instanceof ownerIdentity_1.OwnerIdentityError) {
        return (0, commandResult_1.commandFailed)(error.code, error.message);
    }
    return (0, commandResult_1.commandFailed)('owner_identity_failed', error instanceof Error ? error.message : String(error));
}
async function runUserCommand(args, context) {
    const subcommand = args[0];
    const systemHomeDir = (0, homeSelection_1.normalizeSystemHomeDir)(context.env, context.cwd);
    if (subcommand === 'who') {
        const record = await (0, ownerIdentity_1.readOwnerIdentity)(systemHomeDir);
        return (0, commandResult_1.commandSuccess)({ identity: record ? (0, ownerIdentity_1.toOwnerIdentityPublic)(record) : null });
    }
    if (subcommand === 'create') {
        const name = (0, helpers_1.readFlagValue)(args, '--name') ?? '';
        try {
            const record = await (0, ownerIdentity_1.createOwnerIdentity)(systemHomeDir, { name });
            return (0, commandResult_1.commandSuccess)({ identity: (0, ownerIdentity_1.toOwnerIdentityPublic)(record), mnemonic: record.mnemonic });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
    if (subcommand === 'import') {
        const name = (0, helpers_1.readFlagValue)(args, '--name') ?? '';
        const mnemonic = (0, helpers_1.readFlagValue)(args, '--mnemonic');
        if (!mnemonic) {
            return (0, helpers_1.commandMissingFlag)('--mnemonic');
        }
        const derivationPath = (0, helpers_1.readFlagValue)(args, '--path') ?? undefined;
        try {
            const record = await (0, ownerIdentity_1.importOwnerIdentity)(systemHomeDir, { name, mnemonic, path: derivationPath });
            return (0, commandResult_1.commandSuccess)({ identity: (0, ownerIdentity_1.toOwnerIdentityPublic)(record), mnemonic: record.mnemonic });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
    if (subcommand === 'ensure') {
        const name = (0, helpers_1.readFlagValue)(args, '--name') ?? undefined;
        const before = await (0, ownerIdentity_1.readOwnerIdentity)(systemHomeDir);
        try {
            const record = await (0, ownerIdentity_1.ensureOwnerIdentity)(systemHomeDir, { name });
            return (0, commandResult_1.commandSuccess)({ identity: (0, ownerIdentity_1.toOwnerIdentityPublic)(record), created: before === null });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
    if (subcommand === 'rename') {
        const name = (0, helpers_1.readFlagValue)(args, '--name');
        if (!name) {
            return (0, helpers_1.commandMissingFlag)('--name');
        }
        try {
            const record = await (0, ownerIdentity_1.renameOwnerIdentity)(systemHomeDir, name);
            return (0, commandResult_1.commandSuccess)({ identity: (0, ownerIdentity_1.toOwnerIdentityPublic)(record) });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
    if (subcommand === 'reveal') {
        try {
            const mnemonic = await (0, ownerIdentity_1.revealOwnerMnemonic)(systemHomeDir);
            return (0, commandResult_1.commandSuccess)({ mnemonic });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
    if (subcommand === 'delete') {
        await (0, ownerIdentity_1.deleteOwnerIdentity)(systemHomeDir);
        return (0, commandResult_1.commandSuccess)({ deleted: true });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`user ${args.join(' ')}`.trim());
}
