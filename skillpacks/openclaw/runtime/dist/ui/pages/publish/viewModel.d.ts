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
export interface PublishPageViewModel {
    providerCard: PublishProviderCardViewModel;
    resultCard: PublishResultCardViewModel;
}
export declare function buildPublishPageViewModel(input: {
    providerSummary?: Record<string, unknown> | null;
    publishResult?: Record<string, unknown> | null;
}): PublishPageViewModel;
