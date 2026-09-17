"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSurfCommand = runSurfCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function requireSurfHandler(context, key) {
    const handler = context.dependencies.surf?.[key];
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', `Surf ${String(key)} handler is not configured.`);
    }
    return handler;
}
function isFailure(value) {
    return Boolean(value && typeof value === 'object' && value.ok === false);
}
const TRIGGERS = new Set(['manual-chat', 'manual-ui', 'pre-dream']);
async function runSurfCommand(args, context) {
    const [subcommand] = args;
    const from = (0, helpers_1.readFromFlag)(args);
    if (subcommand === 'status') {
        const handler = requireSurfHandler(context, 'status');
        if (isFailure(handler))
            return handler;
        const limitRaw = (0, helpers_1.readFlagValue)(args, '--limit');
        const limit = limitRaw === null ? undefined : Number(limitRaw);
        return handler({ from, ...(limit !== undefined && Number.isFinite(limit) ? { limit: Math.floor(limit) } : {}) });
    }
    if (subcommand === 'run') {
        const handler = requireSurfHandler(context, 'run');
        if (isFailure(handler))
            return handler;
        const triggerRaw = (0, helpers_1.readFlagValue)(args, '--trigger');
        if (triggerRaw !== null && !TRIGGERS.has(triggerRaw)) {
            return (0, commandResult_1.commandFailed)('invalid_trigger', `--trigger must be one of manual-chat, manual-ui, pre-dream (got "${triggerRaw}").`);
        }
        return handler({
            from,
            ...(triggerRaw ? { trigger: triggerRaw } : {}),
            ...(args.includes('--wait') ? { wait: true } : {}),
        });
    }
    if (subcommand === 'enable' || subcommand === 'disable') {
        const handler = requireSurfHandler(context, subcommand === 'enable' ? 'enable' : 'disable');
        if (isFailure(handler))
            return handler;
        return handler({ from });
    }
    if (subcommand === 'budget') {
        const handler = requireSurfHandler(context, 'budget');
        if (isFailure(handler))
            return handler;
        // Positionals = bare tokens only: flags AND their values are skipped, so
        // `--from bob 30` yields ['30'] (the flag's value must never read as the
        // budget — live-smoke catch, 2026-09-15).
        const VALUE_FLAGS = new Set(['--from', '--trigger', '--limit', '--value']);
        const positional = [];
        for (let index = 0; index < args.length; index += 1) {
            const arg = args[index];
            if (arg === 'budget')
                continue;
            if (arg.startsWith('--')) {
                if (VALUE_FLAGS.has(arg) && !arg.includes('='))
                    index += 1;
                continue;
            }
            positional.push(arg);
        }
        const raw = positional[0] ?? (0, helpers_1.readFlagValue)(args, '--value');
        if (raw === undefined || raw === null) {
            return (0, helpers_1.commandMissingFlag)('budget value (metabot surf budget --from <slug> <0-100>)');
        }
        const budget = Number(raw);
        if (!Number.isInteger(budget) || budget < 0 || budget > 100) {
            return (0, commandResult_1.commandFailed)('invalid_budget', 'Interaction budget must be an integer between 0 and 100.');
        }
        return handler({ from, budget });
    }
    if (!subcommand) {
        return (0, commandResult_1.commandFailed)('missing_subcommand', 'Usage: metabot surf <status|run|enable|disable|budget> [--from <slug>]');
    }
    return (0, helpers_1.commandUnknownSubcommand)(`surf ${subcommand}`);
}
