import { type MemoryGuardLevel } from './memoryExtractor';
export declare const MEMORY_JUDGE_SYSTEM_PROMPT: string;
export interface MemoryJudgeInput {
    text: string;
    isExplicit: boolean;
    guardLevel: MemoryGuardLevel;
    /** Injected LLM transport; when omitted, judging stays rule-only. */
    judgeComplete?: (systemPrompt: string, userPrompt: string) => Promise<string>;
}
export interface MemoryJudgeResult {
    accepted: boolean;
    score: number;
    reason: string;
    source: 'rule' | 'llm';
}
export declare function parseLlmJudgePayload(text: string): {
    accepted: boolean;
    confidence: number;
    reason: string;
} | null;
export declare function judgeMemoryCandidate(input: MemoryJudgeInput): Promise<MemoryJudgeResult>;
