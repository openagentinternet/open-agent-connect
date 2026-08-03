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
export type PrivateChatSendFailureKind = 'identity_unavailable' | 'peer_chat_key_unavailable' | 'pin_write_failed' | 'reply_runner_failed' | 'reply_commit_failed' | 'rate_limited';
export interface PrivateChatSendFailureEvent {
    kind: PrivateChatSendFailureKind;
    peerGlobalMetaId: string;
    error: string | null;
}
export declare function describePrivateChatSendFailureError(error: unknown): string;
export declare function privateChatSendFailureLogPath(paths: MetabotPaths): string;
/**
 * Fire-and-forget JSONL appender. Writes are serialized through an internal
 * queue so concurrent failures cannot interleave lines, and all errors are
 * swallowed: logging must never break the send path it observes. The returned
 * promise is exposed only so tests can await a flush.
 */
export declare function createPrivateChatSendFailureFileLogger(paths: MetabotPaths): (event: PrivateChatSendFailureEvent) => Promise<void>;
