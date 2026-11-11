/**
 * Claude Code push adapter (local session adapters P3).
 *
 * Posts the framed message into a live Claude Code session's inbox socket
 * (`messagingSocketPath` from the `~/.claude/sessions/<pid>.json` registry,
 * recorded on the session record by discovery). Frame = newline-delimited
 * JSON, exactly what Claude Code's inbox expects: an optional
 * `{"type":"auth",…}` line (Windows peer tokens only) and the
 * `{"type":"user","message":{"role":"user","content":…}}` line. Delivered
 * between tool calls; wakes an idle session (which is why push is gated by
 * the wake policy upstream). A missing/stale socket throws — the router
 * treats that as "session not reachable" and leaves the mail queued.
 */

import { connect as netConnect, type Socket } from 'node:net';

const PUSH_TIMEOUT_MS = 5_000;

export interface ClaudeInboxPushInput {
  socketPath: string;
  /** The full framed text (framing.ts), sent as one user message. */
  framedText: string;
  /** Windows peer token (`<pid>.<hash>.key` → peerToken); unused on unix. */
  token?: string;
  /** Injectable connect for tests. */
  connect?: (socketPath: string) => Promise<Socket>;
}

function defaultConnect(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to the Claude inbox socket: ${socketPath}`));
    }, PUSH_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function pushToClaudeInbox(input: ClaudeInboxPushInput): Promise<void> {
  const connect = input.connect ?? defaultConnect;
  const socket = await connect(input.socketPath);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out writing to the Claude inbox socket.')), PUSH_TIMEOUT_MS);
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: input.framedText } })}\n`, () => {
        socket.end();
        clearTimeout(timer);
        resolve();
      });
    });
  } finally {
    socket.destroy();
  }
}
