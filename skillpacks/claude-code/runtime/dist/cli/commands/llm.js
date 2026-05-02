"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLlmCommand = runLlmCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function readFlagValue(args, flag) {
    const idx = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
    if (idx < 0)
        return undefined;
    const arg = args[idx];
    if (arg.includes('='))
        return arg.slice(flag.length + 1);
    const next = args[idx + 1];
    if (next && !next.startsWith('-'))
        return next;
    return undefined;
}
async function requestJson(context, method, path, body) {
    const port = context.env.METABOT_DAEMON_PORT ?? '24042';
    const baseUrl = `http://127.0.0.1:${port}`;
    let url = `${baseUrl}${path}`;
    const fetchOpts = { method };
    if (body && method !== 'GET') {
        fetchOpts.body = JSON.stringify(body);
        fetchOpts.headers = { 'content-type': 'application/json' };
    }
    try {
        const res = await fetch(url, fetchOpts);
        return (await res.json());
    }
    catch {
        return (0, commandResult_1.commandFailed)('daemon_unreachable', `Could not reach metabot daemon at ${baseUrl}. Start it with: metabot daemon start`);
    }
}
async function runLlmCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'list-runtimes') {
        const result = await requestJson(context, 'GET', '/api/llm/runtimes');
        return result;
    }
    if (subcommand === 'discover') {
        const result = await requestJson(context, 'POST', '/api/llm/runtimes/discover');
        return result;
    }
    if (subcommand === 'bindings') {
        const slug = readFlagValue(args, '--slug');
        if (!slug) {
            return (0, commandResult_1.commandFailed)('missing_flag', '--slug is required for bindings list.');
        }
        const result = await requestJson(context, 'GET', `/api/llm/bindings/${encodeURIComponent(slug)}`);
        return result;
    }
    if (subcommand === 'bind') {
        const slug = readFlagValue(args, '--slug');
        const runtimeId = readFlagValue(args, '--runtime-id');
        const role = readFlagValue(args, '--role') ?? 'primary';
        const priorityArg = readFlagValue(args, '--priority');
        const priority = priorityArg ? parseInt(priorityArg, 10) : 0;
        if (!slug)
            return (0, commandResult_1.commandFailed)('missing_flag', '--slug is required.');
        if (!runtimeId)
            return (0, commandResult_1.commandFailed)('missing_flag', '--runtime-id is required.');
        const binding = {
            id: `lb_${slug}_${runtimeId}_${role}`,
            metaBotSlug: slug,
            llmRuntimeId: runtimeId,
            role,
            priority: Number.isFinite(priority) ? priority : 0,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const result = await requestJson(context, 'PUT', `/api/llm/bindings/${encodeURIComponent(slug)}`, {
            bindings: [binding],
        });
        return result;
    }
    if (subcommand === 'unbind') {
        const bindingId = readFlagValue(args, '--binding-id');
        if (!bindingId)
            return (0, commandResult_1.commandFailed)('missing_flag', '--binding-id is required.');
        const result = await requestJson(context, 'DELETE', `/api/llm/bindings/${encodeURIComponent(bindingId)}/delete`);
        return result;
    }
    if (subcommand === 'set-preferred') {
        const slug = readFlagValue(args, '--slug');
        const runtimeId = readFlagValue(args, '--runtime-id');
        if (!slug)
            return (0, commandResult_1.commandFailed)('missing_flag', '--slug is required.');
        const result = await requestJson(context, 'PUT', `/api/llm/preferred-runtime/${encodeURIComponent(slug)}`, {
            runtimeId: runtimeId ?? null,
        });
        return result;
    }
    if (subcommand === 'get-preferred') {
        const slug = readFlagValue(args, '--slug');
        if (!slug)
            return (0, commandResult_1.commandFailed)('missing_flag', '--slug is required.');
        const result = await requestJson(context, 'GET', `/api/llm/preferred-runtime/${encodeURIComponent(slug)}`);
        return result;
    }
    return (0, helpers_1.commandUnknownSubcommand)(`llm ${args.join(' ')}`.trim());
}
