"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTraceCommand = runTraceCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function readLimit(args, fallback) {
    const raw = (0, helpers_1.readFlagValue)(args, '--limit');
    if (!raw)
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
async function runTraceCommand(args, context) {
    if (args[0] !== 'get' && args[0] !== 'watch' && args[0] !== 'sessions') {
        return (0, helpers_1.commandUnknownSubcommand)(`trace ${args.join(' ')}`.trim());
    }
    if (args[0] === 'sessions') {
        const handler = context.dependencies.trace?.listSessions;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Trace session list handler is not configured.');
        }
        const from = (0, helpers_1.readFlagValue)(args, '--from') || undefined;
        return handler({
            ...(from ? { from } : {}),
            all: (0, helpers_1.hasFlag)(args, '--all'),
            limit: readLimit(args, 50),
        });
    }
    if (args[0] === 'watch') {
        const traceId = (0, helpers_1.readFlagValue)(args, '--trace-id');
        const from = (0, helpers_1.readFlagValue)(args, '--from') || undefined;
        if (!traceId) {
            return (0, helpers_1.commandMissingFlag)('--trace-id');
        }
        const handler = context.dependencies.trace?.watch;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Trace watch handler is not configured.');
        }
        const stream = await handler({ traceId, ...(from ? { from } : {}) });
        context.stdout.write(stream);
        const streamedResult = (0, commandResult_1.commandSuccess)({
            traceId,
            streamed: true,
        });
        streamedResult.__rawStdoutHandled = true;
        return streamedResult;
    }
    const traceId = (0, helpers_1.readFlagValue)(args, '--trace-id');
    const sessionId = (0, helpers_1.readFlagValue)(args, '--session-id');
    const from = (0, helpers_1.readFlagValue)(args, '--from') || undefined;
    if (!traceId && !sessionId) {
        return (0, commandResult_1.commandFailed)('missing_trace_selector', 'Trace get requires --trace-id or --session-id.');
    }
    const handler = context.dependencies.trace?.get;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Trace handler is not configured.');
    }
    return handler(sessionId
        ? { sessionId, ...(from ? { from } : {}) }
        : { traceId: traceId || '', ...(from ? { from } : {}) });
}
