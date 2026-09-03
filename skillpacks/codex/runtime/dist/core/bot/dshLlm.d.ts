export interface DshLlmBinding {
    dshLlmProvider?: string | null;
    dshLlmModel?: string | null;
    dshLlmReasoningEffort?: string | null;
    dshLlmFallbackProvider?: string | null;
    dshLlmFallbackModel?: string | null;
    dshLlmFallbackReasoningEffort?: string | null;
}
/** Reasoning efforts the DSH adapters own (llm-deepseek ships off/low/high/max). */
export declare const DSH_LLM_REASONING_EFFORTS: readonly ["off", "low", "high", "max"];
export declare function normalizeOptionalDshLlmId(value: unknown): string | null;
/**
 * Normalize an optional reasoning effort: null/blank clears it (the provider
 * default applies), and anything outside the adapter vocabulary is rejected.
 */
export declare function normalizeOptionalDshLlmReasoningEffort(value: unknown): string | null;
export declare function normalizeDshLlmBinding(value: unknown): DshLlmBinding;
export declare function readDshLlmBinding(filePath: string): Promise<DshLlmBinding>;
export declare function writeDshLlmBinding(filePath: string, binding: DshLlmBinding): Promise<void>;
export declare function mergeDshLlmBinding(current: DshLlmBinding, patch: DshLlmBinding): DshLlmBinding;
