import type { MetabotCommandResult } from '../../core/contracts/commandResult';

const CLI_POLL_TIMEOUT_MS = 300_000;
const CLI_POLL_INTERVAL_MS = 3_000;

export interface PollTraceInput {
  traceId: string;
  localUiUrl: string;
  requestFn: (method: 'GET' | 'POST' | 'DELETE', path: string) => Promise<MetabotCommandResult<unknown>>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface PollTraceResult {
  completed: boolean;
  terminalStatus?: string | null;
  trace?: Record<string, unknown>;
}

function extractPublicStatus(result: unknown): string | null {
  if (
    typeof result === 'object' && result !== null &&
    'ok' in result && (result as { ok: boolean }).ok === true &&
    'data' in result
  ) {
    const data = (result as { data: unknown }).data;
    if (typeof data === 'object' && data !== null && 'sessions' in data) {
      const sessions = (data as { sessions: unknown }).sessions;
      if (Array.isArray(sessions) && sessions.length > 0) {
        const first = sessions[0];
        if (typeof first === 'object' && first !== null && 'publicStatus' in first) {
          return String(first.publicStatus);
        }
      }
    }
    if (typeof data === 'object' && data !== null && 'session' in data) {
      const session = (data as { session: unknown }).session;
      if (typeof session === 'object' && session !== null && 'publicStatus' in session) {
        return String((session as { publicStatus: unknown }).publicStatus);
      }
    }
    if (typeof data === 'object' && data !== null && 'a2a' in data) {
      const a2a = (data as { a2a: unknown }).a2a;
      if (typeof a2a === 'object' && a2a !== null && 'publicStatus' in a2a) {
        return String((a2a as { publicStatus: unknown }).publicStatus);
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollTraceUntilComplete(input: PollTraceInput): Promise<PollTraceResult> {
  const timeoutMs = input.timeoutMs ?? CLI_POLL_TIMEOUT_MS;
  const intervalMs = input.intervalMs ?? CLI_POLL_INTERVAL_MS;
  const tracePath = `/api/trace/${encodeURIComponent(input.traceId)}`;

  input.stderr.write(`Waiting for response...\n`);
  input.stderr.write(`Track progress: ${input.localUiUrl}\n`);

  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | null = null;
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    try {
      const result = await input.requestFn('GET', tracePath);
      consecutiveErrors = 0;

      const status = extractPublicStatus(result);
      if (status && status !== lastStatus) {
        lastStatus = status;
        if (status !== 'requesting_remote') {
          input.stderr.write(`Status: ${status}\n`);
        }
      }

      if (status === 'completed' || status === 'timeout' || status === 'manual_action_required' || status === 'failed') {
        const data = (result as { data: unknown }).data as Record<string, unknown>;
        input.stderr.write(`Trace reached terminal status (${status}). View full trace: ${input.localUiUrl}\n`);
        return { completed: true, terminalStatus: status, trace: data };
      }
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors > 10) {
        input.stderr.write(`Unable to reach daemon. View trace in browser: ${input.localUiUrl}\n`);
        return { completed: false, terminalStatus: null };
      }
    }

    await sleep(intervalMs);
  }

  input.stderr.write(`Provider has not responded yet. Continue tracking: ${input.localUiUrl}\n`);
  return { completed: false, terminalStatus: null };
}
