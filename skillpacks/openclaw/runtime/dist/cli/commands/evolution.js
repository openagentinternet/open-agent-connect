"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEvolutionCommand = runEvolutionCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runEvolutionCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'status') {
        const handler = context.dependencies.evolution?.status;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Evolution status handler is not configured.');
        }
        return handler();
    }
    if (subcommand === 'adopt') {
        const handler = context.dependencies.evolution?.adopt;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Evolution adopt handler is not configured.');
        }
        const skill = (0, helpers_1.readFlagValue)(args, '--skill');
        if (!skill) {
            return (0, helpers_1.commandMissingFlag)('--skill');
        }
        const variantId = (0, helpers_1.readFlagValue)(args, '--variant-id');
        if (!variantId) {
            return (0, helpers_1.commandMissingFlag)('--variant-id');
        }
        const source = (0, helpers_1.readFlagValue)(args, '--source') ?? 'local';
        if (source !== 'local' && source !== 'remote') {
            return (0, commandResult_1.commandFailed)('evolution_remote_adopt_not_supported', `Unsupported evolution adoption source: ${source}.`);
        }
        return handler({
            skill,
            variantId,
            source,
        });
    }
    if (subcommand === 'publish') {
        const handler = context.dependencies.evolution?.publish;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Evolution publish handler is not configured.');
        }
        const skill = (0, helpers_1.readFlagValue)(args, '--skill');
        if (!skill) {
            return (0, helpers_1.commandMissingFlag)('--skill');
        }
        const variantId = (0, helpers_1.readFlagValue)(args, '--variant-id');
        if (!variantId) {
            return (0, helpers_1.commandMissingFlag)('--variant-id');
        }
        return handler({ skill, variantId });
    }
    if (subcommand === 'rollback') {
        const handler = context.dependencies.evolution?.rollback;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Evolution rollback handler is not configured.');
        }
        const skill = (0, helpers_1.readFlagValue)(args, '--skill');
        if (!skill) {
            return (0, helpers_1.commandMissingFlag)('--skill');
        }
        return handler({ skill });
    }
    if (subcommand === 'search') {
        const handler = context.dependencies.evolution?.search;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Evolution search handler is not configured.');
        }
        const skill = (0, helpers_1.readFlagValue)(args, '--skill');
        if (!skill) {
            return (0, helpers_1.commandMissingFlag)('--skill');
        }
        return handler({ skill });
    }
    if (subcommand === 'import') {
        const handler = context.dependencies.evolution?.import;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Evolution import handler is not configured.');
        }
        const pinId = (0, helpers_1.readFlagValue)(args, '--pin-id');
        if (!pinId) {
            return (0, helpers_1.commandMissingFlag)('--pin-id');
        }
        return handler({ pinId });
    }
    if (subcommand === 'imported') {
        const handler = context.dependencies.evolution?.imported;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Evolution imported handler is not configured.');
        }
        const skill = (0, helpers_1.readFlagValue)(args, '--skill');
        if (!skill) {
            return (0, helpers_1.commandMissingFlag)('--skill');
        }
        return handler({ skill });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`evolution ${args.join(' ')}`.trim());
}
