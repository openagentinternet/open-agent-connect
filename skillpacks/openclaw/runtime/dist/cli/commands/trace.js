"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTraceCommand = runTraceCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
async function runTraceCommand(args, context) {
    if (args[0] !== 'get' && args[0] !== 'watch') {
        return (0, helpers_1.commandUnknownSubcommand)(`trace ${args.join(' ')}`.trim());
    }
    const traceId = (0, helpers_1.readFlagValue)(args, '--trace-id');
    if (!traceId) {
        return (0, helpers_1.commandMissingFlag)('--trace-id');
    }
    if (args[0] === 'watch') {
        const handler = context.dependencies.trace?.watch;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Trace watch handler is not configured.');
        }
        const stream = await handler({ traceId });
        context.stdout.write(stream);
        const streamedResult = (0, commandResult_1.commandSuccess)({
            traceId,
            streamed: true,
        });
        streamedResult.__rawStdoutHandled = true;
        return streamedResult;
    }
    const handler = context.dependencies.trace?.get;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Trace handler is not configured.');
    }
    return handler({ traceId });
}
