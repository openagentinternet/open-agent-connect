import { type DerivedIdentity } from '../identity/deriveIdentity';
import type { SecretStore } from '../secrets/secretStore';
import type { Signer } from '../signing/signer';
import { type RuntimeIdentityRecord, type RuntimeStateStore } from '../state/runtimeStateStore';
import type { BootstrapCreateRequest, BootstrapCreateStep } from './createMetabot';
import type { BootstrapRequestSubsidyStep } from './requestSubsidy';
import type { BootstrapSyncStep } from './syncIdentityToChain';
import { type RequestMvcGasSubsidyOptions, type RequestMvcGasSubsidyResult } from '../subsidy/requestMvcGasSubsidy';
export declare function isIdentityBootstrapReady(identity: RuntimeIdentityRecord | null): boolean;
export declare function createLocalMetabotStep(input: {
    runtimeStateStore: RuntimeStateStore;
    secretStore: SecretStore;
    now?: () => number;
    generateMnemonic?: () => string;
    deriveIdentityFn?: (options: {
        mnemonic: string;
        path: string;
    }) => Promise<DerivedIdentity>;
    derivePrivateKeyHexFn?: (options: {
        mnemonic: string;
        path: string;
    }) => Promise<string>;
}): BootstrapCreateStep<BootstrapCreateRequest, RuntimeIdentityRecord>;
export declare function createMetabotSubsidyStep(input: {
    runtimeStateStore: RuntimeStateStore;
    requestMvcGasSubsidy?: (options: RequestMvcGasSubsidyOptions) => Promise<RequestMvcGasSubsidyResult>;
}): BootstrapRequestSubsidyStep<BootstrapCreateRequest, RuntimeIdentityRecord>;
export declare function createLocalIdentitySyncStep(input: {
    runtimeStateStore: RuntimeStateStore;
    signer: Pick<Signer, 'writePin'>;
    wait?: (ms: number) => Promise<void>;
    stepDelayMs?: number;
}): BootstrapSyncStep<BootstrapCreateRequest, RuntimeIdentityRecord>;
