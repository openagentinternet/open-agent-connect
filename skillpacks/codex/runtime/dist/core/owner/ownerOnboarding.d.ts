import type { ChainAdapterRegistry } from '../chain/adapters/types';
import type { ResolveSponsorWritePin } from '../signing/localMnemonicSigner';
import type { Signer } from '../signing/signer';
import { type RequestMvcGasSubsidyOptions, type RequestMvcGasSubsidyResult } from '../subsidy/requestMvcGasSubsidy';
import { type TrafficAccountService } from '../traffic/trafficAccountService';
import { type OwnerIdentityRecord } from './ownerIdentity';
export type OwnerOnboardingStatus = 'pending' | 'ready' | 'opted_out';
export type OwnerOnboardingStepState = 'pending' | 'done' | 'failed' | 'skipped';
export type OwnerOnboardingGrantState = 'pending' | 'claimed' | 'already_claimed' | 'disabled' | 'failed';
export interface OwnerOnboardingState {
    version: 1;
    status: OwnerOnboardingStatus;
    attempts: number;
    /** ISO timestamp of the last run; null before the first attempt. */
    lastAttemptAt: string | null;
    /** First error hit by the most recent run; null when it fully converged. */
    lastError: string | null;
    steps: {
        identity: OwnerOnboardingStepState;
        trafficAccount: OwnerOnboardingStepState;
        freeGrant: OwnerOnboardingGrantState;
        subsidy: OwnerOnboardingStepState;
        namePin: OwnerOnboardingStepState;
    };
    /** grantBytes from a successful free-grant claim; null otherwise. */
    freeGrantBytes: number | null;
    createdAt: string;
    updatedAt: string;
}
export declare function resolveOwnerOnboardingStatePath(systemHomeDir: string): string;
export declare function normalizeOwnerOnboardingState(value: unknown): OwnerOnboardingState | null;
/** Current onboarding state; null when this machine has never onboarded. */
export declare function readOwnerOnboardingState(systemHomeDir: string): Promise<OwnerOnboardingState | null>;
/** Tombstone after `user delete`: auto-provisioning must stay off for good. */
export declare function markOwnerOnboardingOptedOut(systemHomeDir: string): Promise<OwnerOnboardingState>;
/**
 * Re-arm onboarding after an explicit `user create`/`user import`: the user
 * has opted back in, so the account/grant steps may still converge on the
 * next daemon start. The identity step is already satisfied.
 */
export declare function resetOwnerOnboardingAfterManualIdentity(systemHomeDir: string): Promise<OwnerOnboardingState>;
export interface OwnerOnboardingStatusSnapshot {
    onboarding: OwnerOnboardingState | null;
    identityPresent: boolean;
}
/** Read-only snapshot for the /api/user/onboarding status verb and CLI. */
export declare function readOwnerOnboardingStatus(systemHomeDir: string): Promise<OwnerOnboardingStatusSnapshot>;
export interface OwnerOnboardingDeps {
    systemHomeDir: string;
    trafficAccountService: Pick<TrafficAccountService, 'ensureTrafficAccount' | 'claimFreeGrant'>;
    /** Chain adapters for the owner /info/name publish signer; absent = skip the pin step. */
    adapters?: ChainAdapterRegistry;
    /** MVC traffic (代付) sponsor hook for the owner signer; absent = self-pay. */
    resolveSponsorWritePin?: ResolveSponsorWritePin;
    requestMvcGasSubsidy?: (options: RequestMvcGasSubsidyOptions) => Promise<RequestMvcGasSubsidyResult>;
    /** Test seam: full override of the owner signer construction. */
    createSigner?: (owner: OwnerIdentityRecord) => Signer;
    /** Inter-write delay for the /info/name publish (defaults to 3s, like the Bot sync). */
    chainWriteDelayMs?: number;
    log?: (message: string) => void;
}
export interface OwnerOnboardingRunner {
    run(): Promise<OwnerOnboardingState>;
}
/**
 * Idempotent onboarding pipeline. Each daemon start (and the explicit
 * /api/user/onboarding run verb) advances every non-terminal step; failures
 * are recorded and retried on the next run. Concurrent callers share one
 * in-flight execution.
 */
export declare function createOwnerOnboardingRunner(deps: OwnerOnboardingDeps): OwnerOnboardingRunner;
