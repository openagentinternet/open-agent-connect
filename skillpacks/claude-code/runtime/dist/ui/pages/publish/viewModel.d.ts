export interface PublishDefinitionRow {
    label: string;
    value: string;
}
export interface PublishProviderCardViewModel {
    title: string;
    summary: string;
    rows: PublishDefinitionRow[];
}
export interface PublishSkillOptionViewModel {
    value: string;
    label: string;
    title: string;
    description: string;
}
export interface PublishMetaBotOptionViewModel {
    value: string;
    label: string;
    title: string;
    description: string;
    globalMetaId: string;
    primaryProvider: string;
}
export interface PublishAvailabilityViewModel {
    canPublish: boolean;
    reasonCode: string;
    message: string;
}
export interface PublishPageViewModel {
    providerCard: PublishProviderCardViewModel;
    runtimeCard: PublishProviderCardViewModel;
    metabots: PublishMetaBotOptionViewModel[];
    selectedMetaBotSlug: string;
    skills: PublishSkillOptionViewModel[];
    availability: PublishAvailabilityViewModel;
}
export declare function buildPublishPageViewModel(input: {
    providerSummary?: Record<string, unknown> | null;
    profiles?: unknown[] | null;
    runtimes?: unknown[] | null;
    selectedMetaBotSlug?: string | null;
    publishSkills?: Record<string, unknown> | null;
    publishSkillsError?: Record<string, unknown> | null;
    publishResult?: Record<string, unknown> | null;
}): PublishPageViewModel;
