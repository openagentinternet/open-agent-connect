export interface PublishDefinitionRow {
    label: string;
    value: string;
}
export interface PublishProviderCardViewModel {
    title: string;
    summary: string;
    rows: PublishDefinitionRow[];
}
export interface PublishResultCardViewModel {
    hasResult: boolean;
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
export interface PublishAvailabilityViewModel {
    canPublish: boolean;
    reasonCode: string;
    message: string;
}
export interface PublishPageViewModel {
    providerCard: PublishProviderCardViewModel;
    runtimeCard: PublishProviderCardViewModel;
    resultCard: PublishResultCardViewModel;
    skills: PublishSkillOptionViewModel[];
    availability: PublishAvailabilityViewModel;
}
export declare function buildPublishPageViewModel(input: {
    providerSummary?: Record<string, unknown> | null;
    publishSkills?: Record<string, unknown> | null;
    publishSkillsError?: Record<string, unknown> | null;
    publishResult?: Record<string, unknown> | null;
}): PublishPageViewModel;
