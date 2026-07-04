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
export declare function resolveProviderDeliveryArtifacts(input: ResolveProviderDeliveryArtifactsInput): Promise<ResolveProviderDeliveryArtifactsResult>;
export {};
