import type { ChatReplyRunner, ChatReplyRunnerInput, ChatReplyRunnerResult } from './privateChatTypes';
declare function findExecutableInPath(name: string): Promise<string | null>;
declare function detectHostBinary(preferredHost?: string | null): Promise<{
    host: string;
    binaryPath: string;
} | null>;
declare function buildChatPrompt(input: ChatReplyRunnerInput): string;
declare function parseRunnerOutput(rawOutput: string): ChatReplyRunnerResult;
export declare function createHostLlmChatReplyRunner(options?: {
    preferredHost?: string | null;
    timeoutMs?: number;
}): ChatReplyRunner;
export { buildChatPrompt, parseRunnerOutput, detectHostBinary, findExecutableInPath };
