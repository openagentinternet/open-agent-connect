"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMcpCommand = runMcpCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const mcpServer_1 = require("../../core/sessions/mcpServer");
const helpers_1 = require("./helpers");
/** Env sniff for the registering agent (same family as reason-network's). */
function detectAgentFromEnv(env) {
    if (env.OAC_SESSION_AGENT)
        return env.OAC_SESSION_AGENT.trim();
    if (env.CLAUDECODE)
        return 'claude-code';
    if (env.CODEX_THREAD_ID)
        return 'codex';
    if (env.GROK_SESSION_ID)
        return 'grok-cli';
    if (env.GEMINI_CLI)
        return 'gemini';
    if (env.CURSOR_AGENT)
        return 'cursor';
    if (env.COPILOT_CLI)
        return 'copilot';
    if (env.OPENCODE)
        return 'opencode';
    return 'mcp-client';
}
function flagValue(args, flag) {
    const index = args.indexOf(flag);
    if (index < 0)
        return undefined;
    return args[index + 1];
}
function sessionKeyFromRegisterResult(result) {
    if (!result || typeof result !== 'object')
        return null;
    const data = result.data;
    const key = data?.record?.sessionKey;
    return typeof key === 'string' && key.trim() ? key.trim() : null;
}
const MCP_MAX_LINE_BYTES = 1_000_000;
/**
 * `metabot mcp` — the local session MCP server (local session adapters
 * P2a). Speaks JSON-RPC 2.0 over stdio (the MCP stdio transport) so an MCP
 * host (ZCode, Claude Desktop, any MCP client) can list this machine's
 * sessions, long-poll its session inbox, and read delivery receipts. The
 * tool handlers are the same daemon-backed dependency proxies the CLI uses
 * (they auto-start the daemon). Session identity: `--name <name>` registers
 * a named session; otherwise the process registers env-detected (or as a
 * generic MCP client keyed by pid).
 *
 * This command takes over stdout for the protocol — the returned result is
 * marked `__rawStdoutHandled` so the CLI's JSON-line printer stays silent.
 */
async function runMcpCommand(args, context) {
    if (args[0] && !args[0].startsWith('-')) {
        return (0, helpers_1.commandUnknownSubcommand)(`mcp ${(0, helpers_1.redactSensitiveArgs)(args).join(' ')}`.trim());
    }
    const sessions = context.dependencies.sessions;
    if (!sessions?.list || !sessions?.register || !sessions?.inboxCheck || !sessions?.messageStatus) {
        return (0, commandResult_1.commandFailed)('not_implemented', 'Sessions MCP handlers are not configured. Is the daemon running a build that supports them?');
    }
    const sendMessage = sessions.sendMessage
        ? async (input) => await sessions.sendMessage(input)
        : undefined;
    const pendingFor = sessions.inboxPending
        ? async (input) => {
            const result = await sessions.inboxPending(input);
            const pending = result?.data?.pending;
            return typeof pending === 'number' && Number.isFinite(pending) ? pending : 0;
        }
        : undefined;
    const explicitName = flagValue(args, '--name');
    const explicitKey = flagValue(args, '--session');
    const agentLabel = flagValue(args, '--agent') ?? detectAgentFromEnv(context.env);
    let sessionKey = explicitKey?.trim() || null;
    if (!sessionKey && explicitName) {
        const registered = await sessions.register({
            agent: 'cli',
            sessionId: explicitName.trim(),
            name: explicitName.trim(),
        });
        sessionKey = sessionKeyFromRegisterResult(registered);
        if (!sessionKey) {
            return (0, commandResult_1.commandFailed)('session_register_failed', 'Could not register the named session with the daemon.');
        }
    }
    if (!sessionKey) {
        const registered = await sessions.register({
            agent: agentLabel,
            pid: process.pid,
        });
        sessionKey = sessionKeyFromRegisterResult(registered);
        // Registration is best effort: the server still serves tools and each
        // call surfaces daemon errors itself.
    }
    const backend = {
        listSessions: async (input) => await sessions.list({ all: input.all }),
        registerSession: async (input) => await sessions.register({
            agent: input.agent,
            sessionId: input.sessionId,
            pid: input.pid,
            name: input.name,
        }),
        checkInbox: async (input) => await sessions.inboxCheck({ sessionKey: input.sessionKey, waitSecs: input.waitSecs }),
        messageStatus: async (input) => await sessions.messageStatus({ ids: input.ids }),
        sendMessage,
        pendingFor,
    };
    // Bounded JSON lines from the context's stdin; protocol responses go to
    // the context's stdout. Any diagnostic output must stay on stderr.
    const readline = await Promise.resolve().then(() => __importStar(require('node:readline')));
    const lineQueue = [];
    let wake = null;
    let stdinClosed = false;
    const rl = readline.createInterface({ input: context.stdin, crlfDelay: Infinity });
    rl.on('line', (line) => {
        lineQueue.push(line.length <= MCP_MAX_LINE_BYTES ? line : ' ');
        wake?.();
        wake = null;
    });
    const closed = new Promise((resolve) => rl.on('close', () => {
        stdinClosed = true;
        wake?.();
        wake = null;
        resolve();
    }));
    async function* readStdinLines() {
        for (;;) {
            if (lineQueue.length) {
                yield lineQueue.shift();
                continue;
            }
            if (stdinClosed) {
                return;
            }
            await new Promise((resolve) => {
                wake = resolve;
            });
        }
    }
    const server = (0, mcpServer_1.createMcpSessionServer)({ input: readStdinLines(), write: (line) => context.stdout.write(`${line}\n`) }, backend, { sessionKey: sessionKey ?? undefined });
    await Promise.race([server.run(), closed]);
    rl.close();
    return Object.assign((0, commandResult_1.commandSuccess)({ served: true, sessionKey: sessionKey ?? null }), { __rawStdoutHandled: true });
}
