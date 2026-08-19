export interface DshLlmBinding {
    dshLlmProvider?: string | null;
    dshLlmModel?: string | null;
    dshLlmFallbackProvider?: string | null;
    dshLlmFallbackModel?: string | null;
}
export declare function normalizeOptionalDshLlmId(value: unknown): string | null;
export declare function normalizeDshLlmBinding(value: unknown): DshLlmBinding;
export declare function readDshLlmBinding(filePath: string): Promise<DshLlmBinding>;
export declare function writeDshLlmBinding(filePath: string, binding: DshLlmBinding): Promise<void>;
export declare function mergeDshLlmBinding(current: DshLlmBinding, patch: DshLlmBinding): DshLlmBinding;
