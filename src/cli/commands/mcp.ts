import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { createMcpSessionServer, type McpToolBackend } from '../../core/sessions/mcpServer';
import { commandUnknownSubcommand, redactSensitiveArgs } from './helpers';
import type { CliRuntimeContext } from '../types';

/** Env sniff for the registering agent (same family as reason-network's). */
function detectAgentFromEnv(env: NodeJS.ProcessEnv): string {
  if (env.OAC_SESSION_AGENT) return env.OAC_SESSION_AGENT.trim();
  if (env.CLAUDECODE) return 'claude-code';
  if (env.CODEX_THREAD_ID) return 'codex';
  if (env.GROK_SESSION_ID) return 'grok-cli';
  if (env.GEMINI_CLI) return 'gemini';
  if (env.CURSOR_AGENT) return 'cursor';
  if (env.COPILOT_CLI) return 'copilot';
  if (env.OPENCODE) return 'opencode';
  return 'mcp-client';
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function sessionKeyFromRegisterResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const data = (result as { data?: { record?: { sessionKey?: unknown } } }).data;
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
export async function runMcpCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] && !args[0].startsWith('-')) {
    return commandUnknownSubcommand(`mcp ${redactSensitiveArgs(args).join(' ')}`.trim());
  }

  const sessions = context.dependencies.sessions;
  if (!sessions?.list || !sessions?.register || !sessions?.inboxCheck || !sessions?.messageStatus) {
    return commandFailed('not_implemented', 'Sessions MCP handlers are not configured. Is the daemon running a build that supports them?');
  }
  const sendMessage = sessions.sendMessage
    ? async (input: { sessionKey: string; to: string; message: string }) => await sessions.sendMessage!(input)
    : undefined;
  const pendingFor = sessions.inboxPending
    ? async (input: { sessionKey: string }) => {
      const result = await sessions.inboxPending!(input);
      const pending = (result as { data?: { pending?: unknown } })?.data?.pending;
      return typeof pending === 'number' && Number.isFinite(pending) ? pending : 0;
    }
    : undefined;

  const explicitName = flagValue(args, '--name');
  const explicitKey = flagValue(args, '--session');
  const agentLabel = flagValue(args, '--agent') ?? detectAgentFromEnv(context.env);

  let sessionKey: string | null = explicitKey?.trim() || null;
  if (!sessionKey && explicitName) {
    const registered = await sessions.register({
      agent: 'cli',
      sessionId: explicitName.trim(),
      name: explicitName.trim(),
    });
    sessionKey = sessionKeyFromRegisterResult(registered);
    if (!sessionKey) {
      return commandFailed('session_register_failed', 'Could not register the named session with the daemon.');
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

  const backend: McpToolBackend = {
    listSessions: async (input) => await sessions.list!({ all: input.all }),
    registerSession: async (input) => await sessions.register!({
      agent: input.agent,
      sessionId: input.sessionId,
      pid: input.pid,
      name: input.name,
    }),
    checkInbox: async (input) => await sessions.inboxCheck!({ sessionKey: input.sessionKey, waitSecs: input.waitSecs }),
    messageStatus: async (input) => await sessions.messageStatus!({ ids: input.ids }),
    sendMessage,
    pendingFor,
  };

  // Bounded JSON lines from the context's stdin; protocol responses go to
  // the context's stdout. Any diagnostic output must stay on stderr.
  const readline = await import('node:readline');
  const lineQueue: string[] = [];
  let wake: (() => void) | null = null;
  let stdinClosed = false;
  const rl = readline.createInterface({ input: context.stdin, crlfDelay: Infinity });
  rl.on('line', (line: string) => {
    lineQueue.push(line.length <= MCP_MAX_LINE_BYTES ? line : ' ');
    wake?.();
    wake = null;
  });
  const closed = new Promise<void>((resolve) => rl.on('close', () => {
    stdinClosed = true;
    wake?.();
    wake = null;
    resolve();
  }));
  async function* readStdinLines(): AsyncGenerator<string> {
    for (;;) {
      if (lineQueue.length) {
        yield lineQueue.shift() as string;
        continue;
      }
      if (stdinClosed) {
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }

  const server = createMcpSessionServer(
    { input: readStdinLines(), write: (line) => context.stdout.write(`${line}\n`) },
    backend,
    { sessionKey: sessionKey ?? undefined },
  );
  await Promise.race([server.run(), closed]);
  rl.close();

  return Object.assign(
    commandSuccess({ served: true, sessionKey: sessionKey ?? null }),
    { __rawStdoutHandled: true },
  );
}
