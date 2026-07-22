import fs from 'node:fs/promises';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';

/**
 * Traceability for the private-chat outbound send path. The orchestrator
 * swallows send failures by design (a failed reply must not crash the daemon
 * loop), so without this log there is no way to tell why a generated reply
 * never reached the chain. Events are appended as JSONL to
 * `<profile>/.runtime/logs/private-chat-send-failures.jsonl`.
 *
 * Never log message payloads, plaintext content, or private key material
 * here; only the failure stage, the peer, and a bounded error message.
 */
export type PrivateChatSendFailureKind =
  | 'identity_unavailable'
  | 'peer_chat_key_unavailable'
  | 'pin_write_failed';

export interface PrivateChatSendFailureEvent {
  kind: PrivateChatSendFailureKind;
  peerGlobalMetaId: string;
  error: string | null;
}

const SEND_FAILURE_LOG_FILE_NAME = 'private-chat-send-failures.jsonl';
const MAX_SEND_FAILURE_ERROR_LENGTH = 500;

export function describePrivateChatSendFailureError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.slice(0, MAX_SEND_FAILURE_ERROR_LENGTH);
}

export function privateChatSendFailureLogPath(paths: MetabotPaths): string {
  return path.join(paths.runtimeRoot, 'logs', SEND_FAILURE_LOG_FILE_NAME);
}

/**
 * Fire-and-forget JSONL appender. Writes are serialized through an internal
 * queue so concurrent failures cannot interleave lines, and all errors are
 * swallowed: logging must never break the send path it observes. The returned
 * promise is exposed only so tests can await a flush.
 */
export function createPrivateChatSendFailureFileLogger(
  paths: MetabotPaths,
): (event: PrivateChatSendFailureEvent) => Promise<void> {
  const logPath = privateChatSendFailureLogPath(paths);
  let queue: Promise<void> = Promise.resolve();
  return (event) => {
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`;
    queue = queue
      .then(async () => {
        await fs.mkdir(path.dirname(logPath), { recursive: true });
        await fs.appendFile(logPath, line, 'utf8');
      })
      .catch(() => undefined);
    return queue;
  };
}
