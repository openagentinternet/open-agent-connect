"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBotCommand = runBotCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function readFromSlug(args) {
    return (0, helpers_1.readFlagValue)(args, '--from');
}
function readLimit(args, fallback) {
    const raw = (0, helpers_1.readFlagValue)(args, '--limit');
    if (!raw)
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function missingFrom() {
    return (0, helpers_1.commandMissingFlag)('--from');
}
async function runBotCommand(args, context) {
    const [subcommand, nested] = args;
    if (subcommand === 'list') {
        const handler = context.dependencies.bot?.listProfiles;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot profile list handler is not configured.');
        }
        return handler();
    }
    if (subcommand === 'show') {
        const slug = readFromSlug(args);
        if (!slug)
            return missingFrom();
        const handler = context.dependencies.bot?.getProfile;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot profile handler is not configured.');
        }
        return handler({ slug });
    }
    if (subcommand === 'create') {
        const name = (0, helpers_1.readFlagValue)(args, '--name');
        if (!name)
            return (0, helpers_1.commandMissingFlag)('--name');
        const host = (0, helpers_1.readFlagValue)(args, '--host');
        const handler = context.dependencies.bot?.createProfile;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot profile create handler is not configured.');
        }
        const dshLlmProvider = (0, helpers_1.readFlagValue)(args, '--dsh-llm-provider');
        const dshLlmModel = (0, helpers_1.readFlagValue)(args, '--dsh-llm-model');
        const dshLlmFallbackProvider = (0, helpers_1.readFlagValue)(args, '--dsh-llm-fallback-provider');
        const dshLlmFallbackModel = (0, helpers_1.readFlagValue)(args, '--dsh-llm-fallback-model');
        const botType = (0, helpers_1.readFlagValue)(args, '--type');
        if (botType !== null && botType !== 'twin' && botType !== 'worker') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--type must be twin or worker.');
        }
        const ownerGlobalMetaId = (0, helpers_1.readFlagValue)(args, '--owner');
        return handler({
            name,
            ...(host ? { host } : {}),
            ...(dshLlmProvider ? { dshLlmProvider } : {}),
            ...(dshLlmModel ? { dshLlmModel } : {}),
            ...(dshLlmFallbackProvider ? { dshLlmFallbackProvider } : {}),
            ...(dshLlmFallbackModel ? { dshLlmFallbackModel } : {}),
            ...(botType ? { botType } : {}),
            ...(ownerGlobalMetaId ? { ownerGlobalMetaId } : {}),
        });
    }
    if (subcommand === 'bind-owner') {
        const slug = readFromSlug(args);
        if (!slug)
            return missingFrom();
        const handler = context.dependencies.bot?.bindOwner;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot bind-owner handler is not configured.');
        }
        const owner = (0, helpers_1.readFlagValue)(args, '--owner');
        const unbind = (0, helpers_1.hasFlag)(args, '--unbind');
        if (owner && unbind) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--owner and --unbind cannot be combined.');
        }
        return handler({
            slug,
            ...(owner ? { ownerGlobalMetaId: owner } : {}),
            ...(unbind ? { unbind: true } : {}),
        });
    }
    if (subcommand === 'update') {
        const slug = readFromSlug(args);
        if (!slug)
            return missingFrom();
        const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
        if (!payloadFile)
            return (0, helpers_1.commandMissingFlag)('--payload-file');
        const handler = context.dependencies.bot?.updateProfile;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot profile update handler is not configured.');
        }
        const payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
        return handler({ slug, ...payload });
    }
    if (subcommand === 'delete') {
        const slug = readFromSlug(args);
        if (!slug)
            return missingFrom();
        if (!(0, helpers_1.hasFlag)(args, '--confirm')) {
            return (0, commandResult_1.commandFailed)('confirmation_required', 'Bot delete requires --confirm.');
        }
        const handler = context.dependencies.bot?.deleteProfile;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot profile delete handler is not configured.');
        }
        return handler({ slug, confirm: true });
    }
    if (subcommand === 'config' && nested === 'get') {
        const slug = readFromSlug(args);
        if (!slug)
            return missingFrom();
        const handler = context.dependencies.bot?.getConfig;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot config handler is not configured.');
        }
        return handler({ slug });
    }
    if (subcommand === 'config' && nested === 'set') {
        const slug = readFromSlug(args);
        if (!slug)
            return missingFrom();
        const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
        if (!payloadFile)
            return (0, helpers_1.commandMissingFlag)('--payload-file');
        const handler = context.dependencies.bot?.setConfig;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot config handler is not configured.');
        }
        const payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
        return handler({ slug, ...payload });
    }
    if (subcommand === 'wallet') {
        const slug = readFromSlug(args);
        if (!slug)
            return missingFrom();
        const handler = context.dependencies.bot?.getWallet;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot wallet handler is not configured.');
        }
        return handler({ slug });
    }
    if (subcommand === 'backup') {
        const slug = readFromSlug(args);
        if (!slug)
            return missingFrom();
        const handler = context.dependencies.bot?.getBackup;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot backup handler is not configured.');
        }
        return handler({ slug });
    }
    if (subcommand === 'runtimes' && nested === 'list') {
        const from = readFromSlug(args) || undefined;
        const handler = context.dependencies.bot?.listRuntimes;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot runtime list handler is not configured.');
        }
        return handler(from ? { from } : undefined);
    }
    if (subcommand === 'runtimes' && nested === 'discover') {
        const from = readFromSlug(args) || undefined;
        const handler = context.dependencies.bot?.discoverRuntimes;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot runtime discovery handler is not configured.');
        }
        return handler(from ? { from } : undefined);
    }
    if (subcommand === 'sessions') {
        const from = readFromSlug(args) || undefined;
        const handler = context.dependencies.bot?.listSessions;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Bot session list handler is not configured.');
        }
        return handler({
            ...(from ? { slug: from } : {}),
            limit: readLimit(args, 50),
        });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`bot ${args.join(' ')}`.trim());
}
