import { type A2ADeliveryArtifact } from '../deliveryArtifacts';
import { uploadLargeFileToChain } from '../../files/uploadLargeFile';
import type { Signer } from '../../signing/signer';
export type ProviderExpectedArtifactFamily = 'text' | 'image' | 'video' | 'audio' | 'file';
type VerifyAvailability = Parameters<typeof uploadLargeFileToChain>[0]['verifyAvailability'];
type LargeUploader = Parameters<typeof uploadLargeFileToChain>[0]['largeUploader'];
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
}
export interface ResolveProviderDeliveryArtifactsResult {
    responseText: string;
    artifacts: A2ADeliveryArtifact[];
}
export declare class ProviderDeliveryArtifactError extends Error {
    code: string;
    constructor(code: string, message: string);
}
export declare function classifyProviderOutputType(outputType: unknown): ProviderExpectedArtifactFamily;
export declare function isTextLikeProviderOutputType(outputType: unknown): boolean;
export declare function resolveProviderDeliveryArtifacts(input: ResolveProviderDeliveryArtifactsInput): Promise<ResolveProviderDeliveryArtifactsResult>;
export {};
