import type { LlmBinding, LlmBindingsState } from './llmTypes';
export interface LlmBindingStore {
    read(): Promise<LlmBindingsState>;
    write(state: LlmBindingsState): Promise<LlmBindingsState>;
    upsertBinding(binding: LlmBinding): Promise<LlmBindingsState>;
    removeBinding(bindingId: string): Promise<LlmBindingsState>;
    updateLastUsed(bindingId: string, now: string): Promise<LlmBindingsState>;
    listByMetaBotSlug(slug: string): Promise<LlmBinding[]>;
    listEnabledByMetaBotSlug(slug: string): Promise<LlmBinding[]>;
}
export declare function createLlmBindingStore(homeDirOrPaths: string | {
    llmBindingsPath: string;
}): LlmBindingStore;
