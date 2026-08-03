import { type A2ADeliveryArtifact } from '../deliveryArtifacts';
import { uploadLargeFileToChain } from '../../files/uploadLargeFile';
import type { Signer } from '../../signing/signer';
export type ProviderExpectedArtifactFamily = 'text' | 'image' | 'video' | 'audio' | 'file';
type VerifyAvailability = Parameters<typeof uploadLargeFileToChain>[0]['verifyAvailability'];
type LargeUploader = Parameters<typeof uploadLargeFileToChain>[0]['largeUploader'];
type MvcSponsorClient = Parameters<typeof uploadLargeFileToChain>[0]['mvcSponsorClient'];
export interface ResolveProviderDeliveryArtifactsInput {
    responseText: string;
    outputType: string | null | undefined;
    executionCwd?: string | null;
    workspaceRootCwd?: string | null;
    network?: string | null;
    signer: Signer;
    uploadLargeFile?: typeof uploadLargeFileToChain;
    verifyAvailability?: VerifyAvailability;
    largeUploader?: LargeUploader;
    mvcSponsorClient?: MvcSponsorClient;
    /**
     * Total on-chain upload attempts for a locally resolved artifact (IDBots
     * uploadVerifiedDeliveryArtifact parity). Defaults to 1 (single attempt).
     * Only actual upload/verification failures are retried; deterministic local
     * validation errors never are.
     */
    maxUploadAttempts?: number;
    /** Best-effort hook fired once before the first upload attempt. */
    onUploadStart?: () => void | Promise<void>;
    /** Best-effort hook fired before each re-upload attempt after a failure. */
    onUploadRetry?: (input: {
        attempt: number;
        error: unknown;
    }) => void | Promise<void>;
}
export interface ResolveProviderDeliveryArtifactsResult {
    responseText: string;
    artifacts: A2ADeliveryArtifact[];
}
export declare class ProviderDeliveryArtifactError extends Error {
    code: string;
    data?: Record<string, unknown>;
    constructor(code: string, message: string, data?: Record<string, unknown>);
}
export declare function classifyProviderOutputType(outputType: unknown): ProviderExpectedArtifactFamily;
export declare function isTextLikeProviderOutputType(outputType: unknown): boolean;
/**
 * Tolerant variant of scanWorkspaceForCandidates for the provider execution
 * timeout fallback: it never throws, silently skips secret-like files and
 * hidden directories, and only returns a path when exactly one workspace file
 * matches the expected artifact family. Text-like output types have no
 * deliverable file artifact and always return null.
 */
export declare function findProviderWorkspaceArtifactCandidate(input: {
    workspaceCwd: string | null | undefined;
    outputType: unknown;
}): Promise<string | null>;
export declare function resolveProviderDeliveryArtifacts(input: ResolveProviderDeliveryArtifactsInput): Promise<ResolveProviderDeliveryArtifactsResult>;
export {};
