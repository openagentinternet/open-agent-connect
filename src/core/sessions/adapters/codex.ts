/**
 * Codex push adapter (local session adapters P3).
 *
 * Hands the framed message to the official `codex queue --thread <id>
 * --message <text>` — the delivery path that works for live and offline
 * threads alike: on a resumed thread the queued message starts the turn.
 * A missing binary or a rejected queue is a failed push; the router falls
 * back to the mail queue (the session sees the message at its next
 * check_inbox). Runs with the session's CODEX_HOME when one is known.
 */

import { execFile } from 'node:child_process';

const QUEUE_TIMEOUT_MS = 15_000;

export interface CodexQueuePushInput {
  threadId: string;
  framedText: string;
  /** Injectable binary (tests); default `codex` on PATH. */
  codexBin?: string;
  /** CODEX_HOME the thread lives in, when known. */
  codexHome?: string;
  /** Injectable exec (tests). */
  run?: (file: string, args: string[], options: { timeout: number; env: NodeJS.ProcessEnv }) => Promise<void>;
}

function defaultRun(
  file: string,
  args: string[],
  options: { timeout: number; env: NodeJS.ProcessEnv },
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export async function pushToCodexQueue(input: CodexQueuePushInput): Promise<void> {
  const run = input.run ?? defaultRun;
  const env: NodeJS.ProcessEnv = input.codexHome
    ? { ...process.env, CODEX_HOME: input.codexHome }
    : { ...process.env };
  await run(
    input.codexBin ?? 'codex',
    ['queue', '--thread', input.threadId, '--message', input.framedText],
    { timeout: QUEUE_TIMEOUT_MS, env },
  );
}
