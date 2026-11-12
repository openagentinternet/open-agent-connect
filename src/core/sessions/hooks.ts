/**
 * Host hook handler (local session adapters P4a).
 *
 * The turn tier: hosts whose hooks can only add context at a tool call or
 * turn end (Gemini, Cursor, Copilot, Grok CLI) get mail through a hook
 * handler — `metabot hook <event>` — that the wire step installs into each
 * host's hook config. The handler registers/refreshes the session, and on
 * mail-taking events fetches the session's inbox and prints the framed mail
 * as the host's additionalContext dialect.
 *
 * Gotcha confirmed by reason-network: Cursor, Copilot CLI and Devin load
 * CLAUDE CODE's hooks from ~/.claude/settings.json, so the agent argument
 * the settings file carries cannot be trusted — env detection wins.
 *
 * Pure logic + an injected backend; the CLI command only does stdin/stdout.
 */

import { buildPeerMessageFrame } from './framing';

export type HookEvent =
  | 'session-start'
  | 'user-prompt-submit'
  | 'post-tool-use'
  | 'stop'
  | 'session-end'
  | 'status';

export type HookEventKind = 'start' | 'prompt' | 'tool' | 'stop' | 'end';

const KIND_BY_EVENT: Record<string, HookEventKind> = {
  'session-start': 'start',
  'user-prompt-submit': 'prompt',
  'post-tool-use': 'tool',
  stop: 'stop',
  'session-end': 'end',
};

/** Env sniffs that OVERRIDE the agent argument (cross-loaded hooks). */
function envAgent(env: NodeJS.ProcessEnv): string | null {
  if (env.OAC_HOOK_AGENT) return env.OAC_HOOK_AGENT.trim();
  if (env.CURSOR_AGENT) return 'cursor';
  if (env.COPILOT_CLI) return 'copilot';
  if (env.GEMINI_CLI) return 'gemini';
  if (env.GROK_SESSION_ID) return 'grok';
  if (env.CLAUDECODE) return 'claude-code';
  if (env.CODEX_THREAD_ID) return 'codex';
  return null;
}

export function detectHookAgent(env: NodeJS.ProcessEnv, argAgent: string | undefined): string {
  return envAgent(env) ?? (argAgent?.trim() || 'claude-code');
}

export function hookEventKind(event: string): HookEventKind | null {
  return KIND_BY_EVENT[event] ?? null;
}

/**
 * Which (agent, event) combinations can actually carry mail to the model:
 * prompt-submit hooks in Cursor/Copilot/Grok cannot add context, and Grok
 * drops what SessionStart prints.
 */
export function takesMail(agent: string, event: string): boolean {
  return !(
    ((agent === 'cursor' || agent === 'copilot' || agent === 'grok') && event === 'user-prompt-submit')
    || (agent === 'grok' && event === 'session-start')
    || event === 'status'
  );
}

/** Grok ignores subagent hook runs and shutdown Stops. */
export function grokIgnores(event: string, payload: Record<string, unknown> | null): boolean {
  if (!payload) {
    return false;
  }
  return payload.subagentType != null
    || (event === 'stop' && payload.reason !== 'end_turn');
}

/**
 * The JSON each host expects on hook stdout to put `text` in front of the
 * model (reason-network's dialect table). Null = nothing to print.
 */
export function formatHookMail(
  agent: string,
  event: string,
  kind: HookEventKind,
  text: string,
): string | null {
  if (!text) {
    return null;
  }
  const specific = (name: string): string => JSON.stringify({
    hookSpecificOutput: { hookEventName: name, additionalContext: text },
  });
  switch (kind) {
    case 'start':
      if (agent === 'claude-code' || agent === 'codex' || agent === 'grok') {
        return specific('SessionStart');
      }
      if (agent === 'gemini') {
        return specific('SessionStart');
      }
      break;
    case 'prompt':
      if (agent === 'gemini') {
        return specific('BeforeAgent');
      }
      break;
    case 'tool':
      if (agent !== 'cursor' && agent !== 'copilot') {
        return specific('PostToolUse');
      }
      break;
    case 'stop':
      if (agent === 'cursor') {
        return JSON.stringify({ additional_context: text });
      }
      if (agent === 'copilot') {
        return JSON.stringify({ additionalContext: text });
      }
      return specific('PostToolUse');
    case 'end':
      return null;
  }
  // Cursor/Copilot take context on any other event via their flat dialects.
  if (agent === 'cursor') {
    return JSON.stringify({ additional_context: text });
  }
  if (agent === 'copilot') {
    return JSON.stringify({ additionalContext: text });
  }
  return null;
}

