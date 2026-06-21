import { createServiceRunnerFailedResult, type ProviderServiceRunnerRegistration, type ProviderServiceRunnerRequest, type ProviderServiceRunnerResult } from './serviceRunnerContracts';
export interface ServiceRunnerResolutionInput {
    servicePinId?: string | null;
    providerSkill?: string | null;
}
export type ServiceRunnerResolution = {
    ok: true;
    matchBy: 'servicePinId' | 'providerSkill';
    registration: ProviderServiceRunnerRegistration;
} | ({
    ok: false;
    matchBy: null;
} & ReturnType<typeof createServiceRunnerFailedResult>);
export interface ServiceRunnerRegistry {
    register(registration: ProviderServiceRunnerRegistration): void;
    resolve(input: ServiceRunnerResolutionInput): ServiceRunnerResolution;
    execute(input: ProviderServiceRunnerRequest): Promise<ProviderServiceRunnerResult>;
}
export declare function createServiceRunnerRegistry(initialRegistrations?: ProviderServiceRunnerRegistration[]): ServiceRunnerRegistry;
