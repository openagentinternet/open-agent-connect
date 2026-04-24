export type DelegationOrderabilityStatus = 'available' | 'offline' | 'missing';
export interface ResolveDelegationOrderabilityParams {
    availableServices: any[];
    allServices: any[];
    servicePinId: string;
    providerGlobalMetaId: string;
}
export interface ResolveDelegationOrderabilityResult {
    status: DelegationOrderabilityStatus;
    service: any | null;
}
export declare const resolveDelegationOrderability: (params: ResolveDelegationOrderabilityParams) => ResolveDelegationOrderabilityResult;
