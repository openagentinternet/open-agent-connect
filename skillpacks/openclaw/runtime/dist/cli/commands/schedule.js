"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScheduleCommand = runScheduleCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function requireScheduleHandler(context, key) {
    const handler = context.dependencies.schedule?.[key];
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', `Schedule ${String(key)} handler is not configured.`);
    }
    return handler;
}
function isFailure(value) {
    return Boolean(value && typeof value === 'object' && value.ok === false);
}
const SCHEDULE_CHANNELS = new Set(['auto', 'host', 'daemon']);
const SCHEDULE_EXECUTORS = new Set(['daemon', 'host', 'cli']);
function readRequiredFlagValue(args, flag) {
    const value = (0, helpers_1.readFlagValue)(args, flag);
    if (value === null)
        return null;
    return value.trim() || null;
}
/** Build the ScheduleSpec from the --at/--every/--cron selector flags. */
function readScheduleSpec(args) {
    const at = readRequiredFlagValue(args, '--at');
    const every = readRequiredFlagValue(args, '--every');
    const cron = readRequiredFlagValue(args, '--cron');
    const selectors = [at !== null, every !== null, cron !== null].filter(Boolean).length;
    if (selectors === 0) {
        return { spec: null, error: (0, commandResult_1.commandFailed)('invalid_flag', 'One of --at, --every, or --cron is required to define the schedule.') };
    }
    if (selectors > 1) {
        return { spec: null, error: (0, commandResult_1.commandFailed)('invalid_flag', 'Only one of --at, --every, or --cron may be given.') };
    }
    if (at !== null) {
        if (!Number.isFinite(Date.parse(at))) {
            return { spec: null, error: (0, commandResult_1.commandFailed)('invalid_flag', '--at must be a local wall-clock ISO datetime (for example 2026-09-05T14:30:00).') };
        }
        return { spec: { type: 'at', datetime: at }, error: null };
    }
    if (every !== null) {
        const intervalMs = Number(every);
        if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
            return { spec: null, error: (0, commandResult_1.commandFailed)('invalid_flag', '--every must be a positive integer number of milliseconds.') };
        }
        return { spec: { type: 'interval', intervalMs }, error: null };
    }
    if (cron === null) {
        return { spec: null, error: (0, commandResult_1.commandFailed)('invalid_flag', '--cron requires an expression.') };
    }
    return { spec: { type: 'cron', expression: cron }, error: null };
}
async function readUpdatePayload(context, args) {
    const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
    if (!payloadFile)
        return (0, helpers_1.commandMissingFlag)('--payload-file');
    try {
        return await (0, helpers_1.readJsonFile)(context, payloadFile);
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('invalid_payload', error instanceof Error ? error.message : String(error));
    }
}
async function runScheduleCommand(args, context) {
    const [subcommand] = args;
    const from = (0, helpers_1.readFromFlag)(args);
    if (subcommand === 'list' || subcommand === 'due') {
        const handler = requireScheduleHandler(context, subcommand);
        if (isFailure(handler))
            return handler;
        if (subcommand === 'due') {
            if (from !== undefined && (0, helpers_1.hasFlag)(args, '--all')) {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--from and --all cannot be combined; --all covers every local profile.');
            }
            return handler({ from, ...((0, helpers_1.hasFlag)(args, '--all') ? { all: true } : {}) });
        }
        return handler({ from });
    }
    if (subcommand === 'show' || subcommand === 'delete' || subcommand === 'enable'
        || subcommand === 'disable' || subcommand === 'run' || subcommand === 'claim') {
        const handler = requireScheduleHandler(context, subcommand);
        if (isFailure(handler))
            return handler;
        const id = readRequiredFlagValue(args, '--id');
        if (!id)
            return (0, helpers_1.commandMissingFlag)('--id');
        if (subcommand === 'delete' && !(0, helpers_1.hasFlag)(args, '--confirm')) {
            return (0, helpers_1.commandMissingFlag)('--confirm');
        }
        if (subcommand === 'claim') {
            const executor = (0, helpers_1.readFlagValue)(args, '--executor');
            if (executor !== null && !SCHEDULE_EXECUTORS.has(executor.trim())) {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--executor must be daemon, host, or cli.');
            }
            return handler({
                from,
                id,
                ...(executor !== null ? { executor: executor.trim() } : {}),
            });
        }
        return handler({ from, id });
    }
    if (subcommand === 'update') {
        const handler = requireScheduleHandler(context, 'update');
        if (isFailure(handler))
            return handler;
        const id = readRequiredFlagValue(args, '--id');
        if (!id)
            return (0, helpers_1.commandMissingFlag)('--id');
        const payload = await readUpdatePayload(context, args);
        if (isFailure(payload))
            return payload;
        return handler({ from, id, payload });
    }
    if (subcommand === 'create') {
        const handler = requireScheduleHandler(context, 'create');
        if (isFailure(handler))
            return handler;
        const name = readRequiredFlagValue(args, '--name');
        if (!name)
            return (0, helpers_1.commandMissingFlag)('--name');
        const prompt = readRequiredFlagValue(args, '--prompt');
        if (!prompt)
            return (0, helpers_1.commandMissingFlag)('--prompt');
        const { spec, error } = readScheduleSpec(args);
        if (error)
            return error;
        const channel = (0, helpers_1.readFlagValue)(args, '--channel');
        if (channel !== null && !SCHEDULE_CHANNELS.has(channel.trim())) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--channel must be auto, host, or daemon.');
        }
        const expiresAt = readRequiredFlagValue(args, '--expires-at');
        if (expiresAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--expires-at must be a date-only YYYY-MM-DD string.');
        }
        return handler({
            from,
            name,
            prompt,
            schedule: spec,
            ...(readRequiredFlagValue(args, '--working-directory') !== null
                ? { workingDirectory: readRequiredFlagValue(args, '--working-directory') }
                : {}),
            ...(channel !== null ? { channel: channel.trim() } : {}),
            ...(expiresAt !== null ? { expiresAt } : {}),
            ...((0, helpers_1.hasFlag)(args, '--disabled') ? { enabled: false } : {}),
        });
    }
    if (subcommand === 'runs') {
        const handler = requireScheduleHandler(context, 'runs');
        if (isFailure(handler))
            return handler;
        const id = readRequiredFlagValue(args, '--id');
        const rawLimit = (0, helpers_1.readFlagValue)(args, '--limit');
        const limit = rawLimit === null ? undefined : Number(rawLimit);
        if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.');
        }
        return handler({
            from,
            ...(id !== null ? { id } : {}),
            ...(limit !== undefined ? { limit } : {}),
        });
    }
    if (subcommand === 'complete') {
        const handler = requireScheduleHandler(context, 'complete');
        if (isFailure(handler))
            return handler;
        const runId = readRequiredFlagValue(args, '--run-id');
        if (!runId)
            return (0, helpers_1.commandMissingFlag)('--run-id');
        const error = readRequiredFlagValue(args, '--error');
        const rawDuration = (0, helpers_1.readFlagValue)(args, '--duration-ms');
        const durationMs = rawDuration === null ? undefined : Number(rawDuration);
        if (durationMs !== undefined && (!Number.isInteger(durationMs) || durationMs < 0)) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--duration-ms must be a non-negative integer.');
        }
        return handler({
            from,
            runId,
            ...(error !== null ? { error } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
        });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`schedule ${String(subcommand ?? '')}`.trim());
}
