"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runUserCommand = runUserCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const ownerIdentity_1 = require("../../core/owner/ownerIdentity");
const ownerOnboarding_1 = require("../../core/owner/ownerOnboarding");
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
            // An explicit create re-arms onboarding (clears any opt-out tombstone).
            await (0, ownerOnboarding_1.resetOwnerOnboardingAfterManualIdentity)(systemHomeDir).catch(() => undefined);
            return (0, commandResult_1.commandSuccess)({ identity: (0, ownerIdentity_1.toOwnerIdentityPublic)(record), mnemonic: record.mnemonic });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
    if (subcommand === 'import') {
        // The mnemonic is a master secret. argv values land in shell history and
        // process listings, so the stdin and request-file channels are the
        // recommended paths; exactly one channel may be provided.
        const nameFlag = (0, helpers_1.readFlagValue)(args, '--name');
        const pathFlag = (0, helpers_1.readFlagValue)(args, '--path');
        const mnemonicFlag = (0, helpers_1.readFlagValue)(args, '--mnemonic');
        const mnemonicFromStdin = (0, helpers_1.hasFlag)(args, '--mnemonic-stdin');
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        const channelCount = [mnemonicFlag !== null, mnemonicFromStdin, requestFile !== null].filter(Boolean).length;
        if (channelCount > 1) {
            return (0, commandResult_1.commandFailed)('conflicting_flags', 'Provide exactly one mnemonic channel: --mnemonic-stdin, --request-file, or --mnemonic.');
        }
        if (channelCount === 0) {
            return (0, commandResult_1.commandFailed)('missing_mnemonic', 'Missing mnemonic. Use --mnemonic-stdin (recommended) or --request-file <json>; --mnemonic <words> also works but lands in shell history.');
        }
        let payload = {};
        if (requestFile) {
            try {
                payload = await (0, helpers_1.readJsonFile)(context, requestFile);
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('invalid_request_file', error instanceof Error ? error.message : String(error));
            }
        }
        let mnemonic;
        if (mnemonicFlag !== null) {
            if (!mnemonicFlag.trim()) {
                return (0, commandResult_1.commandFailed)('missing_mnemonic', 'The --mnemonic value is empty.');
            }
            mnemonic = mnemonicFlag;
        }
        else if (mnemonicFromStdin) {
            mnemonic = (await (0, helpers_1.readStdinText)(context.stdin)).trim();
            if (!mnemonic) {
                return (0, commandResult_1.commandFailed)('missing_mnemonic', 'No mnemonic received on stdin. Pipe or type the BIP39 words and end with EOF (Ctrl-D).');
            }
        }
        else {
            mnemonic = typeof payload.mnemonic === 'string' ? payload.mnemonic.trim() : '';
            if (!mnemonic) {
                return (0, commandResult_1.commandFailed)('invalid_request_file', 'Request file must include a non-empty "mnemonic".');
            }
        }
        const name = nameFlag ?? (typeof payload.name === 'string' ? payload.name : '');
        const derivationPath = pathFlag
            ?? (typeof payload.path === 'string' && payload.path.trim() ? payload.path.trim() : undefined);
        try {
            const record = await (0, ownerIdentity_1.importOwnerIdentity)(systemHomeDir, { name, mnemonic, path: derivationPath });
            await (0, ownerOnboarding_1.resetOwnerOnboardingAfterManualIdentity)(systemHomeDir).catch(() => undefined);
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
            if (before === null) {
                await (0, ownerOnboarding_1.resetOwnerOnboardingAfterManualIdentity)(systemHomeDir).catch(() => undefined);
            }
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
    // Name/avatar profile save with on-chain publish. The write happens in the
    // daemon (it owns the signer and the traffic sponsor hook); the CLI parses
    // --name and/or --request-file ({ name?, avatarDataUrl? }) and forwards.
    if (subcommand === 'update') {
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        const nameFlag = (0, helpers_1.readFlagValue)(args, '--name');
        let input = {};
        if (requestFile) {
            try {
                input = await (0, helpers_1.readJsonFile)(context, requestFile);
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('invalid_request_file', error instanceof Error ? error.message : String(error));
            }
        }
        if (nameFlag) {
            input = { ...input, name: nameFlag };
        }
        const hasName = typeof input.name === 'string' && input.name.trim().length > 0;
        const hasAvatar = typeof input.avatarDataUrl === 'string';
        if (!hasName && !hasAvatar) {
            return (0, commandResult_1.commandFailed)('missing_update', 'Provide --name <name> or --request-file <json> with name/avatarDataUrl.');
        }
        const handler = context.dependencies.user?.update;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'User update handler is not configured.');
        }
        return handler(input);
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
        // Deleting the owner identity destroys this machine's only copy of the
        // owner mnemonic; same explicit-confirmation bar as bot/metaapp delete.
        if (!(0, helpers_1.hasFlag)(args, '--confirm')) {
            return (0, commandResult_1.commandFailed)('confirmation_required', 'user delete removes the owner identity, and its locally stored mnemonic cannot be recovered. Back the mnemonic up with `metabot user reveal` first, then retry with --confirm.');
        }
        await (0, ownerIdentity_1.deleteOwnerIdentity)(systemHomeDir);
        // Tombstone the onboarding state so auto-provisioning stays off.
        await (0, ownerOnboarding_1.markOwnerOnboardingOptedOut)(systemHomeDir).catch(() => undefined);
        return (0, commandResult_1.commandSuccess)({ deleted: true });
    }
    // Zero-touch onboarding progress: user account + traffic account + free
    // grant. `--run` advances the pipeline in the daemon (same idempotent
    // runner the daemon start uses); the default read is local-only.
    if (subcommand === 'onboarding') {
        if ((0, helpers_1.hasFlag)(args, '--run')) {
            const handler = context.dependencies.user?.runOnboarding;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'User onboarding run handler is not configured.');
            }
            return handler();
        }
        return (0, commandResult_1.commandSuccess)(await (0, ownerOnboarding_1.readOwnerOnboardingStatus)(systemHomeDir));
    }
    return (0, helpers_1.commandUnknownSubcommand)(`user ${(0, helpers_1.redactSensitiveArgs)(args).join(' ')}`.trim());
}
