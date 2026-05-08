export interface ProviderConsoleRow {
    label: string;
    value: string;
}
export interface ProviderPresenceCardViewModel {
    title: string;
    statusLabel: string;
    actionLabel: string;
    rows: ProviderConsoleRow[];
}
export interface ProviderServiceInventoryEntry {
    key: string;
    displayName: string;
    serviceName: string;
    availabilityLabel: string;
    priceLabel: string;
    servicePinId: string;
    lastPublishAt: string;
}
export interface ProviderRecentOrderEntry {
    key: string;
    serviceName: string;
    buyerLabel: string;
    stateLabel: string;
    statusDetail: string;
    traceHref: string;
    traceLabel: string;
    paymentLabel: string;
    runtimeLabel: string;
    refundRequestPinId: string;
    refundTxid: string;
    refundFinalizePinId: string;
    refundBlockingReason: string;
    createdAt: string;
    requiresManualRefund: boolean;
    ratingCommentPreview: string;
    ratingPinId: string;
}
export interface ProviderManualActionEntry {
    key: string;
    kindLabel: string;
    orderId: string;
    refundRequestPinId: string;
    refundHref: string;
    traceHref: string;
}
export interface MyServicesPageViewModel {
    presenceCard: ProviderPresenceCardViewModel;
    serviceInventory: ProviderServiceInventoryEntry[];
    recentOrders: ProviderRecentOrderEntry[];
    manualActions: ProviderManualActionEntry[];
}
export declare function buildMyServicesPageViewModel(input: {
    providerSummary?: Record<string, unknown> | null;
}): MyServicesPageViewModel;
export declare function buildMyServicesPageViewModelRuntimeSource(): string;
