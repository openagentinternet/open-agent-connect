export interface HubServiceDirectoryEntry {
    key: string;
    servicePinId: string;
    displayName: string;
    description: string;
    providerLabel: string;
    providerName: string;
    providerGmid: string;
    priceLabel: string;
    capabilityLabel: string;
    statusLabel: string;
    statusTone: 'online' | 'recent' | 'offline';
    updatedAtMs: number | null;
    lastSeenAtMs: number | null;
    lastSeenAgoSeconds: number | null;
}
export interface HubServiceDirectoryViewModel {
    countLabel: string;
    entries: HubServiceDirectoryEntry[];
    emptyTitle: string;
    emptyBody: string;
}
export declare function buildHubServiceDirectoryViewModel(input: {
    services?: Array<Record<string, unknown>> | null;
}): HubServiceDirectoryViewModel;
