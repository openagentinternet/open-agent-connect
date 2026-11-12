import { commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { runHook, type HookEvent } from '../../core/sessions/hooks';
import type { CliRuntimeContext } from '../types';

const STDIN_READ_LIMIT_MS = 3_000;
const HOOK_TIMEOUT_MS = 8_000;
const HOOK_PAYLOAD_MAX_BYTES = 512 * 1024;

const VALID_EVENTS: HookEvent[] = [
  'session-start',
  'user-prompt-submit',
  'post-tool-use',
  'stop',
  'session-end',
  'status',
];

function readStdinBounded(stdin: NodeJS.ReadableStream, limitMs: number): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: string) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => finish(Buffer.concat(chunks).toString('utf8')), limitMs);
    (stdin as NodeJS.ReadStream).on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total <= HOOK_PAYLOAD_MAX_BYTES) {
        chunks.push(chunk);
      }
    });
    (stdin as NodeJS.ReadStream).on('end', () => {
      clearTimeout(timer);
      finish(Buffer.concat(chunks).toString('utf8'));
    });
    (stdin as NodeJS.ReadStream).on('error', () => {
      clearTimeout(timer);
      finish(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

/**
 * `metabot hook <event>` — the turn-tier hook handler (local session
 * adapters P4a), installed into host hook configs by `metabot sessions
 * wire`. Registers/refreshes the session from the hook payload and, on a
 * mail-taking event, prints the framed inbox mail as the host's
 * additionalContext dialect. Hooks must NEVER break their host: every
 * failure exits 0 silently, and the whole run is bounded.
 */
export async function runHookCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const event = args[0];
  const agentArg = (() => {
    const index = args.indexOf('--agent');
    return index >= 0 ? args[index + 1] : undefined;
  })();

  if (!event || !VALID_EVENTS.includes(event as HookEvent)) {
    // Unknown event: stay silent so a misconfigured hook never spams a host.
    return Object.assign(commandSuccess({ handled: false, reason: 'unknown_event' }), { __rawStdoutHandled: true });
  }

  const sessions = context.dependencies.sessions;
  if (!sessions?.register || !sessions?.inboxCheck) {
    return Object.assign(commandSuccess({ handled: false, reason: 'not_implemented' }), { __rawStdoutHandled: true });
  }

  const rawPayload = await readStdinBounded(context.stdin, STDIN_READ_LIMIT_MS);
  let payload: Record<string, unknown> | null = null;
  const trimmed = rawPayload.trim().replace(/^\uFEFF/, '');
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
  }

  const result = await Promise.race([
    runHook({
      agent: agentArg ?? '',
      event: event as HookEvent,
      payload,
      env: context.env,
      pid: process.pid,
      backend: {
        registerSession: async (input) => await sessions.register!(input),
        inboxCheck: async (hookInput) => await sessions.inboxCheck!(hookInput),
      },
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), HOOK_TIMEOUT_MS)),
  ]).catch(() => null);

  if (result) {
    // Printed means delivered: the host has the mail in front of the model.
    context.stdout.write(`${result.output}\n`);
  }
  return Object.assign(
    commandSuccess({ handled: Boolean(result), sessionKey: result?.sessionKey ?? null, mailIds: result?.mailIds ?? [] }),
    { __rawStdoutHandled: true },
  );
}
