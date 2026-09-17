import type { MetabotPaths } from '../state/paths.js';
export declare const DEFAULT_SURF_INTERACTION_BUDGET = 20;
export declare const MAX_SURF_INTERACTION_BUDGET = 100;
export interface MetawebSurfSettings {
    /**
     * Default OFF (opt-in): only an explicit true enables pre-dream surfing.
     * Every nightly surf spends LLM tokens and gas, so a bot that never
     * touched the toggle stays off (owner decision, IDBots 2026-09-14).
     */
    surfBeforeDreamEnabled: boolean;
    /** Chain-writing interactions allowed per surf run. */
    interactionBudget: number;
}
export declare const normalizeSurfBudgetValue: (value: unknown) => number | null;
export declare const defaultSurfSettings: () => MetawebSurfSettings;
export interface MetawebSurfSettingsStore {
    read(): Promise<MetawebSurfSettings>;
    /** Partial update; returns the merged settings actually persisted. */
    update(patch: Partial<Omit<MetawebSurfSettings, 'interactionBudget'>> & {
        interactionBudget?: unknown;
    }): Promise<MetawebSurfSettings>;
}
/** Create the per-bot surf settings store bound to `paths.surfSettingsPath`. */
export declare function createSurfSettingsStore(paths: MetabotPaths): MetawebSurfSettingsStore;
