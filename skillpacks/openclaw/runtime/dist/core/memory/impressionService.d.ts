import type { ExperienceStore } from './experienceStore';
import type { ImpressionStore } from './impressionStore';
import type { DreamImpressionPromptSubject, DreamImpressionUpdate } from './dreamPrompt';
export interface DreamImpressionApplyResult {
    accepted: number;
    created: number;
    rejected: number;
    rebuilt: number;
}
/** Select bounded, owner-relative evidence for the day's dream prompt. */
export declare function buildDreamImpressionSubjects(input: {
    experienceStore: ExperienceStore;
    impressionStore: ImpressionStore;
    observerGlobalMetaId: string;
    fromTime: number;
    toTime: number;
    maxSubjects?: number;
}): Promise<DreamImpressionPromptSubject[]>;
/** Validate and persist LLM-produced subject updates without changing hard relationships. */
export declare function applyDreamImpressionUpdates(input: {
    impressionStore: ImpressionStore;
    observerGlobalMetaId: string;
    dreamDate: string;
    dreamVersion: number;
    modelId?: string | null;
    subjects: DreamImpressionPromptSubject[];
    updates: DreamImpressionUpdate[];
}): Promise<DreamImpressionApplyResult>;
