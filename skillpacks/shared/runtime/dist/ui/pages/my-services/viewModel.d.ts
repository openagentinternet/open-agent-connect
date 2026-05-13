export interface MyServiceMetricViewModel {
    label: string;
    value: string;
}
export interface MyServicesPaginationViewModel {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    canPrevious: boolean;
    canNext: boolean;
}
export interface MyServiceListEntryViewModel {
    key: string;
    id: string;
    currentPinId: string;
    sourceServicePinId: string;
    title: string;
    serviceName: string;
    description: string;
    iconUri: string;
    iconLabel: string;
    skillLabel: string;
    outputTypeLabel: string;
    priceLabel: string;
    creatorLabel: string;
    updatedAtLabel: string;
    metrics: MyServiceMetricViewModel[];
    canModify: boolean;
    canRevoke: boolean;
    blockedReason: string;
}
export interface MyServiceOrderEntryViewModel {
    key: string;
    statusLabel: string;
    buyerLabel: string;
    paymentLabel: string;
    paymentTxid: string;
    orderTxid: string;
    servicePinId: string;
    timeLabel: string;
    ratingLabel: string;
    ratingComment: string;
    ratingPinId: string;
    traceHref: string;
    traceLabel: string;
    sessionHref: string;
    sessionLabel: string;
    runtimeLabel: string;
}
export interface MyServiceEditFormViewModel {
    serviceId: string;
    displayName: string;
    serviceName: string;
    description: string;
    providerSkill: string;
    outputType: string;
    price: string;
    currency: string;
    serviceIconUri: string;
    serviceIconPreviewUri: string;
}
export interface MyServicesNoticeViewModel {
    tone: 'success' | 'error' | 'warning' | 'neutral';
    title: string;
    message: string;
    txids: string[];
    pinId: string;
}
export interface MyServicesEmptyStateViewModel {
    title: string;
    message: string;
}
export interface MyServicesPageViewModel {
    services: MyServiceListEntryViewModel[];
    selectedService: MyServiceListEntryViewModel | null;
    orders: MyServiceOrderEntryViewModel[];
    editForm: MyServiceEditFormViewModel | null;
    notice: MyServicesNoticeViewModel | null;
    pageLabel: string;
    orderPageLabel: string;
    pagination: MyServicesPaginationViewModel;
    orderPagination: MyServicesPaginationViewModel;
    emptyState: MyServicesEmptyStateViewModel;
    orderEmptyState: MyServicesEmptyStateViewModel;
    currencyOptions: string[];
    outputTypeOptions: string[];
}
export declare function buildMyServicesPageViewModel(input: {
    servicesPage?: Record<string, unknown> | null;
    ordersPage?: Record<string, unknown> | null;
    selectedServiceId?: string | null;
    mutationResult?: Record<string, unknown> | null;
    error?: Record<string, unknown> | null;
}): MyServicesPageViewModel;
export declare function buildMyServicesPageViewModelRuntimeSource(): string;