export interface HookPayload {
  sessionId?: string;
  cwd?: string;
  peerName?: string;
}

export interface HookBackend {
  registerSession(input: {
    agent: string;
    sessionId?: string;
    pid?: number;
    cwd?: string;
    source: 'hook';
    deliverable: boolean;
    status?: 'busy' | 'idle';
  }): Promise<unknown>;
  inboxCheck(input: { sessionKey: string; waitSecs?: number }): Promise<unknown>;
}

export interface RunHookInput {
  agent: string;
  event: HookEvent;
  payload: Record<string, unknown> | null;
  env: NodeJS.ProcessEnv;
  pid?: number;
  backend: HookBackend;
  now?: () => number;
}

export interface RunHookResult {
  sessionKey: string;
  output: string;
  mailIds: string[];
}

function textAt(payload: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!payload) {
    return undefined;
  }
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/** Extract framed mail bodies from an inboxCheck result (commandSuccess). */
function extractMail(result: unknown): Array<{ id: string; from: string; fromName?: string; body: string }> {
  const data = (result as { data?: { messages?: unknown } })?.data;
  const messages = Array.isArray(data?.messages) ? data?.messages : [];
  return messages
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      from: typeof item.from === 'string' ? item.from : '',
      fromName: typeof item.fromName === 'string' ? item.fromName : undefined,
      body: typeof item.body === 'string' ? item.body : '',
    }))
    .filter((entry) => entry.id && entry.from && entry.body);
}

/**
 * Handle one hook invocation: register/refresh the session and, on a
 * mail-taking event, compose the framed inbox mail into the host's dialect.
 * Returns null when nothing should be printed (non-mail events, no session
 * id, empty inbox). Never throws.
 */
export async function runHook(input: RunHookInput): Promise<RunHookResult | null> {
  const kind = hookEventKind(input.event);
  if (!kind) {
    return null;
  }
  const agent = detectHookAgent(input.env, input.agent);
  if (agent === 'grok' && grokIgnores(input.event, input.payload)) {
    return null;
  }
  const sessionId = textAt(input.payload, ['session_id', 'conversation_id', 'conversationId', 'sessionId']);
  if (!sessionId) {
    return null;
  }
  const cwd = textAt(input.payload, ['cwd']) ?? input.env.CLAUDE_PROJECT_DIR ?? input.env.CURSOR_PROJECT_DIR;

  const status: 'busy' | 'idle' | undefined = kind === 'prompt' || kind === 'tool' ? 'busy' : kind === 'stop' ? 'idle' : undefined;
  let sessionKey: string | null = null;
  try {
    const registered = await input.backend.registerSession({
      agent,
      sessionId,
      pid: input.pid,
      cwd,
      source: 'hook',
      deliverable: true,
      status,
    });
    const record = (registered as { data?: { record?: { sessionKey?: unknown } } })?.data?.record;
    sessionKey = typeof record?.sessionKey === 'string' ? record.sessionKey : `${agent}:${sessionId}`;
  } catch {
    return null;
  }

  if (!takesMail(agent, input.event)) {
    return null;
  }
  let mail: Array<{ id: string; from: string; fromName?: string; body: string }>;
  try {
    const inbox = await input.backend.inboxCheck({ sessionKey, waitSecs: 0 });
    mail = extractMail(inbox);
  } catch {
    return null;
  }
  if (!mail.length) {
    return null;
  }
  const framed = mail
    .map((entry) => buildPeerMessageFrame({
      from: entry.from,
      fromName: entry.fromName,
      mailId: entry.id,
      body: entry.body,
    }))
    .join('\n');
  const output = formatHookMail(agent, input.event, kind, framed);
  if (!output) {
    return null;
  }
  return { sessionKey, output, mailIds: mail.map((entry) => entry.id) };
}
