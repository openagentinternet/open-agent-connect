"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runUiCommand = runUiCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
const SUPPORTED_UI_PAGES = new Set([
    'hub',
    'bot',
    'conversations',
    'services',
    'apps',
    'settings',
    'buzz',
    'chat',
    'publish',
    'my-services',
    'trace',
    'refund',
    'loom',
    'metaapps',
]);
async function runUiCommand(args, context) {
    if (args[0] !== 'open') {
        return (0, helpers_1.commandUnknownSubcommand)(`ui ${args.join(' ')}`.trim());
    }
    const page = (0, helpers_1.readFlagValue)(args, '--page')?.trim();
    if (!page) {
        return (0, helpers_1.commandMissingFlag)('--page');
    }
    if (!SUPPORTED_UI_PAGES.has(page)) {
        return (0, commandResult_1.commandFailed)('unknown_ui_page', `Unknown UI page: ${page}`);
    }
    const from = (0, helpers_1.readFlagValue)(args, '--from') || undefined;
    const traceId = (0, helpers_1.readFlagValue)(args, '--trace-id') || undefined;
    const sessionId = (0, helpers_1.readFlagValue)(args, '--session-id') || undefined;
    const serviceId = (0, helpers_1.readFlagValue)(args, '--service-id') || undefined;
    const handler = context.dependencies.ui?.open;
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'UI open handler is not configured.');
    }
    return handler({
        page,
        ...(from ? { from } : {}),
        ...(traceId ? { traceId } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(serviceId ? { serviceId } : {}),
    });
}
