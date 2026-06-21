export type A2ADeliveryArtifactKind = 'image' | 'video' | 'audio' | 'file';
export interface A2ADeliveryArtifact {
    uri: string;
    pinId: string;
    kind: A2ADeliveryArtifactKind;
    fileName: string | null;
    extension: string | null;
    contentType: string | null;
    byteLength: number | null;
    sourceUrl: string;
    fallbackUrl: string;
    downloadUrl: string;
}
export declare function inferDeliveryArtifactKind(extension: string | null, contentType?: string | null): A2ADeliveryArtifactKind;
export declare function parseMetafileUri(rawUri: string): A2ADeliveryArtifact | null;
export declare function extractDeliveryArtifactsFromText(text: string): A2ADeliveryArtifact[];
export declare function normalizeDeliveryArtifacts(input: {
    artifacts?: unknown;
    resultText?: unknown;
} | null | undefined): A2ADeliveryArtifact[];
export declare function buildDeliveryArtifactSummary(artifact: A2ADeliveryArtifact): string;
export declare function appendDeliveryArtifactSummaries(responseText: string, artifacts: A2ADeliveryArtifact[]): string;
